import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByConversationOrder } from "../lib/message-order.ts";

const at = (message) => message.createdAt;
const role = (message) => message.role;

test("same-millisecond pairs order user before assistant", () => {
  const messages = [
    { id: "b", role: "assistant", createdAt: 100 },
    { id: "a", role: "user", createdAt: 100 },
  ];
  const sorted = sortByConversationOrder(messages, at, role);
  assert.deepEqual(
    sorted.map((message) => message.id),
    ["a", "b"],
  );
});

test("createdAt stays the primary order and sort is stable", () => {
  const messages = [
    { id: "3", role: "user", createdAt: 300 },
    { id: "1", role: "user", createdAt: 100 },
    { id: "2", role: "assistant", createdAt: 200 },
    { id: "4", role: "assistant", createdAt: 300 },
  ];
  const sorted = sortByConversationOrder(messages, at, role);
  assert.deepEqual(
    sorted.map((message) => message.id),
    ["1", "2", "3", "4"],
  );
});
