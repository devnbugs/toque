import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRequestTiming } from "../src/timing.js";

test("summarizeRequestTiming surfaces the response Date header when present", () => {
  const sendAt = new Date("2026-08-02T20:55:00.444Z");
  const responseReceivedAt = new Date("2026-08-02T20:55:00.777Z");
  const summary = summarizeRequestTiming({
    sendAt,
    responseReceivedAt,
    response: {
      headers: { date: "Sat, 02 Aug 2026 20:55:00 GMT" },
    },
  });

  assert.equal(summary.serverDateHeader, "Sat, 02 Aug 2026 20:55:00 GMT");
  assert.equal(summary.responseReceivedAt.getTime(), responseReceivedAt.getTime());
  assert.equal(summary.sendAt.getTime(), sendAt.getTime());
});

test("summarizeRequestTiming computes elapsedMs", () => {
  const sendAt = new Date("2026-08-02T20:55:00.000Z");
  const responseReceivedAt = new Date("2026-08-02T20:55:00.500Z");
  const summary = summarizeRequestTiming({
    sendAt,
    responseReceivedAt,
    response: { headers: {} },
  });
  assert.equal(summary.elapsedMs, 500);
});

test("summarizeRequestTiming computes serverClockOffsetMs when oneWayLatencyMs provided", () => {
  const sendAt = new Date("2026-08-02T20:55:00.000Z");
  const responseReceivedAt = new Date("2026-08-02T20:55:00.500Z"); // 500ms our time
  const summary = summarizeRequestTiming({
    sendAt,
    responseReceivedAt,
    response: {
      headers: { date: "Sat, 02 Aug 2026 20:55:00 GMT" }, // server sent at 0ms
    },
    oneWayLatencyMs: 150,
  });
  // offset = (500 - 0) - 150 = 350ms (our clock is 350ms ahead of server)
  assert.equal(summary.serverClockOffsetMs, 350);
});

test("summarizeRequestTiming returns null serverClockOffsetMs without oneWayLatencyMs", () => {
  const sendAt = new Date("2026-08-02T20:55:00.000Z");
  const responseReceivedAt = new Date("2026-08-02T20:55:00.500Z");
  const summary = summarizeRequestTiming({
    sendAt,
    responseReceivedAt,
    response: {
      headers: { date: "Sat, 02 Aug 2026 20:55:00 GMT" },
    },
  });
  assert.equal(summary.serverClockOffsetMs, null);
});

test("summarizeRequestTiming handles missing Date header", () => {
  const sendAt = new Date("2026-08-02T20:55:00.000Z");
  const responseReceivedAt = new Date("2026-08-02T20:55:00.500Z");
  const summary = summarizeRequestTiming({
    sendAt,
    responseReceivedAt,
    response: { headers: {} },
    oneWayLatencyMs: 150,
  });
  assert.equal(summary.serverDateHeader, null);
  assert.equal(summary.parsedServerDate, null);
  assert.equal(summary.serverClockOffsetMs, null);
});
