import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";

import { DOCKERFILE_NAME, EXPOSE_PATTERN, MAX_NAME_LENGTH } from "@/constants/wizard.ts";
import { InvalidRequestError } from "@/errors.ts";
import type { ProjectInfo } from "@/types/build.ts";

/** "~/code/x" -> "/Users/asha/code/x". A path that does not start with "~" comes back as it is. */
function expandHome(path: string, home: string): string {
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }
  return path;
}

/** The allowed folders as full paths with links resolved. One that does not exist on this machine is left out. */
function resolveRoots(allowedRoots: string[], home: string): string[] {
  const roots: string[] = [];
  for (const allowedRoot of allowedRoots) {
    const root = expandHome(allowedRoot.trim(), home);
    if (isAbsolute(root) && existsSync(root)) {
      roots.push(realpathSync(root));
    }
  }
  return roots;
}

/** True when `folder` lies somewhere below `root`. Both are full paths with links resolved. */
function isInside(folder: string, root: string): boolean {
  // The separator keeps "/home/asha-evil" from counting as inside "/home/asha".
  const rootWithSeparator = root.endsWith(sep) ? root : root + sep;
  return folder.startsWith(rootWithSeparator);
}

/** The port of the first "EXPOSE 3000" line, or null when the Dockerfile names none. */
function readExposedPort(dockerfile: string): number | null {
  const match = EXPOSE_PATTERN.exec(dockerfile);
  return match === null ? null : Number(match[1]);
}

/** "My App_2" -> "my-app-2". Null when what is left cannot be a service name. */
function suggestName(folder: string): string | null {
  const name = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // anything else becomes one dash
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^-+|-+$/g, ""); // no dash at the start or the end, also after the cut
  return /^[a-z]/.test(name) ? name : null;
}

/**
 * Checks that `path` is a project folder the assistant may build, and reads what it can
 * from it. Throws InvalidRequestError with a sentence for the user when it is not.
 *
 * @param allowedRoots only folders inside one of these are accepted
 * @param home what "~" stands for; tests pass a temp folder
 */
export function inspectFolder(path: string, allowedRoots: string[], home: string = homedir()): ProjectInfo {
  // `typed` is what the user wrote. It is used in the sentences, so they see their own words.
  const typed = path.trim();
  const expanded = expandHome(typed, home);

  if (!isAbsolute(expanded)) {
    throw new InvalidRequestError("Give the full path of the folder, starting with / or ~.");
  }
  if (!existsSync(expanded)) {
    throw new InvalidRequestError(`I can't find a folder at ${typed}.`);
  }
  if (!statSync(expanded).isDirectory()) {
    throw new InvalidRequestError(`${typed} is a file, not a folder.`);
  }

  // Links and ".." are resolved first. A link inside an allowed folder may point anywhere,
  // so the check below looks at where the folder really is.
  const folder = realpathSync(expanded);
  const roots = resolveRoots(allowedRoots, home);
  const allowed = allowedRoots.join(" or ");
  if (roots.includes(folder)) {
    throw new InvalidRequestError(`I only build projects inside ${allowed}, not ${typed} itself.`);
  }
  if (!roots.some((root) => isInside(folder, root))) {
    const outside = allowedRoots.length === 1 ? "outside it" : "outside them";
    throw new InvalidRequestError(`I only build projects inside ${allowed}. ${typed} is ${outside}.`);
  }

  const dockerfilePath = join(folder, DOCKERFILE_NAME);
  if (!existsSync(dockerfilePath) || !statSync(dockerfilePath).isFile()) {
    throw new InvalidRequestError(
      `${typed} has no ${DOCKERFILE_NAME}. I don't write one; add it and give the path again.`,
    );
  }

  return {
    folder,
    port: readExposedPort(readFileSync(dockerfilePath, "utf8")),
    suggestedName: suggestName(folder),
  };
}
