export function toErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (payload instanceof Error) {
    const trimmed = payload.message.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (typeof payload === "object") {
    const record = payload as {
      message?: unknown;
      error?: unknown;
      cause?: unknown;
    };

    if (typeof record.message === "string") {
      const trimmed = record.message.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (Array.isArray(record.message) && record.message.length > 0) {
      const joined = record.message
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .join(". ");

      if (joined.length > 0) {
        return joined;
      }
    }

    if (typeof record.error === "string") {
      const trimmed = record.error.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (typeof record.cause === "string") {
      const trimmed = record.cause.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return fallback;
}
