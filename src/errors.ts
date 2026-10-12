/**
 * Errors the user is meant to read.
 *
 * The message of an AppError is always a complete, plain sentence that is safe to
 * show in the chat. Any other error is a bug: the user gets a generic message and
 * the details go to the server log.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The cluster did not answer, or it rejected the kubeconfig credentials. */
export class ClusterUnreachableError extends AppError {}

/** A namespace, deployment or other object does not exist. */
export class NotFoundError extends AppError {
  /** What was missing, as Kubernetes names it: "deployments", "namespaces", ... */
  kind: string;

  constructor(message: string, kind: string) {
    super(message);
    this.kind = kind;
  }
}

/** Kubernetes RBAC does not allow the assistant to do this. */
export class ForbiddenError extends AppError {}

/** metrics-server is missing or not ready, so there are no CPU and memory numbers. */
export class MetricsUnavailableError extends AppError {}

/** The request itself cannot be carried out as asked, for example an image without a version. */
export class InvalidRequestError extends AppError {}

/** Another change to the same environment is still running. */
export class DeployInProgressError extends AppError {}
