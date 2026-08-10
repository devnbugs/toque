/**
 * Summarize request timing from a response, including server clock offset.
 *
 * @param {object} params
 * @param {Date} params.sendAt - When the request was sent (our clock).
 * @param {Date} params.responseReceivedAt - When the response arrived (our clock).
 * @param {object} params.response - The response object with headers.
 * @param {number} [params.oneWayLatencyMs] - Estimated one-way latency for clock offset.
 * @returns {object} Timing summary with elapsed, server date, and clock offset.
 */
export function summarizeRequestTiming({ sendAt, responseReceivedAt, response, oneWayLatencyMs }) {
  const headers = response?.headers || {};
  const headerDate = headers.date || headers.Date || null;
  let parsedHeaderDate = null;

  if (headerDate) {
    const parsed = new Date(headerDate);
    if (!Number.isNaN(parsed.getTime())) parsedHeaderDate = parsed;
  }

  const elapsedMs = responseReceivedAt.getTime() - sendAt.getTime();

  // Compute server clock offset if we have both the Date header and one-way latency
  let serverClockOffsetMs = null;
  if (parsedHeaderDate && oneWayLatencyMs != null) {
    // Server sent the response at parsedHeaderDate (server clock).
    // We received it at responseReceivedAt (our clock).
    // If clocks were synced, responseReceivedAt - parsedHeaderDate ≈ oneWayLatency.
    // Offset = actual elapsed - expected one-way = how much our clock differs.
    serverClockOffsetMs = Math.round(
      (responseReceivedAt.getTime() - parsedHeaderDate.getTime()) - oneWayLatencyMs
    );
  }

  return {
    sendAt,
    responseReceivedAt,
    serverDateHeader: headerDate,
    parsedServerDate: parsedHeaderDate,
    elapsedMs,
    serverClockOffsetMs,
  };
}
