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
