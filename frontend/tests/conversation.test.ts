import assert from "node:assert/strict";
import { test } from "node:test";

import { addReply, closeAction, fromStoredMessages } from "../lib/conversation.ts";
import type { ChatItem } from "../lib/conversation.ts";

const AT = "2026-10-13T10:00:00.000Z";

const deployV2: ChatItem = {
  role: "agent",
  text: "Deploy sample-app:v2 to staging?",
  at: AT,
  action: { id: "action-1", warning: null },
};

test("a stored conversation keeps its messages and their times", () => {
  const items = fromStoredMessages(
    [
      { role: "user", text: "is it healthy?", at: AT },
      { role: "agent", text: "staging is HEALTHY.", at: AT },
    ],
    null,
  );

  assert.deepEqual(items, [
    { role: "user", text: "is it healthy?", at: AT },
    { role: "agent", text: "staging is HEALTHY.", at: AT },
  ]);
});

test("after a reload only the pending action is still open", () => {
  const items = fromStoredMessages(
    [
      { role: "agent", text: "Deploy v1?", at: AT, action: { id: "action-1", warning: null } },
      { role: "agent", text: "Deploy v2?", at: AT, action: { id: "action-2", warning: null } },
    ],
    "action-2",
  );

  assert.equal(items[0]!.actionNote, "No longer active");
  assert.equal(items[1]!.actionNote, undefined);
});

test("a reply is added as an agent message with its time", () => {
  const items = addReply([], { text: "staging is HEALTHY." }, AT);

  assert.deepEqual(items, [{ role: "agent", text: "staging is HEALTHY.", at: AT }]);
});

test("a reply with a new action switches the older open action off", () => {
  const items = addReply([deployV2], { text: "Scale staging to 5?", action: { id: "action-2", warning: null } }, AT);

  assert.equal(items[0]!.actionNote, "Replaced by a newer request");
  assert.equal(items[1]!.actionNote, undefined);
});

test("a reply without an action leaves the open action open", () => {
  const items = addReply([deployV2], { text: "staging is HEALTHY." }, AT);

  assert.equal(items[0]!.actionNote, undefined);
});

test("an action that was already switched off keeps its first note", () => {
  const confirmed = closeAction([deployV2], "action-1", "You confirmed");

  const items = addReply(confirmed, { text: "Scale staging to 5?", action: { id: "action-2", warning: null } }, AT);

  assert.equal(items[0]!.actionNote, "You confirmed");
});

test("closing an action notes why, and only on that action", () => {
  const other: ChatItem = { ...deployV2, action: { id: "action-9", warning: null } };

  const items = closeAction([deployV2, other], "action-1", "You cancelled");

  assert.equal(items[0]!.actionNote, "You cancelled");
  assert.equal(items[1]!.actionNote, undefined);
});

test("changing the conversation never changes the list it was given", () => {
  const before = [deployV2];

  closeAction(before, "action-1", "You confirmed");

  assert.equal(before[0]!.actionNote, undefined);
});
