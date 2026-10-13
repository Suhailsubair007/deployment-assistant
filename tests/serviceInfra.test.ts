import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { createTerraformServiceInfra } from "@/build/serviceInfra.ts";
import { CommandFailedError } from "@/errors.ts";
import type { EksTarget } from "@/types/build.ts";
import { recordCommands } from "./helpers/fakeBuildTools.ts";
import type { RecordedCommand } from "./helpers/fakeBuildTools.ts";

const timeoutMs = 900_000;

const EKS: EksTarget = {
  kind: "eks",
  region: "ap-south-1",
  account: "123456789012",
  cluster: "deployment-assistant-staging",
  registry: "123456789012.dkr.ecr.ap-south-1.amazonaws.com/deployment-assistant-staging",
};

/** Plays an AWS login for the cluster's own account; Terraform prints nothing. */
function loggedIn(call: RecordedCommand): string {
  return call.program === "aws" ? `${EKS.account}\n` : "";
}

/** The Terraform calls as short text: "init orders-api", "apply orders-api". */
function terraformSteps(calls: RecordedCommand[]): string[] {
  return calls
    .filter((call) => call.program === "terraform")
    .map((call) => {
      const service = call.args.join(" ").includes("orders-api") ? "orders-api" : "billing";
      return `${call.args[1]} ${service}`;
    });
}

