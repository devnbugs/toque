/**
 * Compute a precise send schedule so the request arrives at the target time.
 *
 * The algorithm:
 * 1. Collects TTFB samples from benchmark requests (cache-busted for accuracy).
 * 2. Filters out cached/zero samples that don't represent real network latency.
 * 3. Computes one-way latency using a robust estimator (trimmed mean of TTFB/2).
 * 4. Adds jitter buffer based on the standard deviation of samples (not a fixed
 *    value) — this adapts to actual network variability.
 * 5. Adds client overhead (time from "send" call to the packet leaving the NIC).
 * 6. Optionally corrects for server clock skew using the response Date header.
 *
 * @param {Date} targetTime - When the request should arrive at the server.
 * @param {Array<{ttfb?: number, total?: number}>} samples - Benchmark samples.
 * @param {object} [options]
 * @param {number} [options.jitterBufferMs] - Override jitter buffer (auto if omitted).
 * @param {number} [options.clientOverheadMs=80] - Client-side overhead in ms.
 * @param {number} [options.serverClockOffsetMs=0] - Clock skew correction in ms.
 * @param {number} [options.confidence=0.95] - Confidence level for jitter (0.90-0.99).
 * @returns {object} Schedule with sendAt, oneWayMs, jitterBufferMs, etc.
 */
export function computeSendSchedule(targetTime, samples = [], options = {}) {
  const clientOverheadMs = options.clientOverheadMs ?? 80;
  const serverClockOffsetMs = options.serverClockOffsetMs ?? 0;
  const confidence = options.confidence ?? 0.95;

  // Filter to real TTFB values (> 2ms excludes cached responses)
  const validTtfb = (samples || [])
    .map((s) => Number(s?.ttfb))
    .filter((v) => Number.isFinite(v) && v > 2);

  // Also collect total RTT for fallback
  const validTotals = (samples || [])
    .map((s) => Number(s?.total))
    .filter((v) => Number.isFinite(v) && v > 2);

  let oneWayMs = 0;
  let jitterBufferMs = options.jitterBufferMs;
  let method = "none";

  if (validTtfb.length >= 3) {
    // Robust estimator: trimmed mean of TTFB / 2
    // Sort and trim 20% from each end to remove outliers
    const sorted = [...validTtfb].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.2);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const trimmedMean = trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
    oneWayMs = Math.round(trimmedMean / 2);

    // Auto-compute jitter buffer from standard deviation if not overridden
    if (jitterBufferMs === undefined) {
      const mean = validTtfb.reduce((sum, v) => sum + v, 0) / validTtfb.length;
      const variance = validTtfb.reduce((sum, v) => sum + (v - mean) ** 2, 0) / validTtfb.length;
      const stdDev = Math.sqrt(variance);
      // Use z-score for confidence level: 1.645 (90%), 1.96 (95%), 2.576 (99%)
      const zScore = confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645;
      // Jitter buffer = z * sigma / 2 (one-way std dev)
      jitterBufferMs = Math.round((zScore * stdDev) / 2);
    }
    method = "trimmed-mean-ttfb";
  } else if (validTtfb.length > 0) {
    // Not enough samples for trimming — use weighted min/avg
    const minTtfb = Math.min(...validTtfb);
    const avgTtfb = validTtfb.reduce((sum, v) => sum + v, 0) / validTtfb.length;
    oneWayMs = Math.round((minTtfb * 0.6 + avgTtfb * 0.4) / 2);

    if (jitterBufferMs === undefined) {
      // Fallback: use 15% of one-way as jitter
      jitterBufferMs = Math.round(oneWayMs * 0.15);
    }
    method = "weighted-min-avg-ttfb";
  } else if (validTotals.length > 0) {
    // No TTFB — estimate from total RTT (less accurate)
    const minTotal = Math.min(...validTotals);
    oneWayMs = Math.round(minTotal / 2);

    if (jitterBufferMs === undefined) {
      jitterBufferMs = Math.round(oneWayMs * 0.2);
    }
    method = "total-rtt-fallback";
  } else {
    // No samples — use conservative defaults
    oneWayMs = 150;
    if (jitterBufferMs === undefined) {
      jitterBufferMs = 50;
    }
    method = "default-fallback";
  }

  // Ensure minimum jitter buffer
  jitterBufferMs = Math.max(jitterBufferMs, 10);

  // Total send-ahead = one-way latency + jitter buffer + client overhead
  // + server clock correction (positive offset means our clock is ahead)
  const sendAheadMs = oneWayMs + jitterBufferMs + clientOverheadMs + serverClockOffsetMs;
  const sendAt = new Date(targetTime.getTime() - sendAheadMs);

  return {
    targetTime,
    oneWayMs,
    jitterBufferMs,
    clientOverheadMs,
    serverClockOffsetMs,
    sendAheadMs,
    sendAt,
    serverArrivalMs: targetTime.getTime(),
    method,
    sampleCount: validTtfb.length,
  };
}

/**
 * Compute server clock offset from response Date header.
 *
 * If the server's Date header says it's 20:55:00.000 and we received the
 * response at 20:55:00.500 (our clock), and the one-way latency is 150ms,
 * then the server sent the response at ~20:55:00.000 and it arrived 500ms
 * later on our clock. The server clock is ~350ms behind ours (or we're ahead).
 *
 * serverClockOffset = (ourReceiveTime - serverSendTime) - oneWayLatency
 * Positive = our clock is ahead of server
 * Negative = our clock is behind server
 *
 * @param {Date} ourReceiveTime - When we received the response (our clock).
 * @param {string|Date} serverDateHeader - The Date header from the response.
 * @param {number} oneWayLatencyMs - Estimated one-way latency in ms.
 * @returns {number} Clock offset in ms (positive = we're ahead).
 */
export function computeClockOffset(ourReceiveTime, serverDateHeader, oneWayLatencyMs) {
  if (!serverDateHeader) return 0;
  const serverTime = serverDateHeader instanceof Date ? serverDateHeader : new Date(serverDateHeader);
  if (Number.isNaN(serverTime.getTime())) return 0;
  const elapsed = ourReceiveTime.getTime() - serverTime.getTime();
  return Math.round(elapsed - oneWayLatencyMs);
}
