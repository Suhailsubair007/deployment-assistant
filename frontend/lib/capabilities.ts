// What the assistant can do, shown as cards to click: on the welcome screen and in a reply that could not help.

/** Which picture a card shows. The card component turns it into an icon. */
export type CapabilityIcon = "create" | "deploy" | "rollback" | "scale" | "health" | "usage" | "edit" | "history";

export interface Capability {
  icon: CapabilityIcon;
  /** What the user gets, in everyday words. */
  title: string;
  /** One short line that explains it. */
  description: string;
  /** The request a click puts in the message box. */
  example: string;
}

/** The cards, with requests that use this cluster's first app and environment. */
export function buildCapabilities(environments: { environment: string; app: string }[]): Capability[] {
  const first = environments[0];
  // Without names the requests still work: the assistant asks which app and environment.
  const app = first === undefined ? "" : ` ${first.app}`;
  const where = first === undefined ? "" : ` in ${first.environment}`;
  const to = first === undefined ? "" : ` to ${first.environment}`;
  return [
    {
      icon: "create",
      title: "Put a new app online",
      description: "Turn a project folder on your computer into a running service.",
      example: "create a service",
    },
    {
      icon: "deploy",
      title: "Release a new version",
      description: "Ship a newer version of an app.",
      example: `deploy${app} version v2${to}`,
    },
    {
      icon: "health",
      title: "Check that it works",
      description: "See if an app is up and healthy.",
      example: `is${app} healthy${where}?`,
    },
    {
      icon: "rollback",
      title: "Undo a release",
      description: "Go back to the version that ran before.",
      example: `roll back${app}${where}`,
    },
    {
      icon: "scale",
      title: "Handle more visitors",
      description: "Run more or fewer copies of an app.",
      example: `scale${app} to 3 replicas${where}`,
    },
    {
      icon: "usage",
      title: "See CPU and memory",
      description: "How much computer power an app is using.",
      example: `how much cpu and memory is${app} using${where}?`,
    },
    {
      icon: "edit",
      title: "Change settings",
      description: "Memory, CPU, port, health check or variables.",
      example: `change the settings of${app}${where}`,
    },
    {
      icon: "history",
      title: "See past releases",
      description: "What was deployed, by whom, and when.",
      example: "show my last 5 deployments",
    },
  ];
}
