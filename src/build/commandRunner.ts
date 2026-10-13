import { spawn } from "node:child_process";

import { ALLOWED_PROGRAMS, KEPT_OUTPUT_CHARS, MAX_REASON_CHARS, STOP_GRACE_MS } from "@/constants/build.ts";
import { CommandFailedError } from "@/errors.ts";
import type { CommandRunnerDeps, RunCommand } from "@/types/build.ts";

/** "docker build": the program and its first argument that is not an option. Sentences name a command this way. */
function labelOf(program: string, args: string[]): string {
  const action = args.find((arg) => !arg.startsWith("-"));
  return action === undefined ? program : `${program} ${action}`;
}

/** Adds a piece of output to what was kept so far and drops the oldest part beyond the limit. */
function keepEnd(kept: string, piece: string): string {
  return (kept + piece).slice(-KEPT_OUTPUT_CHARS);
}

/** The last line that is not empty. Undefined when nothing was printed. */
function lastLineOf(output: string): string | undefined {
  return output
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line !== "");
}

/**
 * Makes the function that starts programs. This is the only file in src/ that may import
 * node:child_process. Everything else is handed a RunCommand, so a test can pass a pretend
 * one and no real docker, kind, aws or terraform runs.
 */
export function createCommandRunner(deps: CommandRunnerDeps = {}): RunCommand {
  const log = deps.log ?? console.log;
  const programs = deps.programs ?? {};
  const stopGraceMs = deps.stopGraceMs ?? STOP_GRACE_MS;

  return async (program, args, options) => {
    // The type already limits the programs. This check also stops a caller that got around the type.
    if (!ALLOWED_PROGRAMS.includes(program)) {
      throw new CommandFailedError(
        `"${program}" is not a program I am allowed to run (only ${ALLOWED_PROGRAMS.join(", ")}).`,
      );
    }
    const label = labelOf(program, args);
    log(`Running: ${program} ${args.join(" ")}`);

    return new Promise<string>((resolve, reject) => {
      // No shell reads the arguments: each one reaches the program exactly as it is,
      // so a space or "$(...)" in a folder name is just text.
      const child = spawn(programs[program] ?? program, args, {
        shell: false,
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
      });

      // The input (a password) is written to standard input, which is then closed.
      // A program may end without reading it; that is not an error here, its exit code tells what happened.
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);

      /** The end of what came on standard output: the answer of a command that succeeds. */
      let stdout = "";
      /** The end of everything that may be logged and shown, for the error of a command that fails. */
      let printed = "";

      const logLines = (piece: string): void => {
        for (const line of piece.split("\n")) {
          if (line.trim() !== "") {
            log(`[${program}] ${line.trimEnd()}`);
          }
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (piece: string) => {
        stdout = keepEnd(stdout, piece);
        // A secret is only handed back to the caller: it is not logged and not put into an error.
        if (!options.secretOutput) {
          printed = keepEnd(printed, piece);
          logLines(piece);
        }
      });
      // Programs write their error text to standard error, also the ones that print a secret.
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (piece: string) => {
        printed = keepEnd(printed, piece);
        logLines(piece);
      });

      let timedOut = false;
      let hardStop: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        // Asked to stop first, so that Terraform can save its state and let go of its lock.
        child.kill("SIGTERM");
        // A program that does not listen is stopped the hard way.
        hardStop = setTimeout(() => child.kill("SIGKILL"), stopGraceMs);
      }, options.timeoutMs);

      // "error" means the program could not be started at all.
      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        clearTimeout(hardStop);
        const message =
          error.code === "ENOENT"
            ? `I need "${program}" for this, but it is not installed on this machine.`
            : `"${label}" could not be started: ${error.message}`;
        reject(new CommandFailedError(message));
      });

      // "close" comes when the program has ended and everything it printed has been read.
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        clearTimeout(hardStop);
        if (code === 0) {
          resolve(stdout);
          return;
        }
        if (timedOut) {
          reject(
            new CommandFailedError(`"${label}" did not finish within ${options.timeoutMs / 1000} seconds.`, printed),
          );
          return;
        }
        const ending = code === null ? `stopped by ${signal}` : `exit code ${code}`;
        const reason = lastLineOf(printed)?.slice(0, MAX_REASON_CHARS) ?? ending;
        reject(new CommandFailedError(`"${label}" failed: ${reason}`, printed));
      });
    });
  };
}
