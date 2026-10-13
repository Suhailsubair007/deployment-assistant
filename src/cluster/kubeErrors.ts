import { KIND_NAMES, NETWORK_ERROR_CODES } from "@/constants/cluster.ts";
import { AppError, ClusterUnreachableError, ForbiddenError, NotFoundError } from "@/errors.ts";
import type { CallContext, KubernetesStatus } from "@/types/cluster.ts";

/** The body of a Kubernetes error arrives as an object or as JSON text. */
function readStatus(body: unknown): KubernetesStatus {
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null ? (parsed as KubernetesStatus) : { message: body };
    } catch {
      return { message: body };
    }
  }
  if (typeof body === "object" && body !== null) {
    return body as KubernetesStatus;
  }
  return {};
}

/** The HTTP status Kubernetes answered with, or null when the error is not a Kubernetes answer. */
export function httpStatusOf(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/** True when the request never got an answer: wrong address, cluster stopped, network down. */
function isNetworkFailure(error: Error): boolean {
  if (error.message === "fetch failed") {
    return true;
  }
  // The real reason is often wrapped: error.cause, then that error's cause, and so on.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** Turns an error thrown by the Kubernetes library into one the user can read. */
export function toAppError(error: unknown, where: CallContext): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  if (error instanceof AppError) {
    return error;
  }

  const inNamespace = where.namespace ? ` in namespace ${where.namespace}` : "";

  // Kubernetes' own explanation of a failed call is in `body`.
  const httpStatus = httpStatusOf(error);
  if (httpStatus !== null) {
    const status = readStatus((error as { body?: unknown }).body);

    if (httpStatus === 404) {
      const kind = status.details?.kind ?? "";
      const name = status.details?.name ?? "";
      if (kind === "namespaces") {
        return new NotFoundError(`Namespace "${name}" does not exist in this cluster.`, kind);
      }
      if (kind !== "" && name !== "") {
        const kindName = KIND_NAMES[kind] ?? kind;
        return new NotFoundError(`${kindName} "${name}" was not found${inNamespace}.`, kind);
      }
      return new NotFoundError(`Kubernetes could not find what it needs to ${where.action}${inNamespace}.`, kind);
    }

    if (httpStatus === 403) {
      const said = status.message ? ` Kubernetes said: ${status.message}` : "";
      return new ForbiddenError(`The assistant is not allowed to ${where.action}${inNamespace}.${said}`);
    }

    if (httpStatus === 401) {
      return new ClusterUnreachableError(
        `The cluster rejected the credentials for context "${where.context}". Refresh them and try again.`,
      );
    }

    return new AppError(`Kubernetes refused to ${where.action}: ${status.message ?? `HTTP status ${httpStatus}`}`);
  }

  if (isNetworkFailure(error)) {
    return new ClusterUnreachableError(
      `I can't reach the cluster (context "${where.context}"). Check that it is running and that your kubeconfig context is right.`,
    );
  }

  return error;
}
