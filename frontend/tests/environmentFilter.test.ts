import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_FILTER, filterCards, filterChoices, isFiltering, settleFilter } from "@/lib/environment-filter.ts";

const CARDS = [
  { environment: "staging", app: "sample-app" },
  { environment: "staging", app: "greeter-app" },
  { environment: "prod", app: "sample-app" },
  { environment: "prod", app: "counter-app" },
  { environment: "prod", app: "greeter-app" },
];

test("each app is offered once, in alphabetical order", () => {
  assert.deepEqual(filterChoices(CARDS).apps, ["counter-app", "greeter-app", "sample-app"]);
});

test("each environment is offered once, in the order of the cards", () => {
  assert.deepEqual(filterChoices(CARDS).environments, ["staging", "prod"]);
});

test("no cards, nothing to choose from", () => {
  assert.deepEqual(filterChoices([]), { apps: [], environments: [] });
});

test("without a filter every card is shown", () => {
  assert.deepEqual(filterCards(CARDS, NO_FILTER), CARDS);
});

test("an app filter keeps that app's card in every environment", () => {
  assert.deepEqual(filterCards(CARDS, { app: "greeter-app", environment: null }), [
    { environment: "staging", app: "greeter-app" },
    { environment: "prod", app: "greeter-app" },
  ]);
});

test("an environment filter keeps every app of that environment", () => {
  assert.deepEqual(filterCards(CARDS, { app: null, environment: "staging" }), [
    { environment: "staging", app: "sample-app" },
    { environment: "staging", app: "greeter-app" },
  ]);
});

test("both filters together keep the one card that matches both", () => {
  assert.deepEqual(filterCards(CARDS, { app: "sample-app", environment: "prod" }), [
    { environment: "prod", app: "sample-app" },
  ]);
});

test("an app that is not in the chosen environment leaves no card", () => {
  assert.deepEqual(filterCards(CARDS, { app: "counter-app", environment: "staging" }), []);
});

test("a filter on an app that is no longer in the cluster is dropped", () => {
  const filter = settleFilter({ app: "billing", environment: "prod" }, filterChoices(CARDS));

  assert.deepEqual(filter, { app: null, environment: "prod" });
});

test("a filter on an environment that is no longer in the cluster is dropped", () => {
  const filter = settleFilter({ app: "sample-app", environment: "qa" }, filterChoices(CARDS));

  assert.deepEqual(filter, { app: "sample-app", environment: null });
});

test("a filter on names that still exist is kept as it is", () => {
  const filter = { app: "sample-app", environment: "prod" };

  assert.deepEqual(settleFilter(filter, filterChoices(CARDS)), filter);
});

test("a filter is on as soon as one of the two is chosen", () => {
  assert.equal(isFiltering(NO_FILTER), false);
  assert.equal(isFiltering({ app: "sample-app", environment: null }), true);
  assert.equal(isFiltering({ app: null, environment: "prod" }), true);
});
