import test from "node:test";
import assert from "node:assert/strict";
import { computeSendSchedule } from "../src/scheduling.js";

test("computeSendSchedule sends earlier than target to match server arrival", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  const schedule = computeSendSchedule(target, [{ ttfb: 120 }, { ttfb: 140 }], {
    jitterBufferMs: 20,
    clientOverheadMs: 80,
  });

  const expectedOneWay = Math.round((120 * 0.6 + 130 * 0.4) / 2);
  const expectedAhead = expectedOneWay + 20 + 80;
  assert.equal(schedule.sendAheadMs, expectedAhead);
  assert.equal(schedule.sendAt.getTime(), target.getTime() - expectedAhead);
  assert.equal(schedule.serverArrivalMs, target.getTime());
});
