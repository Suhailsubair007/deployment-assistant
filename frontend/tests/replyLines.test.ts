import assert from "node:assert/strict";
import { test } from "node:test";

import { groupFacts, parseReply, splitStatusWords } from "../lib/reply-lines.ts";

const text = (value: string) => ({ kind: "text", text: value });

// ---- Status words ----

test("text without a status word stays one plain part", () => {
  assert.deepEqual(splitStatusWords("sample-app has 3 pods"), [text("sample-app has 3 pods")]);
});

test("a status word becomes its own part", () => {
  assert.deepEqual(splitStatusWords("staging is HEALTHY."), [
    text("staging is "),
    { kind: "status", status: "HEALTHY" },
    text("."),
  ]);
});

test("every status word in the text is found", () => {
  assert.deepEqual(splitStatusWords("staging: DEGRADED, prod: DOWN"), [
    text("staging: "),
    { kind: "status", status: "DEGRADED" },
    text(", prod: "),
    { kind: "status", status: "DOWN" },
  ]);
});

test("a status word inside a longer word is left alone", () => {
  assert.deepEqual(splitStatusWords("DOWNLOADING after SHUTDOWN"), [text("DOWNLOADING after SHUTDOWN")]);
});

test("lower case is not a status word", () => {
  assert.deepEqual(splitStatusWords("scale down, stay healthy"), [text("scale down, stay healthy")]);
});

test("empty text gives no parts", () => {
  assert.deepEqual(splitStatusWords(""), []);
});

// ---- Lines of a reply ----

test("a one-line reply is one plain line without a headline", () => {
  assert.deepEqual(parseReply("Cancelled. Nothing was changed."), [
    { kind: "plain", isLead: false, parts: [text("Cancelled. Nothing was changed.")] },
  ]);
});

test("the first line of a longer reply is its headline", () => {
  const lines = parseReply("sample-app in staging\nImage: sample-app:v2");

  assert.deepEqual(
    lines.map((line) => line.isLead),
    [true, false],
  );
});

test('a line that starts with "- " is a list item without the dash', () => {
  assert.deepEqual(parseReply("- sample-app-v2-1 uses 41Mi"), [
    { kind: "bullet", isLead: false, parts: [text("sample-app-v2-1 uses 41Mi")] },
  ]);
});

test('a line that starts with "Note: " is a side note and keeps its words', () => {
  assert.deepEqual(parseReply("Note: metrics are not available yet."), [
    { kind: "note", isLead: false, parts: [text("Note: metrics are not available yet.")] },
  ]);
});

test('" | " cuts a line into facts and remembers how far it was indented', () => {
  assert.deepEqual(parseReply("  Pods 3/3 ready | /health: 200 in 62 ms"), [
    {
      kind: "facts",
      isLead: false,
      indent: 2,
      facts: [[text("Pods 3/3 ready")], [text("/health: 200 in 62 ms")]],
    },
  ]);
});

test("a status word inside a fact still becomes a status part", () => {
  assert.deepEqual(parseReply("staging | DEGRADED"), [
    { kind: "facts", isLead: false, indent: 0, facts: [[text("staging")], [{ kind: "status", status: "DEGRADED" }]] },
  ]);
});

test("a list item that contains a divider stays one list item", () => {
  assert.deepEqual(parseReply("- cpu 12m | memory 41Mi"), [
    { kind: "bullet", isLead: false, parts: [text("cpu 12m | memory 41Mi")] },
  ]);
});

test("an empty line is kept as a line with nothing in it", () => {
  assert.deepEqual(parseReply("Deployed.\n\nRoll back with: roll back staging"), [
    { kind: "plain", isLead: true, parts: [text("Deployed.")] },
    { kind: "plain", isLead: false, parts: [] },
    { kind: "plain", isLead: false, parts: [text("Roll back with: roll back staging")] },
  ]);
});

// ---- Tables of facts ----

const kindsOf = (reply: string) => groupFacts(parseReply(reply)).map((block) => block.kind);

test("lines of text stay one block each", () => {
  assert.deepEqual(kindsOf("Deployed.\n- one\nNote: two"), ["line", "line", "line"]);
});

test("one row of facts is a table of one row", () => {
  const blocks = groupFacts(parseReply("Pods 3/3 ready | Rollout: complete"));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind === "table" && blocks[0].rows.length, 1);
});

test("rows of facts that follow each other become one table", () => {
  const blocks = groupFacts(parseReply("Last 2 deployments:\n#2 | staging | succeeded\n#1 | staging | failed"));

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["line", "table"],
  );
  assert.equal(blocks[1]?.kind === "table" && blocks[1].rows.length, 2);
});

test("a row with a different number of facts starts a new table", () => {
  assert.deepEqual(kindsOf("a | b | c\nd | e"), ["table", "table"]);
});

test("a row with a different indent starts a new table", () => {
  assert.deepEqual(kindsOf("a | b\n  c | d"), ["table", "table"]);
});

test("a line of text between rows of facts keeps them in separate tables", () => {
  assert.deepEqual(kindsOf("a | b\nPer pod:\nc | d"), ["table", "line", "table"]);
});
