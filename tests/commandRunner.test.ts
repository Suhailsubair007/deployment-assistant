import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCommandRunner } from "@/build/commandRunner.ts";
import { KEPT_OUTPUT_CHARS } from "@/constants/build.ts";
import { CommandFailedError } from "@/errors.ts";
import type { AllowedProgram, RunCommand } from "@/types/build.ts";

// No real docker, kind, aws or terraform is started in this file. Every program name
// points at Node itself, which runs the small script it is handed.
const NODE_FOR_EVERY_PROGRAM = {
  docker: process.execPath,
  kind: process.execPath,
  aws: process.execPath,
  terraform: process.execPath,
};

const QUICK = { timeoutMs: 20_000 };

/** Arguments that make Node run this script. `rest` follows it, like "build" follows "docker". */
function script(code: string, ...rest: string[]): string[] {
  return [`--eval=${code}`, ...rest];
}

/** A runner, and every line it logged. */
function newRunner(stopGraceMs?: number): { run: RunCommand; logged: string[] } {
  const logged: string[] = [];
  const run = createCommandRunner({
    log: (line) => logged.push(line),
    programs: NODE_FOR_EVERY_PROGRAM,
    stopGraceMs,
  });
  return { run, logged };
}

/** Runs a command that must fail and gives back its error. */
async function failureOf(running: Promise<string>): Promise<CommandFailedError> {
  try {
    await running;
  } catch (error) {
    assert.ok(error instanceof CommandFailedError, `expected a CommandFailedError, got ${String(error)}`);
    return error;
  }
  throw new Error("The command did not fail.");
}

function isRunning(pid: number): boolean {
  try {
    // Signal 0 sends nothing: it only asks whether the process exists.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("what the program prints on standard output comes back", async () => {
  const { run } = newRunner();

  const printed = await run("docker", script("console.log('first'); console.log('second')", "version"), QUICK);

  assert.equal(printed, "first\nsecond\n");
});

test("the command is logged when it starts, and its output as it arrives", async () => {
  const { run, logged } = newRunner();
  const args = script("console.log('to stdout'); console.error('to stderr')", "build");

  await run("docker", args, QUICK);

  assert.equal(logged[0], `Running: docker ${args.join(" ")}`);
  assert.ok(logged.includes("[docker] to stdout"));
  assert.ok(logged.includes("[docker] to stderr"));
});

test("a program that ends with an error gives its last line and says which command it was", async () => {
  const { run } = newRunner();
  const code = "console.log('Step 1/3'); console.error('no such image'); console.error(''); process.exit(3)";

  const error = await failureOf(run("docker", script(code, "build", "--tag", "x"), QUICK));

  assert.equal(error.message, '"docker build" failed: no such image');
  assert.ok(error.output.includes("Step 1/3"));
  assert.ok(error.output.includes("no such image"));
});

test("a program that fails without printing anything still says how it ended", async () => {
  const { run } = newRunner();

  const error = await failureOf(run("kind", script("process.exit(3)", "load"), QUICK));

  assert.equal(error.message, '"kind load" failed: exit code 3');
});

