// Example requests shown above the message box.

/** A few example requests that use this cluster's own environment and app names. */
export function buildSuggestions(environments: { environment: string; app: string }[]): string[] {
  const first = environments[0];
  const last = environments.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  return [
    `deploy ${first.app} version v2 to ${first.environment}`,
    "create a service",
    `is ${first.environment} healthy?`,
    `how much cpu and ram is ${first.environment} using?`,
    "how are the nodes doing?",
    `full status of ${last.environment}`,
    "show my last 5 deployments",
  ];
}
