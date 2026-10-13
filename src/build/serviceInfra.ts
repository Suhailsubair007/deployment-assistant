import {
  DEFAULT_OWNER,
  SERVICE_STACK_FOLDER,
  SERVICE_STATE_FOLDER,
  STATE_BUCKET_PREFIX,
} from "@/constants/build.ts";
import { CommandFailedError } from "@/errors.ts";
import type { CommandOptions, ServiceInfra, TerraformServiceInfraDeps } from "@/types/build.ts";

/**
 * Creates what a service needs outside the cluster (its image repository on AWS) by
 * running the Terraform stack in terraform/service. Every service has a state file of
 * its own in the state bucket, so running it again for the same service changes nothing.
 */
export function createTerraformServiceInfra(deps: TerraformServiceInfraDeps): ServiceInfra {
  const { run, target, awsProfile, timeoutMs } = deps;
  // "||" and not "??": a setting left empty in .env counts as not set.
  const stackFolder = deps.stackFolder || SERVICE_STACK_FOLDER;
  const stateBucket = deps.stateBucket || `${STATE_BUCKET_PREFIX}-${target.account}-${target.region}`;
  const owner = deps.owner || DEFAULT_OWNER;

  // aws and Terraform are both told which AWS profile to use, when one was given.
  const profile: Record<string, string> = awsProfile ? { AWS_PROFILE: awsProfile } : {};
  const awsOptions: CommandOptions = awsProfile ? { timeoutMs, env: profile } : { timeoutMs };
  // TF_IN_AUTOMATION tells Terraform that no person is reading along, so it leaves out its "next, run ..." hints.
  const terraformOptions: CommandOptions = { timeoutMs, env: { ...profile, TF_IN_AUTOMATION: "1" } };

  /** Stops with a readable sentence when there is no AWS login, or when it is a login for another account. */
  async function checkLogin(): Promise<void> {
    let account: string;
    try {
      // Asks AWS who is logged in, and prints only the account number.
      const whoAmI = ["sts", "get-caller-identity", "--query", "Account", "--output", "text"];
      account = (await run("aws", whoAmI, awsOptions)).trim();
    } catch (error) {
      const login = awsProfile ? `aws sso login --profile ${awsProfile}` : "aws sso login";
      // What aws itself said goes to the server log.
      const detail = error instanceof CommandFailedError ? `${error.message}\n${error.output}` : String(error);
      throw new CommandFailedError(
        `Your AWS login is missing or has expired. Run "${login}" in a terminal, then try again.`,
        detail,
      );
    }
    if (account !== target.account) {
      throw new CommandFailedError(
        `Your AWS login belongs to account ${account}, but the cluster is in account ${target.account}, ` +
          "so nothing was created.",
      );
    }
  }

  async function runTerraform(service: string): Promise<void> {
    await checkLogin();

    // -reconfigure: forget the state file of the service before this one and point at this service's.
    await run(
      "terraform",
      [
        `-chdir=${stackFolder}`,
        "init",
        "-input=false",
        "-no-color",
        "-reconfigure",
        `-backend-config=bucket=${stateBucket}`,
        `-backend-config=key=${SERVICE_STATE_FOLDER}/${target.cluster}/${service}/terraform.tfstate`,
        `-backend-config=region=${target.region}`,
        // The same two settings as terraform/envs/*.backend.hcl: a lock file next to the state, and encryption.
        "-backend-config=use_lockfile=true",
        "-backend-config=encrypt=true",
      ],
      terraformOptions,
    );

    await run(
      "terraform",
      [
        `-chdir=${stackFolder}`,
        "apply",
        "-input=false",
        // Nobody can answer Terraform's "yes/no" here. The user already confirmed in the chat.
        "-auto-approve",
        "-no-color",
        // Wait up to a minute when someone else holds the lock on this state file.
        "-lock-timeout=60s",
        "-var",
        `region=${target.region}`,
        "-var",
        `cluster_name=${target.cluster}`,
        "-var",
        `service_name=${service}`,
        "-var",
        `owner=${owner}`,
      ],
      terraformOptions,
    );
  }

  /** The run before this one. A new run starts only when it has ended. */
  let previous: Promise<void> = Promise.resolve();

  return {
    ensure(service) {
      // One run at a time. The stack folder remembers which state file it points at,
      // so two runs side by side would mix up the state of two services.
      const thisRun = previous.then(() => runTerraform(service));
      // The caller of this run hears about its failure; the run after it starts anyway.
      previous = thisRun.catch(() => {});
      return thisRun;
    },
  };
}