test("a program outside the list is refused and nothing is started", async () => {
  const logged: string[] = [];
  const run = createCommandRunner({
    log: (line) => logged.push(line),
    // Even when someone maps the name to a real program, it does not run.
    programs: { ...NODE_FOR_EVERY_PROGRAM, node: process.execPath },
  });
  const marker = join(mkdtempSync(join(tmpdir(), "runner-")), "started");
  const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`;

  const error = await failureOf(run("node" as AllowedProgram, script(code), QUICK));

  assert.equal(error.message, '"node" is not a program I am allowed to run (only docker, kind, aws, terraform).');
  assert.equal(existsSync(marker), false);
  assert.deepEqual(logged, []);
});

test("an argument with spaces and shell characters arrives as one argument, unchanged", async () => {
  const { run } = newRunner();
  const tricky = 'my folder; $(touch /tmp/x) `id` && echo "hi" | cat > out';

  const printed = await run("docker", script("console.log(JSON.stringify(process.argv.slice(1)))", "build", tricky), QUICK);

  assert.deepEqual(JSON.parse(printed), ["build", tricky]);
});

test("the input reaches the program, and is neither an argument nor in the log", async () => {
  const { run, logged } = newRunner();
  // The script answers with the input backwards, so the test can tell it arrived without it being printed.
  const code = `
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (piece) => { input += piece; });
    process.stdin.on('end', () => {
      console.log(JSON.stringify({ backwards: [...input].reverse().join(''), args: process.argv.slice(1) }));
    });
  `;

  const printed = await run("docker", script(code, "login", "--password-stdin"), { ...QUICK, input: "pass-word-123" });

  assert.deepEqual(JSON.parse(printed), { backwards: "321-drow-ssap", args: ["login", "--password-stdin"] });
  assert.equal(logged.join("\n").includes("pass-word-123"), false);
});

test("a program without input finds its standard input closed", async () => {
  const { run } = newRunner();
  const code = "process.stdin.resume(); process.stdin.on('end', () => console.log('closed'))";

  assert.equal(await run("docker", script(code, "build"), QUICK), "closed\n");
});

test("a program that fails without reading its input still gives the normal failure", async () => {
  const { run } = newRunner();

  const error = await failureOf(
    run("docker", script("process.exit(2)", "login"), { ...QUICK, input: "x".repeat(1_000_000) }),
  );

  assert.equal(error.message, '"docker login" failed: exit code 2');
});

test("secret output is returned but never logged", async () => {
  const { run, logged } = newRunner();

  // The script puts the secret together itself, so that it is not in the arguments, which are logged.
  const printed = await run("aws", script("console.log('s3cret' + '-token')", "ecr"), { ...QUICK, secretOutput: true });

  assert.equal(printed, "s3cret-token\n");
  assert.equal(logged.join("\n").includes("s3cret-token"), false);
  // The command itself is still logged: its arguments are never secrets.
  assert.equal(logged.length, 1);
});

test("a secret printed before a failure is not in the error either, but the reason is", async () => {
  const { run, logged } = newRunner();
  const code = "console.log('s3cret' + '-token'); console.error('Unable to locate credentials'); process.exit(255)";

  const error = await failureOf(run("aws", script(code, "ecr"), { ...QUICK, secretOutput: true }));

  assert.equal(error.message, '"aws ecr" failed: Unable to locate credentials');
  assert.equal(error.output.includes("s3cret-token"), false);
  assert.equal(logged.join("\n").includes("s3cret-token"), false);
});

// The two tests below have a time limit of their own: if stopping ever breaks, they fail instead of waiting forever.
const STOPS_WITHIN = { timeout: 15_000 };

test("a program that takes too long is stopped and reported", STOPS_WITHIN, async () => {
  const { run } = newRunner();
  const code = "console.log(process.pid); setInterval(() => {}, 1000)";

  const error = await failureOf(run("docker", script(code, "build"), { timeoutMs: 500 }));

  assert.equal(error.message, '"docker build" did not finish within 0.5 seconds.');
  assert.equal(isRunning(Number(error.output)), false);
});

test("a program that ignores the request to stop is stopped the hard way", STOPS_WITHIN, async () => {
  const { run } = newRunner(200);
  const code = `
    process.on('SIGTERM', () => console.log('not stopping'));
    console.log(process.pid);
    setInterval(() => {}, 1000);
  `;

  const error = await failureOf(run("terraform", script(code, "apply"), { timeoutMs: 1000 }));

  assert.equal(error.message, '"terraform apply" did not finish within 1 seconds.');
  const [pid, answer] = error.output.trim().split("\n");
  assert.equal(answer, "not stopping");
  assert.equal(isRunning(Number(pid)), false);
});

test("a program that is not installed gives a plain sentence", async () => {
  const run = createCommandRunner({ log: () => {}, programs: { docker: "/no/such/folder/docker" } });

  const error = await failureOf(run("docker", ["build", "."], QUICK));

  assert.equal(error.message, 'I need "docker" for this, but it is not installed on this machine.');
});

test("the program gets the assistant's own environment plus the extra variables", async () => {
  const { run } = newRunner();
  const code = "console.log(process.env.AWS_PROFILE, process.env.PATH === undefined ? 'no PATH' : 'has PATH')";

  const printed = await run("aws", script(code, "sts"), { ...QUICK, env: { AWS_PROFILE: "build" } });

  assert.equal(printed, "build has PATH\n");
});

test("the program runs in the folder it was given", async () => {
  const { run } = newRunner();
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "runner-")));

  const printed = await run("terraform", script("console.log(process.cwd())", "init"), { ...QUICK, cwd: folder });

  assert.equal(printed, `${folder}\n`);
});

test("two megabytes of output do not fail and are not kept whole", async () => {
  const { run } = newRunner();
  // 20,000 lines of a bit more than 100 characters.
  const code = "for (let i = 0; i < 20000; i++) console.log('line ' + i + ' ' + 'x'.repeat(100))";

  const printed = await run("docker", script(code, "build"), QUICK);

  assert.ok(printed.length <= KEPT_OUTPUT_CHARS, `kept ${printed.length} characters`);
  // What is kept is the end, which is where a build says how it went.
  assert.ok(printed.endsWith(`line 19999 ${"x".repeat(100)}\n`));
});

test("one endless line without a line break is not kept whole either", async () => {
  const { run } = newRunner();

  const error = await failureOf(
    run("docker", script("process.stderr.write('x'.repeat(2000000), () => process.exit(1))", "push"), QUICK),
  );

  assert.ok(error.output.length <= KEPT_OUTPUT_CHARS);
  // The sentence for the user quotes only the start of such a line.
  assert.ok(error.message.length < 400, `the message has ${error.message.length} characters`);
});
