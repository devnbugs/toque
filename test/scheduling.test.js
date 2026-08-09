import test from "node:test";
import assert from "node:assert/strict";
import { computeSendSchedule, computeClockOffset } from "../src/scheduling.js";

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

test("computeSendSchedule uses trimmed mean for 3+ samples", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  // 5 samples: trim 1 from each end → keep [300, 320, 340], mean = 320, one-way = 160
  const samples = [
    { ttfb: 280 }, // trimmed (outlier low)
    { ttfb: 300 },
    { ttfb: 320 },
    { ttfb: 340 },
    { ttfb: 500 }, // trimmed (outlier high)
  ];
  const schedule = computeSendSchedule(target, samples, {
    clientOverheadMs: 80,
    jitterBufferMs: 30,
  });
  assert.equal(schedule.oneWayMs, 160);
  assert.equal(schedule.method, "trimmed-mean-ttfb");
  assert.equal(schedule.sampleCount, 5);
  assert.equal(schedule.sendAheadMs, 160 + 30 + 80);
});

test("computeSendSchedule auto-computes jitter from std dev", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  // Samples with known variance: mean=300, stdDev≈81.65
  const samples = [
    { ttfb: 200 },
    { ttfb: 300 },
    { ttfb: 300 },
    { ttfb: 300 },
    { ttfb: 400 },
  ];
  const schedule = computeSendSchedule(target, samples, {
    clientOverheadMs: 50,
    confidence: 0.95,
  });
  // z=1.96, stdDev=√4000≈63.25, jitter = 1.96 * 63.25 / 2 ≈ 62
  assert.ok(schedule.jitterBufferMs >= 55 && schedule.jitterBufferMs <= 70,
    `jitterBufferMs=${schedule.jitterBufferMs} not in [55,70]`);
  assert.equal(schedule.method, "trimmed-mean-ttfb");
});

test("computeSendSchedule falls back to total RTT when no TTFB", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  const samples = [{ total: 400 }, { total: 500 }];
  const schedule = computeSendSchedule(target, samples, {
    clientOverheadMs: 80,
  });
  assert.equal(schedule.oneWayMs, 200);
  assert.equal(schedule.method, "total-rtt-fallback");
});

test("computeSendSchedule uses defaults when no samples", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  const schedule = computeSendSchedule(target, [], { clientOverheadMs: 80 });
  assert.equal(schedule.oneWayMs, 150);
  assert.equal(schedule.method, "default-fallback");
  assert.ok(schedule.jitterBufferMs >= 10);
});

test("computeSendSchedule filters cached (ttfb=0) samples", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  const samples = [
    { ttfb: 0 }, // cached — should be filtered
    { ttfb: 0 }, // cached — should be filtered
    { ttfb: 300 },
    { ttfb: 320 },
    { ttfb: 340 },
  ];
  const schedule = computeSendSchedule(target, samples, {
    clientOverheadMs: 80,
    jitterBufferMs: 20,
  });
  assert.equal(schedule.sampleCount, 3);
  assert.equal(schedule.method, "trimmed-mean-ttfb");
});

test("computeSendSchedule applies server clock offset correction", () => {
  const target = new Date("2026-08-02T20:55:00.444Z");
  const schedule = computeSendSchedule(target, [{ ttfb: 200 }], {
    clientOverheadMs: 80,
    jitterBufferMs: 20,
    serverClockOffsetMs: 50, // our clock is 50ms ahead of server
  });
  // sendAhead = oneWay + jitter + overhead + clockOffset
  const expectedOneWay = Math.round((200 * 0.6 + 200 * 0.4) / 2);
  assert.equal(schedule.sendAheadMs, expectedOneWay + 20 + 80 + 50);
});

test("computeClockOffset calculates server clock skew from Date header", () => {
  const ourReceiveTime = new Date("2026-08-02T20:55:00.500Z");
  const serverDate = new Date("2026-08-02T20:55:00.300Z");
  const oneWayLatency = 150;
  // offset = (500 - 300) - 150 = 50ms (our clock is 50ms ahead)
  const offset = computeClockOffset(ourReceiveTime, serverDate, oneWayLatency);
  assert.equal(offset, 50);
});

test("computeClockOffset returns 0 for invalid date", () => {
  const offset = computeClockOffset(new Date(), "invalid-date", 100);
  assert.equal(offset, 0);
});

test("computeClockOffset returns 0 for null date", () => {
  const offset = computeClockOffset(new Date(), null, 100);
  assert.equal(offset, 0);
});
