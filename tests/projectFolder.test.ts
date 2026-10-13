import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inspectFolder } from "@/build/projectFolder.ts";
import { InvalidRequestError } from "@/errors.ts";

/**
 * Makes a fresh pretend home folder with one project in it, and a folder next to it
 * that is outside the home folder:
 *
 *   <temp>/home/code/orders-api/Dockerfile
 *   <temp>/outside/Dockerfile
 */
function makeHome(): { home: string; outside: string } {
  const temp = mkdtempSync(join(tmpdir(), "assistant-folder-"));
  const home = join(temp, "home");
  const outside = join(temp, "outside");
  makeProject(join(home, "code", "orders-api"), "FROM node:24\nEXPOSE 3000\n");
  makeProject(outside, "FROM node:24\n");
  return { home, outside };
}

/** Makes a folder with a Dockerfile in it. */
function makeProject(folder: string, dockerfile: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "Dockerfile"), dockerfile);
}

// ---- A folder that can be built ----

test('"~" stands for the home folder, and the answer holds the full path', () => {
  const { home } = makeHome();

  const info = inspectFolder("~/code/orders-api", ["~"], home);

  assert.deepEqual(info, {
    // The temp folder itself may be reached through a link, so compare with the resolved path.
    folder: realpathSync(join(home, "code", "orders-api")),
    port: 3000,
    suggestedName: "orders-api",
  });
});

test("a path that starts with / works too, and spaces around it are ignored", () => {
  const { home } = makeHome();

  const info = inspectFolder(`  ${join(home, "code", "orders-api")}  `, ["~"], home);

  assert.equal(info.folder, realpathSync(join(home, "code", "orders-api")));
});

test("a folder inside any one of several allowed folders is accepted", () => {
  const { home } = makeHome();
  makeProject(join(home, "work", "billing"), "FROM node:24\n");

  const info = inspectFolder("~/work/billing", ["~/code", "~/work"], home);

  assert.equal(info.suggestedName, "billing");
});

test("an allowed folder that does not exist on this machine is skipped", () => {
  const { home } = makeHome();

  const info = inspectFolder("~/code/orders-api", ["/no/such/folder", "~"], home);

  assert.equal(info.suggestedName, "orders-api");
});

test("a link inside the home folder to a project inside the home folder gives the real folder", () => {
  const { home } = makeHome();
  symlinkSync(join(home, "code", "orders-api"), join(home, "current"));

  const info = inspectFolder("~/current", ["~"], home);

  assert.equal(info.folder, realpathSync(join(home, "code", "orders-api")));
  assert.equal(info.suggestedName, "orders-api");
});

// ---- Folders that are refused ----

test("a path that does not start with / or ~ is refused", () => {
  const { home } = makeHome();

  assert.throws(
    () => inspectFolder("code/orders-api", ["~"], home),
    new InvalidRequestError("Give the full path of the folder, starting with / or ~."),
  );
});

test("a path that does not exist is refused", () => {
  const { home } = makeHome();

  assert.throws(
    () => inspectFolder("~/code/nothing-here", ["~"], home),
    new InvalidRequestError("I can't find a folder at ~/code/nothing-here."),
  );
});

test("a file is refused", () => {
  const { home } = makeHome();

  assert.throws(
    () => inspectFolder("~/code/orders-api/Dockerfile", ["~"], home),
    new InvalidRequestError("~/code/orders-api/Dockerfile is a file, not a folder."),
  );
});

test("the allowed folder itself is refused", () => {
  const { home } = makeHome();
  writeFileSync(join(home, "Dockerfile"), "FROM node:24\n");

  assert.throws(
    () => inspectFolder("~", ["~"], home),
    new InvalidRequestError("I only build projects inside ~, not ~ itself."),
  );
});

test('a path that leaves the home folder with ".." is refused', () => {
  const { home } = makeHome();

  assert.throws(
    () => inspectFolder("~/code/../../outside", ["~"], home),
    new InvalidRequestError("I only build projects inside ~. ~/code/../../outside is outside it."),
  );
});

