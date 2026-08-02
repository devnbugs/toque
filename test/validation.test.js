import test from "node:test";
import assert from "node:assert/strict";
import { parsePositiveCount, parseTargetTime } from "../src/validation.js";

test("parseTargetTime accepts bounded times and normalizes fractional milliseconds", () => {
  const now = new Date(2026, 0, 1, 10, 0, 0, 0);
  const target = parseTargetTime("10:00:01.5", now);
  assert.equal(target.getHours(), 10);
  assert.equal(target.getMinutes(), 0);
  assert.equal(target.getSeconds(), 1);
  assert.equal(target.getMilliseconds(), 500);
});

test("parseTargetTime rejects elapsed times in the past", () => {
  const now = new Date(2026, 0, 1, 10, 0, 0, 0);
  const target = parseTargetTime("09:59:59:250", now);
  assert.equal(target, null);
});

test("parseTargetTime rejects malformed and out-of-range input", () => {
  const invalid = ["", "1:2:3", "24:00:00", "23:60:00", "23:59:60", "12:00:00.1234", "abc"];
  for (const value of invalid) assert.equal(parseTargetTime(value), null, value);
});

test("parsePositiveCount validates the complete value", () => {
  assert.equal(parsePositiveCount(undefined), 5);
  assert.equal(parsePositiveCount("1"), 1);
  assert.equal(parsePositiveCount("100"), 100);
  for (const value of ["0", "-1", "1.5", "3junk", "101"]) {
    assert.equal(parsePositiveCount(value), null, value);
  }
});
