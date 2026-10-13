import { join } from "node:path";

/** Reachable from this machine only. */
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 3000;
export const DEFAULT_CONFIG_PATH = "config/app.config.yaml";
export const DEFAULT_DB_PATH = "data/assistant.db";

/** "npm run build" writes the page into this folder. */
export const PAGE_FOLDER = join(import.meta.dirname, "../../frontend/out");