test("a link inside the home folder that points outside it is refused", () => {
  const { home, outside } = makeHome();
  symlinkSync(outside, join(home, "code", "shortcut"));

  assert.throws(
    () => inspectFolder("~/code/shortcut", ["~"], home),
    new InvalidRequestError("I only build projects inside ~. ~/code/shortcut is outside it."),
  );
});

test("a folder whose name only starts like the allowed folder is refused", () => {
  const { home } = makeHome();
  makeProject(join(home, "code-evil", "app"), "FROM node:24\n");

  assert.throws(
    () => inspectFolder("~/code-evil/app", ["~/code"], home),
    new InvalidRequestError("I only build projects inside ~/code. ~/code-evil/app is outside it."),
  );
});

test("a refusal names every allowed folder", () => {
  const { home, outside } = makeHome();
  mkdirSync(join(home, "work"));

  assert.throws(
    () => inspectFolder(outside, ["~/code", "~/work"], home),
    new InvalidRequestError(`I only build projects inside ~/code or ~/work. ${outside} is outside them.`),
  );
});

test("a folder without a Dockerfile is refused", () => {
  const { home } = makeHome();
  mkdirSync(join(home, "code", "empty"));

  assert.throws(
    () => inspectFolder("~/code/empty", ["~"], home),
    new InvalidRequestError("~/code/empty has no Dockerfile. I don't write one; add it and give the path again."),
  );
});

test("a folder named Dockerfile does not count as a Dockerfile", () => {
  const { home } = makeHome();
  mkdirSync(join(home, "code", "odd", "Dockerfile"), { recursive: true });

  assert.throws(
    () => inspectFolder("~/code/odd", ["~"], home),
    new InvalidRequestError("~/code/odd has no Dockerfile. I don't write one; add it and give the path again."),
  );
});

// ---- The port from the Dockerfile ----

const dockerfiles: [what: string, dockerfile: string, port: number | null][] = [
  ["a plain EXPOSE line", "FROM node:24\nEXPOSE 3000\nCMD node server.js\n", 3000],
  ["a port written with its protocol", "FROM node:24\nEXPOSE 3000/tcp\n", 3000],
  ["expose in small letters", "from node:24\nexpose 8081\n", 8081],
  ["several EXPOSE lines, where the first one counts", "FROM node:24\nEXPOSE 4000\nEXPOSE 5000\n", 4000],
  ["an EXPOSE line without a number, which is skipped", "FROM node:24\nEXPOSE $PORT\nEXPOSE 7000\n", 7000],
  ["an EXPOSE line that is commented out", "FROM node:24\n# EXPOSE 9999\n", null],
  ["no EXPOSE line", "FROM node:24\nCMD node server.js\n", null],
];
for (const [what, dockerfile, port] of dockerfiles) {
  test(`a Dockerfile with ${what} gives port ${port}`, () => {
    const { home } = makeHome();
    makeProject(join(home, "code", "app"), dockerfile);

    assert.equal(inspectFolder("~/code/app", ["~"], home).port, port);
  });
}

// ---- The suggested name ----

const folderNames: [folderName: string, suggestedName: string | null][] = [
  ["My App_2", "my-app-2"],
  ["--Orders.API--", "orders-api"],
  ["2fast", null], // a name must start with a letter
  ["___", null], // nothing usable is left
  // Cut to 40 characters.
  ["a-very-long-folder-name-that-goes-on-and-on-and-on", "a-very-long-folder-name-that-goes-on-and"],
  // Here the 40th character is a dash, and a name may not end with one.
  ["the-orders-api-of-the-warehouse-team-in-berlin", "the-orders-api-of-the-warehouse-team-in"],
];
for (const [folderName, suggestedName] of folderNames) {
  test(`a folder called "${folderName}" suggests the name ${suggestedName}`, () => {
    const { home } = makeHome();
    makeProject(join(home, "code", folderName), "FROM node:24\n");

    assert.equal(inspectFolder(`~/code/${folderName}`, ["~"], home).suggestedName, suggestedName);
  });
}
