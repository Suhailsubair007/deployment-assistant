import assert from "node:assert/strict";
import { test } from "node:test";

import { createBuildTools } from "@/build/buildTools.ts";
import { loadConfig } from "@/config.ts";
import { CommandFailedError } from "@/errors.ts";
import type { AppConfig } from "@/types/config.ts";
import { FakeBuildTools, recordCommands } from "./helpers/fakeBuildTools.ts";

const EKS_CLUSTER = "arn:aws:eks:ap-south-1:123456789012:cluster/deployment-assistant-staging";
const EKS_REGISTRY = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging";
const FOLDER = "/Users/asha/code/orders-api";

/** The real config file, with a build timeout of one minute so the test can recognise it. */
function configWithOneMinute(): AppConfig {
  const config = loadConfig("config/app.config.yaml");
  return { ...config, build: { ...config.build, timeoutSeconds: 60 } };
}

test("on a kind cluster, images are built locally and loaded into kind, and nothing is prepared outside the cluster", async () => {
  const { run, calls } = recordCommands();

  const tools = createBuildTools({ clusterName: "kind-deploy-assistant", run, config: configWithOneMinute() });
  await tools.builder?.build(FOLDER, "orders-api:v1");
  await tools.builder?.publish("orders-api:v1");

  assert.equal(tools.registry, "");
  assert.equal(tools.infra, null);
  assert.deepEqual(calls, [
    { program: "docker", args: ["build", "--tag", "orders-api:v1", FOLDER], options: { timeoutMs: 60_000 } },
    {
      program: "kind",
      args: ["load", "docker-image", "orders-api:v1", "--name", "deploy-assistant"],
      options: { timeoutMs: 60_000 },
    },
  ]);
});

test("on an EKS cluster, images go to the cluster's registry and Terraform prepares the repository", async () => {
  const { run, calls } = recordCommands((call) => (call.args[0] === "sts" ? "123456789012\n" : ""));

  const tools = createBuildTools({
    clusterName: EKS_CLUSTER,
    run,
    config: configWithOneMinute(),
    awsProfile: "build",
    stateBucket: "my-state-bucket",
    owner: "asha",
  });
  await tools.infra?.ensure("orders-api");
  await tools.builder?.build(FOLDER, `${EKS_REGISTRY}/orders-api:v1`);
  await tools.builder?.publish(`${EKS_REGISTRY}/orders-api:v1`);

  assert.equal(tools.registry, EKS_REGISTRY);
  assert.deepEqual(
    calls.map((call) => `${call.program} ${call.args.find((arg) => !arg.startsWith("-"))}`),
    ["aws sts", "terraform init", "terraform apply", "docker build", "aws ecr", "docker login", "docker push"],
  );
  // The settings reach the tools that use them.
  const [login, init, apply, build] = calls;
  assert.deepEqual(login?.options, { timeoutMs: 60_000, env: { AWS_PROFILE: "build" } });
  assert.ok(init?.args.includes("-backend-config=bucket=my-state-bucket"));
  assert.equal(apply?.args.at(-1), "owner=asha");
  assert.deepEqual(build?.args.slice(0, 3), ["build", "--platform", "linux/amd64"]);
  for (const call of calls) {
    assert.equal(call.options.timeoutMs, 60_000);
  }
});

test("on any other cluster, the assistant cannot build", () => {
  const { run } = recordCommands();

  const tools = createBuildTools({ clusterName: "docker-desktop", run, config: configWithOneMinute() });

  assert.deepEqual(tools, { registry: "", builder: null, infra: null });
});

// ---- The pretend build tools that other tests use ----

test("the pretend build tools write down every call in order", async () => {
  const tools = new FakeBuildTools({ registry: EKS_REGISTRY, withInfra: true });

  await tools.infra?.ensure("orders-api");
  await tools.builder?.build("/path/to/folder", "orders-api:v1");
  await tools.builder?.publish("orders-api:v1");

  assert.equal(tools.registry, EKS_REGISTRY);
  assert.deepEqual(tools.calls, ["ensure orders-api", "build /path/to/folder orders-api:v1", "publish orders-api:v1"]);
});

test("the pretend build tools behave like kind unless told otherwise", () => {
  const tools = new FakeBuildTools();

  assert.equal(tools.registry, "");
  assert.equal(tools.infra, null);
  assert.notEqual(tools.builder, null);
});

test("failNext makes only the next call of that step fail", async () => {
  const tools = new FakeBuildTools();
  const failure = new CommandFailedError('"docker push" failed: denied');
  tools.failNext("publish", failure);

  await tools.builder?.build("/path/to/folder", "orders-api:v1");
  await assert.rejects(tools.builder?.publish("orders-api:v1") ?? Promise.resolve(), (error) => error === failure);
  await tools.builder?.publish("orders-api:v1");

  assert.deepEqual(tools.calls, ["build /path/to/folder orders-api:v1", "publish orders-api:v1", "publish orders-api:v1"]);
});

test("hold makes the next call of that step wait until it is released", async () => {
  const tools = new FakeBuildTools();
  const release = tools.hold("build");
  let finished = false;

  const building = tools.builder?.build("/path/to/folder", "orders-api:v1").then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  // The call was made, but it is still "running".
  assert.deepEqual(tools.calls, ["build /path/to/folder orders-api:v1"]);
  assert.equal(finished, false);

  release();
  await building;
  assert.equal(finished, true);
});
