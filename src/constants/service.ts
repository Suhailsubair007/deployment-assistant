export const SERVICES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS services (
    -- Like the history, the services are kept per cluster.
    cluster     TEXT NOT NULL,
    environment TEXT NOT NULL,
    name        TEXT NOT NULL,
    -- The settings (port, CPU, memory, variables, ...) as one JSON text.
    spec        TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (cluster, environment, name)
  );
`;

/** The health check path of an app from the config file. */
export const DEFAULT_HEALTH_PATH = "/health";

// A URL path made of plain characters, so it is safe to place in the manifest template.
export const HEALTH_PATH_PATTERN = /^\/[A-Za-z0-9/._~-]*$/;

// Variable names as a shell accepts them: letters, digits and underscores, not starting with a digit.
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
