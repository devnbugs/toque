export function parseJwt(value) {
  const token = String(value || "").replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const decode = (part) => JSON.parse(
      Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8")
    );
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (!header?.alg || !payload || typeof payload !== "object") return null;
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    return { token, header, payload };
  } catch {
    return null;
  }
}

export function requireJwt(value, label = "auth token") {
  const parsed = parseJwt(value);
  if (!parsed) throw new Error(`${label} is not a valid, unexpired JWT`);
  return parsed.token;
}