import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { formatStartupBanner, formatStartupError } from "@/startupBanner.ts";
import type { StartupFacts } from "@/types/server.ts";

const FACTS: StartupFacts = {
  url: "http://127.0.0.1:3000",
  context: "kind-deploy-assistant",
  environments: ["staging", "prod"],
  reader: "Messages are read by built-in rules.",
  warnings: [],
};

/** The banner as lines of plain text. Colours are removed: a test run may or may not have them. */
function linesOf(facts: StartupFacts): string[] {
  return stripVTControlCharacters(formatStartupBanner(facts)).split("\n");
}

test("the banner starts with the title", () => {
  assert.equal(linesOf(FACTS)[1], "  Deployment Assistant is running");
});

test("the banner has one line per fact, with the values lined up", () => {
  assert.deepEqual(linesOf(FACTS).slice(3, 6), [
    "  ➜  Local:               http://127.0.0.1:3000",
    "  ➜  Kubernetes context:  kind-deploy-assistant",
    "  ➜  Environments:        staging, prod",
  ]);
});

test("the banner says who reads the messages", () => {
  assert.ok(linesOf(FACTS).includes("  ℹ  Messages are read by built-in rules."));
});

test("without a warning the banner ends after the note", () => {
  assert.deepEqual(linesOf(FACTS).slice(-2), ["  ℹ  Messages are read by built-in rules.", ""]);
});

test("each warning gets a line of its own, after the note", () => {
  const lines = linesOf({ ...FACTS, warnings: ["The page is not built yet.", "2 deployment(s) were left unfinished."] });
  assert.deepEqual(lines.slice(-3), ["  ⚠  The page is not built yet.", "  ⚠  2 deployment(s) were left unfinished.", ""]);
});

test("a startup error is one marked line", () => {
  assert.equal(stripVTControlCharacters(formatStartupError("config/app.config.yaml was not found")).trim(), "✖  config/app.config.yaml was not found");
});
