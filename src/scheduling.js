export function computeSendSchedule(targetTime, samples = [], options = {}) {
  const jitterBufferMs = options.jitterBufferMs ?? 40;
  const clientOverheadMs = options.clientOverheadMs ?? 80;
  const validSamples = (samples || [])
    .map((sample) => Number(sample?.ttfb))
    .filter((value) => Number.isFinite(value) && value > 0);

  let oneWayMs = 0;
  if (validSamples.length > 0) {
    const minTtfb = Math.min(...validSamples);
    const avgTtfb = Math.round(validSamples.reduce((sum, value) => sum + value, 0) / validSamples.length);
    oneWayMs = Math.round((minTtfb * 0.6 + avgTtfb * 0.4) / 2);
  }

  const sendAheadMs = oneWayMs + jitterBufferMs + clientOverheadMs;
  const sendAt = new Date(targetTime.getTime() - sendAheadMs);

  return {
    targetTime,
    oneWayMs,
    jitterBufferMs,
    clientOverheadMs,
    sendAheadMs,
    sendAt,
    serverArrivalMs: targetTime.getTime(),
  };
}
