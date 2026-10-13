import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSuggestions } from "@/lib/suggestions.ts";

test("examples use the first environment and its app, and the last environment", () => {
  const examples = buildSuggestions([
    { environment: "staging", app: "sample-app" },
    { environment: "prod", app: "sample-app" },
  ]);

  assert.deepEqual(examples, [
    "deploy sample-app version v2 to staging",
    "is staging healthy?",
    "how much cpu and ram is staging using?",
    "how are the nodes doing?",
    "full status of prod",
    "show my last 5 deployments",
  ]);
});

test("with one environment every example is about that one", () => {
  const examples = buildSuggestions([{ environment: "qa", app: "billing" }]);

  assert.equal(examples[0], "deploy billing version v2 to qa");
  assert.equal(examples[4], "full status of qa");
});

test("no environments, no examples", () => {
  assert.deepEqual(buildSuggestions([]), []);
});
