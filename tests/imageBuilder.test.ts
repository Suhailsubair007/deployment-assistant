import assert from "node:assert/strict";
import { test } from "node:test";

import { createEcrImageBuilder, createKindImageBuilder } from "@/build/imageBuilder.ts";
import { CommandFailedError } from "@/errors.ts";
import type { EksTarget } from "@/types/build.ts";
import { recordCommands } from "./helpers/fakeBuildTools.ts";
import type { RecordedCommand } from "./helpers/fakeBuildTools.ts";

const timeoutMs = 900_000;
const FOLDER = "/Users/asha/code/orders api";

const EKS: EksTarget = {
  kind: "eks",
  region: "ap-south-1",
  account: "123456789012",
  cluster: "deployment-assistant-staging",
  registry: "123456789012.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging",
};
const REGISTRY_HOST = "123456789012.dkr.ecr.ap-south-1.amazonaws.com";
const EKS_IMAGE = `${EKS.registry}/orders-api:v1`;
const PASSWORD = "a-12-hour-password\n";

/** Plays the AWS CLI handing out the registry password; every other command prints nothing. */
function withPassword(call: RecordedCommand): string {
  return call.program === "aws" ? PASSWORD : "";
}

// ---- kind ----

test("for kind, the image is built with docker from the folder", async () => {
  const { run, calls } = recordCommands();
  const builder = createKindImageBuilder({ run, kindCluster: "deploy-assistant", timeoutMs });

  await builder.build(FOLDER, "orders-api:v1");

  assert.deepEqual(calls, [
    { program: "docker", args: ["build", "--tag", "orders-api:v1", FOLDER], options: { timeoutMs } },
  ]);
});

test("for kind, publishing loads the image into the kind cluster", async () => {
  const { run, calls } = recordCommands();
  const builder = createKindImageBuilder({ run, kindCluster: "deploy-assistant", timeoutMs });

  await builder.publish("orders-api:v1");

  assert.deepEqual(calls, [
    {
      program: "kind",
      args: ["load", "docker-image", "orders-api:v1", "--name", "deploy-assistant"],
      options: { timeoutMs },
    },
  ]);
});

test("for kind, a build that fails passes its error on unchanged", async () => {
  const failure = new CommandFailedError('"docker build" failed: no Dockerfile');
  const { run } = recordCommands(() => {
    throw failure;
  });
  const builder = createKindImageBuilder({ run, kindCluster: "deploy-assistant", timeoutMs });

  await assert.rejects(builder.build(FOLDER, "orders-api:v1"), (error) => error === failure);
});

// ---- EKS ----

test("for EKS, the image is built for the x86 machines of the cluster", async () => {
  const { run, calls } = recordCommands();
  const builder = createEcrImageBuilder({ run, target: EKS, timeoutMs });

  await builder.build(FOLDER, EKS_IMAGE);

  assert.deepEqual(calls, [
    {
      program: "docker",
      args: ["build", "--platform", "linux/amd64", "--tag", EKS_IMAGE, FOLDER],
      options: { timeoutMs },
    },
  ]);
});

test("for EKS, publishing asks AWS for a password, logs docker in and pushes the image", async () => {
  const { run, calls } = recordCommands(withPassword);
  const builder = createEcrImageBuilder({ run, target: EKS, timeoutMs });

  await builder.publish(EKS_IMAGE);

  assert.deepEqual(calls, [
    {
      program: "aws",
      args: ["ecr", "get-login-password", "--region", "ap-south-1"],
      options: { timeoutMs, secretOutput: true },
    },
    {
      program: "docker",
      args: ["login", "--username", "AWS", "--password-stdin", REGISTRY_HOST],
      options: { timeoutMs, input: PASSWORD },
    },
    { program: "docker", args: ["push", EKS_IMAGE], options: { timeoutMs } },
  ]);
});

test("the registry password is only ever handed over as input, never as an argument", async () => {
  const { run, calls } = recordCommands(withPassword);
  const builder = createEcrImageBuilder({ run, target: EKS, awsProfile: "build", timeoutMs });

  await builder.publish(EKS_IMAGE);

  const password = PASSWORD.trim();
  for (const call of calls) {
    assert.equal(call.args.join(" ").includes(password), false, `${call.program} ${call.args[0]}`);
    assert.equal(JSON.stringify(call.options.env ?? {}).includes(password), false);
  }
  assert.deepEqual(
    calls.map((call) => call.options.input),
    [undefined, PASSWORD, undefined],
  );
});

test("the AWS profile is given to aws only", async () => {
  const { run, calls } = recordCommands(withPassword);
  const builder = createEcrImageBuilder({ run, target: EKS, awsProfile: "build", timeoutMs });

  await builder.build(FOLDER, EKS_IMAGE);
  await builder.publish(EKS_IMAGE);

  assert.deepEqual(
    calls.map((call) => [call.program, call.args[0], call.options.env]),
    [
      ["docker", "build", undefined],
      ["aws", "ecr", { AWS_PROFILE: "build" }],
      ["docker", "login", undefined],
      ["docker", "push", undefined],
    ],
  );
});

test("an empty AWS profile counts as none", async () => {
  const { run, calls } = recordCommands(withPassword);
  const builder = createEcrImageBuilder({ run, target: EKS, awsProfile: "", timeoutMs });

  await builder.publish(EKS_IMAGE);

  assert.deepEqual(calls[0]?.options, { timeoutMs, secretOutput: true });
});

test("for EKS, a step that fails passes its error on unchanged and the steps after it do not run", async () => {
  const failure = new CommandFailedError('"docker login" failed: 403 Forbidden');
  const { run, calls } = recordCommands((call) => {
    if (call.args[0] === "login") {
      throw failure;
    }
    return withPassword(call);
  });
  const builder = createEcrImageBuilder({ run, target: EKS, timeoutMs });

  await assert.rejects(builder.publish(EKS_IMAGE), (error) => error === failure);

  assert.deepEqual(
    calls.map((call) => `${call.program} ${call.args[0]}`),
    ["aws ecr", "docker login"],
  );
});
