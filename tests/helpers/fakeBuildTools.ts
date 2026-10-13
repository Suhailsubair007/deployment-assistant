// Pretend build tools for unit tests. Nothing here starts docker, kind, aws or terraform:
// the calls are only written down, so a test can check them.

import type {
  AllowedProgram,
  BuildTools,
  CommandOptions,
  ImageBuilder,
  RunCommand,
  ServiceInfra,
} from "@/types/build.ts";

export type BuildStep = "ensure" | "build" | "publish";

/**
 * Stands in for the real build tools in tests of the code that uses them.
 * By default it behaves like a kind cluster; `withInfra: true` behaves like EKS.
 */
export class FakeBuildTools implements BuildTools {
  /** Every call, in order: "ensure orders-api", "build /path/to/folder orders-api:v1", "publish orders-api:v1". */
  calls: string[] = [];
  registry: string;
  /** Set this to null for a cluster the assistant cannot build for. */
  builder: ImageBuilder | null;
  infra: ServiceInfra | null;

  private readonly failures = new Map<BuildStep, Error>();
  private readonly holds = new Map<BuildStep, Promise<void>>();

  constructor(options: { registry?: string; withInfra?: boolean } = {}) {
    this.registry = options.registry ?? "";
    this.builder = {
      build: (folder, image) => this.step("build", `build ${folder} ${image}`),
      publish: (image) => this.step("publish", `publish ${image}`),
    };
    this.infra = options.withInfra ? { ensure: (service) => this.step("ensure", `ensure ${service}`) } : null;
  }

  /** Makes the next call of one step fail with this error. */
  failNext(step: BuildStep, error: Error): void {
    this.failures.set(step, error);
  }

  /**
   * Makes the next call of one step wait until the returned function is called:
   *   const release = tools.hold("build");
   * This lets a test look at an operation while the build is "running".
   */
  hold(step: BuildStep): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.holds.set(step, promise);
    return resolve;
  }

  private async step(step: BuildStep, call: string): Promise<void> {
    this.calls.push(call);

    const held = this.holds.get(step);
    if (held !== undefined) {
      this.holds.delete(step);
      await held;
    }

    const error = this.failures.get(step);
    if (error !== undefined) {
      this.failures.delete(step);
      throw error;
    }
  }
}

/** One call of the pretend RunCommand. */
export interface RecordedCommand {
  program: AllowedProgram;
  args: string[];
  options: CommandOptions;
}

/**
 * A pretend RunCommand for tests of src/build itself. It starts nothing: it writes down
 * every call and answers with what `answer` returns (nothing, unless the test says otherwise).
 * `answer` may throw to play a command that fails.
 */
export function recordCommands(answer: (call: RecordedCommand) => string | Promise<string> = () => ""): {
  run: RunCommand;
  calls: RecordedCommand[];
} {
  const calls: RecordedCommand[] = [];
  const run: RunCommand = async (program, args, options) => {
    const call = { program, args, options };
    calls.push(call);
    return answer(call);
  };
  return { run, calls };
}
