import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGroups,
  formatGroups,
  normalizeGroupId,
  parseGroupSelection,
} from "../src/groups.js";

test("extractGroups normalizes common nested response shapes", () => {
  const groups = extractGroups({
    response: {
      data: {
        items: [
          { id: 101, groupName: "First Group" },
          { groupId: "202", nameEn: "Second Group" },
        ],
      },
    },
  });
  assert.deepEqual(groups.map(({ id, name }) => ({ id, name })), [
    { id: 101, name: "First Group" },
    { id: "202", name: "Second Group" },
  ]);
});

test("extractGroups accepts empty recognized lists and rejects unknown shapes", () => {
  assert.deepEqual(extractGroups({ response: { data: { items: [] } } }), []);
  assert.equal(extractGroups({ response: { data: { total: 2 } } }), null);
});

test("extractGroups rejects duplicate IDs", () => {
  assert.throws(
    () => extractGroups([{ id: 1, name: "One" }, { id: 1, name: "Duplicate" }]),
    /Duplicate group ID/
  );
});

test("format and selection retain the underlying API group ID", () => {
  const groups = [{ id: "00042", name: "Named Group" }];
  assert.match(formatGroups(groups), /Named Group.*ID: 00042/);
  assert.equal(parseGroupSelection("1", groups), groups[0]);
  assert.equal(parseGroupSelection("2", groups), null);
});

test("normalizeGroupId only converts canonical safe integers", () => {
  assert.equal(normalizeGroupId("42"), 42);
  assert.equal(normalizeGroupId("00042"), "00042");
  assert.equal(normalizeGroupId("9007199254740993"), "9007199254740993");
});