/** Lets everything else that is waiting run first, the way a real program takes a while. */
function aMoment(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("ensure checks the AWS login, points Terraform at the service's state and applies the stack", async () => {
  const { run, calls } = recordCommands(loggedIn);
  const infra = createTerraformServiceInfra({
    run,
    target: EKS,
    stateBucket: "my-state-bucket",
    owner: "asha",
    stackFolder: "/repo/terraform/service",
    timeoutMs,
  });

  await infra.ensure("orders-api");

  const terraformOptions = { timeoutMs, env: { TF_IN_AUTOMATION: "1" } };
  assert.deepEqual(calls, [
    {
      program: "aws",
      args: ["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
      options: { timeoutMs },
    },
    {
      program: "terraform",
      args: [
        "-chdir=/repo/terraform/service",
        "init",
        "-input=false",
        "-no-color",
        "-reconfigure",
        "-backend-config=bucket=my-state-bucket",
        "-backend-config=key=deployment-assistant/services/deployment-assistant-staging/orders-api/terraform.tfstate",
        "-backend-config=region=ap-south-1",
        "-backend-config=use_lockfile=true",
        "-backend-config=encrypt=true",
      ],
      options: terraformOptions,
    },
    {
      program: "terraform",
      args: [
        "-chdir=/repo/terraform/service",
        "apply",
        "-input=false",
        "-auto-approve",
        "-no-color",
        "-lock-timeout=60s",
        "-var",
        "region=ap-south-1",
        "-var",
        "cluster_name=deployment-assistant-staging",
        "-var",
        "service_name=orders-api",
        "-var",
        "owner=asha",
      ],
      options: terraformOptions,
    },
  ]);
});

test("every service has a state file of its own", async () => {
  const { run, calls } = recordCommands(loggedIn);
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await infra.ensure("orders-api");
  await infra.ensure("billing");

  const keys = calls.flatMap((call) => call.args).filter((arg) => arg.startsWith("-backend-config=key="));
  assert.deepEqual(keys, [
    "-backend-config=key=deployment-assistant/services/deployment-assistant-staging/orders-api/terraform.tfstate",
    "-backend-config=key=deployment-assistant/services/deployment-assistant-staging/billing/terraform.tfstate",
  ]);
});

test("without settings, the bucket is the one the bootstrap stack made, the owner is the assistant and the stack is terraform/service", async () => {
  const { run, calls } = recordCommands(loggedIn);
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await infra.ensure("orders-api");

  const [, init, apply] = calls;
  const stackFolder = join(import.meta.dirname, "..", "terraform", "service");
  assert.equal(init?.args[0], `-chdir=${stackFolder}`);
  assert.equal(apply?.args[0], `-chdir=${stackFolder}`);
  assert.ok(init?.args.includes("-backend-config=bucket=deployment-assistant-tfstate-123456789012-ap-south-1"));
  assert.equal(apply?.args.at(-1), "owner=deployment-assistant");
});

test("an empty bucket or owner setting counts as not set", async () => {
  const { run, calls } = recordCommands(loggedIn);
  const infra = createTerraformServiceInfra({ run, target: EKS, stateBucket: "", owner: "", awsProfile: "", timeoutMs });

  await infra.ensure("orders-api");

  const [login, init, apply] = calls;
  assert.deepEqual(login?.options, { timeoutMs });
  assert.ok(init?.args.includes("-backend-config=bucket=deployment-assistant-tfstate-123456789012-ap-south-1"));
  assert.equal(apply?.args.at(-1), "owner=deployment-assistant");
});

test("the AWS profile is given to aws and to Terraform", async () => {
  const { run, calls } = recordCommands(loggedIn);
  const infra = createTerraformServiceInfra({ run, target: EKS, awsProfile: "build", timeoutMs });

  await infra.ensure("orders-api");

  assert.deepEqual(
    calls.map((call) => call.options),
    [
      { timeoutMs, env: { AWS_PROFILE: "build" } },
      { timeoutMs, env: { AWS_PROFILE: "build", TF_IN_AUTOMATION: "1" } },
      { timeoutMs, env: { AWS_PROFILE: "build", TF_IN_AUTOMATION: "1" } },
    ],
  );
});

test("a login for another AWS account stops before Terraform runs", async () => {
  const { run, calls } = recordCommands((call) => (call.program === "aws" ? "999999999999\n" : ""));
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await assert.rejects(
    infra.ensure("orders-api"),
    new CommandFailedError(
      "Your AWS login belongs to account 999999999999, but the cluster is in account 123456789012, so nothing was created.",
    ),
  );

  assert.deepEqual(terraformSteps(calls), []);
});

test("an expired AWS login says how to log in again, with the profile", async () => {
  const { run, calls } = recordCommands(() => {
    throw new CommandFailedError('"aws sts" failed: Token has expired and refresh failed', "Token has expired and refresh failed\n");
  });
  const infra = createTerraformServiceInfra({ run, target: EKS, awsProfile: "build", timeoutMs });

  const failure = infra.ensure("orders-api");

  await assert.rejects(failure, (error) => {
    assert.ok(error instanceof CommandFailedError);
    assert.equal(
      error.message,
      'Your AWS login is missing or has expired. Run "aws sso login --profile build" in a terminal, then try again.',
    );
    // What aws itself said is kept for the server log.
    assert.ok(error.output.includes("Token has expired and refresh failed"));
    return true;
  });
  assert.deepEqual(terraformSteps(calls), []);
});

test("without a profile, the sentence about logging in again leaves the profile out", async () => {
  const { run } = recordCommands(() => {
    throw new CommandFailedError('"aws sts" failed: Unable to locate credentials');
  });
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await assert.rejects(infra.ensure("orders-api"), {
    message: 'Your AWS login is missing or has expired. Run "aws sso login" in a terminal, then try again.',
  });
});

test("a Terraform step that fails passes its error on unchanged, and apply does not run after a failed init", async () => {
  const failure = new CommandFailedError('"terraform init" failed: Error: Failed to get existing workspaces');
  const { run, calls } = recordCommands((call) => {
    if (call.args[1] === "init") {
      throw failure;
    }
    return loggedIn(call);
  });
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await assert.rejects(infra.ensure("orders-api"), (error) => error === failure);

  assert.deepEqual(terraformSteps(calls), ["init orders-api"]);
});

test("two services asked for at the same moment are done one after the other", async () => {
  const { run, calls } = recordCommands(async (call) => {
    // Every command takes a moment, so a second run would get in between if it were allowed to.
    await aMoment();
    return loggedIn(call);
  });
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  await Promise.all([infra.ensure("orders-api"), infra.ensure("billing")]);

  assert.deepEqual(terraformSteps(calls), ["init orders-api", "apply orders-api", "init billing", "apply billing"]);
});

test("a run that failed does not block the next one", async () => {
  const failure = new CommandFailedError('"terraform apply" failed: Error: AccessDenied');
  let failedOnce = false;
  const { run, calls } = recordCommands(async (call) => {
    await aMoment();
    if (call.args[1] === "apply" && !failedOnce) {
      failedOnce = true;
      throw failure;
    }
    return loggedIn(call);
  });
  const infra = createTerraformServiceInfra({ run, target: EKS, timeoutMs });

  const first = infra.ensure("orders-api");
  const second = infra.ensure("billing");

  await assert.rejects(first, (error) => error === failure);
  await second;
  assert.deepEqual(terraformSteps(calls), ["init orders-api", "apply orders-api", "init billing", "apply billing"]);
});
