import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCapabilities } from "@/lib/capabilities.ts";

test("the cards use the first app and environment in their requests", () => {
  const cards = buildCapabilities([
    { environment: "staging", app: "sample-app" },
    { environment: "prod", app: "sample-app" },
  ]);

  assert.deepEqual(
    cards.map((card) => card.example),
    [
      "create a service",
      "deploy sample-app version v2 to staging",
      "is sample-app healthy in staging?",
      "roll back sample-app in staging",
      "scale sample-app to 3 replicas in staging",
      "how much cpu and memory is sample-app using in staging?",
      "change the settings of sample-app in staging",
      "show my last 5 deployments",
    ],
  );
});

test("without names no request says undefined", () => {
  for (const card of buildCapabilities([])) {
    assert.ok(!card.example.includes("undefined"), card.example);
  }
});

test("every card has its own icon", () => {
  const icons = buildCapabilities([]).map((card) => card.icon);
  assert.equal(new Set(icons).size, icons.length);
});
