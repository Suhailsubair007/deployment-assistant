/** Errors the user is meant to read. */
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

/** A program the assistant ran (docker, kind, aws, terraform) was missing, failed or took too long. */
export class CommandFailedError extends AppError {
  /** The last lines the program printed, for the server log. */
  output: string;

  constructor(message: string, output = "") {
    super(message);
    this.output = output;
  }
}

/** OpenAI could not read a chat message: the call failed, or its answer was not usable. */
export class ModelUnavailableError extends AppError {
  /** The technical reason, for the server log only. */
  detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.detail = detail;
  }
}
