export function summarizeRequestTiming({ sendAt, responseReceivedAt, response }) {
  const headers = response?.headers || {};
  const headerDate = headers.date || headers.Date || null;
  let parsedHeaderDate = null;

  if (headerDate) {
    const parsed = new Date(headerDate);
    if (!Number.isNaN(parsed.getTime())) parsedHeaderDate = parsed;
  }

  return {
    sendAt,
    responseReceivedAt,
    serverDateHeader: headerDate,
    parsedServerDate: parsedHeaderDate,
    elapsedMs: responseReceivedAt.getTime() - sendAt.getTime(),
  };
}
