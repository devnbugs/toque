export function buildVisaPayload(payload, groupId, captchaToken) {
  const id = String(groupId);

  // Ensure captchaToken is always a plain string — it may have been
  // passed as an object { token, entityId, updatedAt } from the
  // captcha store. The Nusuk API expects recaptchaToken as a string.
  const token =
    captchaToken && typeof captchaToken === "object" && typeof captchaToken.token === "string"
      ? captchaToken.token
      : captchaToken;

  if (payload === undefined || payload === null) {
    return {
      id,
      ...(token ? { recaptchaToken: token } : {}),
    };
  }

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ...parsed,
          id,
          ...(token ? { recaptchaToken: parsed?.recaptchaToken || token } : {}),
        };
      }
    } catch {}

    return {
      id,
      raw: payload,
      ...(token ? { recaptchaToken: token } : {}),
    };
  }

  if (typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload,
      id,
      ...(token ? { recaptchaToken: payload?.recaptchaToken || token } : {}),
    };
  }

  return {
    id,
    value: payload,
    ...(token ? { recaptchaToken: token } : {}),
  };
}
