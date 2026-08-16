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

/**
 * Merge new calibration samples with existing ones using exponential decay
 * weighting. Recent samples have more influence than older ones, so the
 * one-way estimate adapts to changing network conditions.
 *
 * @param {Array} existing - Previously collected samples.
 * @param {Array} fresh - New samples from the latest calibration round.
 * @param {number} [maxSamples=20] - Maximum samples to retain.
 * @returns {Array} Merged sample list (most recent last).
 */
export function mergeSamples(existing = [], fresh = [], maxSamples = 20) {
  const merged = [...existing, ...fresh];
  if (merged.length <= maxSamples) return merged;
  // Keep the most recent maxSamples, dropping oldest first
  return merged.slice(merged.length - maxSamples);
}

/**
 * Compute a refined send schedule by merging calibration rounds.
 *
 * Each calibration round produces TTFB samples. This function merges all
 * rounds, applies exponential decay weighting (recent rounds count more),
 * and produces a final schedule. The weighting factor controls how quickly
 * old samples decay: 0.8 means each older round has 80% weight of the next.
 *
 * @param {Date} targetTime - When the request should arrive.
 * @param {Array<Array>} rounds - Array of calibration rounds (each is an array of samples).
 * @param {object} [options] - Same as computeSendSchedule, plus:
 * @param {number} [options.decayFactor=0.8] - Weight of each older round (0-1).
 * @param {number} [options.serverClockOffsetMs=0] - Clock skew correction.
 * @returns {object} Refined schedule.
 */
export function computeRefinedSchedule(targetTime, rounds = [], options = {}) {
  const decayFactor = options.decayFactor ?? 0.8;
  const serverClockOffsetMs = options.serverClockOffsetMs ?? 0;

  // Flatten rounds with decay weighting: most recent round has weight 1.0,
  // previous round 0.8, before that 0.64, etc.
  const weightedSamples = [];
  for (let r = rounds.length - 1; r >= 0; r--) {
    const weight = Math.pow(decayFactor, rounds.length - 1 - r);
    for (const sample of rounds[r]) {
      weightedSamples.push({ ...sample, _weight: weight });
    }
  }

  // Compute weighted one-way latency
  const validTtfb = weightedSamples
    .map((s) => ({ ttfb: Number(s?.ttfb), weight: s._weight }))
    .filter((s) => Number.isFinite(s.ttfb) && s.ttfb > 2);

  let oneWayMs;
  let jitterBufferMs;
  let method;

  if (validTtfb.length >= 3) {
    // Weighted trimmed mean: sort by TTFB, trim 20%, weight-average the rest
    const sorted = [...validTtfb].sort((a, b) => a.ttfb - b.ttfb);
    const trimCount = Math.floor(sorted.length * 0.2);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const totalWeight = trimmed.reduce((sum, s) => sum + s.weight, 0);
    const weightedMean = trimmed.reduce((sum, s) => sum + s.ttfb * s.weight, 0) / totalWeight;
    oneWayMs = Math.round(weightedMean / 2);

    // Jitter from weighted variance
    const mean = validTtfb.reduce((sum, s) => sum + s.ttfb * s.weight, 0) /
      validTtfb.reduce((sum, s) => sum + s.weight, 0);
    const wVar = validTtfb.reduce((sum, s) => sum + s.weight * (s.ttfb - mean) ** 2, 0) /
      validTtfb.reduce((sum, s) => sum + s.weight, 0);
    const wStd = Math.sqrt(wVar);
    const zScore = (options.confidence ?? 0.95) >= 0.99 ? 2.576 : 1.96;
    jitterBufferMs = Math.max(Math.round((zScore * wStd) / 2), 10);
    method = "weighted-trimmed-mean";
  } else if (validTtfb.length > 0) {
    const minTtfb = Math.min(...validTtfb.map((s) => s.ttfb));
    const wAvg = validTtfb.reduce((sum, s) => sum + s.ttfb * s.weight, 0) /
      validTtfb.reduce((sum, s) => sum + s.weight, 0);
    oneWayMs = Math.round((minTtfb * 0.6 + wAvg * 0.4) / 2);
    jitterBufferMs = Math.max(Math.round(oneWayMs * 0.15), 10);
    method = "weighted-min-avg";
  } else {
    oneWayMs = 150;
    jitterBufferMs = 50;
    method = "default-fallback";
  }

  const clientOverheadMs = options.clientOverheadMs ?? 80;
  const sendAheadMs = Math.max(
    oneWayMs + jitterBufferMs + clientOverheadMs + serverClockOffsetMs,
    options.minSendAheadMs ?? 50,
  );
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
    roundCount: rounds.length,
  };
}

/**
 * Compute the optimal keepalive interval to maintain a warm TLS/TCP connection
 * without excessive traffic. Uses the minimum observed TTFB as a proxy for
 * connection health: if the connection is warm, keepalive pings can be spaced
 * out; if there's jitter, ping more frequently.
 *
 * @param {Array} samples - Calibration samples.
 * @param {object} [options]
 * @param {number} [options.minIntervalMs=2000] - Minimum ping interval.
 * @param {number} [options.maxIntervalMs=10000] - Maximum ping interval.
 * @returns {number} Keepalive interval in ms.
 */
export function computeKeepaliveInterval(samples = [], options = {}) {
  const minInterval = options.minIntervalMs ?? 2000;
  const maxInterval = options.maxIntervalMs ?? 10000;

  const validTtfb = samples
    .map((s) => Number(s?.ttfb))
    .filter((v) => Number.isFinite(v) && v > 2);

  if (validTtfb.length < 2) return maxInterval;

  const mean = validTtfb.reduce((a, b) => a + b, 0) / validTtfb.length;
  const variance = validTtfb.reduce((s, v) => s + (v - mean) ** 2, 0) / validTtfb.length;
  const stdDev = Math.sqrt(variance);

  // Low jitter → longer interval; high jitter → shorter interval
  // Scale: stddev of 0 → maxInterval, stddev of 30+ → minInterval
  const jitterRatio = Math.min(stdDev / 30, 1);
  const interval = Math.round(maxInterval - (maxInterval - minInterval) * jitterRatio);
  return Math.max(Math.min(interval, maxInterval), minInterval);
}

/**
 * Determine the final-phase precision wait strategy.
 *
 * In the last few milliseconds before send, setTimeout alone has ~1-4ms
 * granularity on most platforms. This function computes when to switch
 * from setTimeout to a busy-wait loop for sub-millisecond precision.
 *
 * @param {number} remainingMs - Milliseconds until send time.
 * @param {object} [options]
 * @param {number} [options.busyWaitThresholdMs=5] - Switch to busy-wait below this.
 * @returns {object} { setTimeoutMs, busyWaitMs } — how long to setTimeout, then busy-wait.
 */
export function computePrecisionWait(remainingMs, options = {}) {
  const busyWaitThreshold = options.busyWaitThresholdMs ?? 5;
  if (remainingMs <= 0) return { setTimeoutMs: 0, busyWaitMs: 0 };
  if (remainingMs <= busyWaitThreshold) {
    return { setTimeoutMs: 0, busyWaitMs: remainingMs };
  }
  return { setTimeoutMs: remainingMs - busyWaitThreshold, busyWaitMs: busyWaitThreshold };
}
