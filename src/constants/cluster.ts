export const KIND_NAMES: Record<string, string> = {
  deployments: "Deployment",
  services: "Service",
  namespaces: "Namespace",
  pods: "Pod",
  nodes: "Node",
};

// Codes Node reports when a server cannot be reached at all.
export const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);
