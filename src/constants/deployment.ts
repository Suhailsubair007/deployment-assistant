import { join } from "node:path";

import type { OperationStage } from "@/types/deployment.ts";

// A new pod in one of these states will not recover by waiting, so the rollout stops early.
export const GIVE_UP_REASONS = new Set(["ImagePullBackOff", "InvalidImageName", "CrashLoopBackOff"]);

export const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS deployments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The cluster the change was made on, by its name in the kubeconfig. One file can
    -- hold the history of several clusters, and each cluster sees only its own rows.
    cluster        TEXT NOT NULL,
    environment    TEXT NOT NULL,
    app            TEXT NOT NULL,
    action         TEXT NOT NULL,
    image          TEXT NOT NULL,
    previous_image TEXT,
    replicas       INTEGER NOT NULL,
    status         TEXT NOT NULL,
    requested_by   TEXT NOT NULL,
    message        TEXT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT
  );

  -- The lock: the database itself refuses a second row with status 'in_progress' for the
  -- same environment of the same cluster, even if two requests arrive in the same instant.
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_deployment_per_cluster_environment
    ON deployments (cluster, environment) WHERE status = 'in_progress';

  -- The lock of history files written before the cluster was recorded. It would block
  -- staging on one cluster while staging on another is changing.
  DROP INDEX IF EXISTS one_active_deployment_per_environment;
`;

// A history file written before the cluster was recorded gets the column added.
export const ADD_CLUSTER_COLUMN = "ALTER TABLE deployments ADD COLUMN cluster TEXT NOT NULL DEFAULT ''";

/** The port of the Service. The Service forwards it to the app's own port. */
export const SERVICE_PORT = 80;

export const TEMPLATE_FOLDER = join(import.meta.dirname, "../../k8s/templates");

// Kubernetes names: lowercase letters, digits and dashes, at most 63 characters.
export const APP_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Image repository, optionally with a registry: "sample-app", "localhost:5000/team/sample-app".
export const IMAGE_REPOSITORY_PATTERN = /^[a-z0-9]+(?:[._\-/:][a-z0-9]+)*$/;

// Image version (tag): "v2", "1.4.0", "2026-10-12_build7".
export const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export const MAX_KEPT_OPERATIONS = 200;

// How each stage of a change that builds an image is named when it fails: "failed while building the image".
export const STAGE_WORDS: Record<OperationStage, string> = {
  repository: "preparing the image repository",
  build: "building the image",
  publish: "uploading the image",
  pods: "starting the pods",
};
