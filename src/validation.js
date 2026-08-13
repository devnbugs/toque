export function parseTargetTime(value, now = new Date()) {
  if (typeof value !== "string") return null;

  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:(?:\.|:)(\d{1,3}))?$/.exec(value);
  if (!match) return null;

  const [, hoursText, minutesText, secondsText, millisecondsText = ""] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const milliseconds = millisecondsText
    ? Number(millisecondsText.padEnd(3, "0"))
    : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const candidate = new Date(now);
  candidate.setHours(hours, minutes, seconds, milliseconds);

  const sameDayTarget = new Date(candidate);
  if (sameDayTarget.getTime() < now.getTime()) {
    sameDayTarget.setDate(sameDayTarget.getDate() + 1);
  }

  return sameDayTarget;
}

export function parsePositiveCount(value, defaultValue = 5, max = 100) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (!/^\d+$/.test(String(value))) return null;

  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > max) return null;
  return count;
}
