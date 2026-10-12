// Decides what a failed request tells the user.
//
// An AppError already carries a sentence written for the user, so it is passed on.
// Anything else is a bug: the user gets a short message with a reference number,
// and the full error (with its stack trace) goes to the server log under that number.

import { randomUUID } from "node:crypto";

import { ConfigError } from "../config.ts";
import {
  AppError,
  ClusterUnreachableError,
  DeployInProgressError,
  ForbiddenError,
  MetricsUnavailableError,
  NotFoundError,
} from "../errors.ts";

export interface UserError {
  /** HTTP status code for the response. */
  status: number;
  message: string;
}

export type ErrorLogger = (...parts: unknown[]) => void;

function httpStatusFor(error: AppError): number {
  if (error instanceof ForbiddenError) {
    return 403;
  }
  if (error instanceof NotFoundError) {
    return 404;
  }
  if (error instanceof DeployInProgressError) {
    return 409;
  }
  if (error instanceof ClusterUnreachableError || error instanceof MetricsUnavailableError) {
    return 503;
  }
  // InvalidRequestError and everything else the user can correct.
  return 400;
}

export function toUserError(error: unknown, log: ErrorLogger = console.error): UserError {
  if (error instanceof AppError) {
    return { status: httpStatusFor(error), message: error.message };
  }
  if (error instanceof ConfigError) {
    return { status: 500, message: error.message };
  }
  // Express reports a request body it could not parse with this type.
  if ((error as { type?: unknown } | null)?.type === "entity.parse.failed") {
    return { status: 400, message: "The request body is not valid JSON." };
  }

  const reference = randomUUID().slice(0, 8);
  log(`Unexpected error (reference ${reference}):`, error);
  return {
    status: 500,
    message: `Something went wrong on the server (reference ${reference}). The details are in the server log.`,
  };
}
