import type {
  AuthResult,
  AuthenticatedUser,
  GithubDevicePollResult,
  GithubDeviceStartResult,
  OtpRequestResult,
} from "./auth-types";

const DEFAULT_AUTH_API_BASE_URL = "/api";

function resolveAuthApiBaseUrl(): string {
  const configuredValue = import.meta.env.VITE_QWERIO_API_BASE_URL?.trim();

  if (!configuredValue) {
    return DEFAULT_AUTH_API_BASE_URL;
  }

  if (/^https?:\/\//i.test(configuredValue)) {
    return configuredValue.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    return new URL(configuredValue, window.location.origin).toString().replace(/\/+$/, "");
  }

  return configuredValue.replace(/\/+$/, "");
}

function toAuthApiUrl(pathname: string): string {
  const base = resolveAuthApiBaseUrl();
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function toErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }

    if (Array.isArray(message) && message.length > 0) {
      return message
        .filter((entry): entry is string => typeof entry === "string")
        .join(". ");
    }
  }

  return fallback;
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text.trim().length > 0 ? text : null;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(toAuthApiUrl(pathname), init);
  } catch {
    throw new Error(
      "Unable to reach auth service. Confirm qwerio-api is running and reachable from this app origin.",
    );
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      toErrorMessage(
        payload,
        `Auth request failed with status ${response.status}.`,
      ),
    );
  }

  return payload as T;
}

export function getGithubLoginUrl(): string {
  return toAuthApiUrl("/auth/github");
}

export async function startGithubDeviceFlow(): Promise<GithubDeviceStartResult> {
  return requestJson<GithubDeviceStartResult>("/auth/github/device/start", {
    method: "POST",
  });
}

export async function pollGithubDeviceFlow(
  deviceCode: string,
): Promise<GithubDevicePollResult> {
  return requestJson<GithubDevicePollResult>("/auth/github/device/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceCode,
    }),
  });
}

export async function requestEmailOtp(email: string): Promise<OtpRequestResult> {
  return requestJson<OtpRequestResult>("/auth/email/request-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
    }),
  });
}

export async function verifyEmailOtp(
  email: string,
  otp: string,
): Promise<AuthResult> {
  return requestJson<AuthResult>("/auth/email/verify-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      otp,
    }),
  });
}

export async function getAuthMe(accessToken: string): Promise<AuthenticatedUser> {
  return requestJson<AuthenticatedUser>("/auth/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
