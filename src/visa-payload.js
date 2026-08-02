export function buildVisaPayload(payload, groupId, captchaToken) {
  const id = String(groupId);

  if (payload === undefined || payload === null) {
    return {
      id,
      ...(captchaToken ? { recaptchaToken: captchaToken } : {}),
    };
  }

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ...parsed,
          id,
          ...(captchaToken ? { recaptchaToken: parsed?.recaptchaToken || captchaToken } : {}),
        };
      }
    } catch {}

    return {
      id,
      raw: payload,
      ...(captchaToken ? { recaptchaToken: captchaToken } : {}),
    };
  }

  if (typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload,
      id,
      ...(captchaToken ? { recaptchaToken: payload?.recaptchaToken || captchaToken } : {}),
    };
  }

  return {
    id,
    value: payload,
    ...(captchaToken ? { recaptchaToken: captchaToken } : {}),
  };
}
