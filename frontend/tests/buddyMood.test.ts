import assert from "node:assert/strict";
import { test } from "node:test";

import { moodOfReply } from "@/lib/buddy-mood.ts";

test("an ordinary reply leaves Buddy resting", () => {
  assert.equal(moodOfReply("Cancelled. Nothing was changed.", false), "idle");
});

test("a failed request makes Buddy uneasy", () => {
  assert.equal(moodOfReply("The Deployment Assistant server is not answering.", true), "worried");
});

test("a HEALTHY headline makes Buddy pleased", () => {
  assert.equal(moodOfReply("sample-app (staging) is HEALTHY\nPods 3/3 ready", false), "happy");
});

test("a DEGRADED or DOWN headline makes Buddy uneasy", () => {
  assert.equal(moodOfReply("sample-app (staging) is DEGRADED", false), "worried");
  assert.equal(moodOfReply("sample-app (prod) is DOWN", false), "worried");
});

test("only the headline counts, not a status word further down", () => {
  assert.equal(moodOfReply("2 environments\nstaging | DOWN", false), "idle");
});
