import type { SubscriptionSummary } from "./auth-types";

const DEFAULT_API_BASE_URL = "/api";

export type CheckoutPayload =
  | { type: "solo" }
  | { type: "team"; seatCount: number };

export type TeamSummary = {
  id: string;
  name: string;
  subscriptionId: string;
};

export type CreateTeamPayload = {
  name: string;
  subscriptionId: string;
};

function resolveApiBaseUrl(): string {
  const configuredValue = import.meta.env.VITE_QWERIO_API_BASE_URL?.trim();

  if (!configuredValue) {
    return DEFAULT_API_BASE_URL;
  }

  if (/^https?:\/\//i.test(configuredValue)) {
    return configuredValue.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    return new URL(configuredValue, window.location.origin).toString().replace(/\/+$/, "");
  }

  return configuredValue.replace(/\/+$/, "");
}

function toApiUrl(pathname: string): string {
  const base = resolveApiBaseUrl();
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function toErrorMessage(payload: unknown, fallback: string): string {
  const normalize = (message: string): string => {
    const trimmedMessage = message.trim();

    if (/Creem API request failed with status 500/i.test(trimmedMessage)) {
      return [
        "Checkout provider error: qwerio-api reached Creem but Creem rejected the checkout request.",
        "Verify qwerio-api subscription env values: CREEM_API_KEY, CREEM_API_BASE_URL (test/live), CREEM_PRODUCT_ID_SOLO/TEAM, CREEM_CHECKOUT_SUCCESS_URL, and CREEM_CHECKOUT_CANCEL_URL.",
      ].join(" ");
    }

    return trimmedMessage;
  };

  if (!payload) {
    return fallback;
  }

  if (typeof payload === "string") {
    return normalize(payload);
  }

  if (typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;

    if (typeof message === "string") {
      return normalize(message);
    }

    if (Array.isArray(message) && message.length > 0) {
      return normalize(
        message
        .filter((entry): entry is string => typeof entry === "string")
        .join(". "),
      );
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

async function requestJson<T>(
  pathname: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(toApiUrl(pathname), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new Error(
      "Unable to reach subscription service. Confirm qwerio-api is running and reachable from this app origin.",
    );
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      toErrorMessage(
        payload,
        `Subscription request failed with status ${response.status}.`,
      ),
    );
  }

  return payload as T;
}

function resolveCheckoutUrl(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Checkout response did not include a redirect URL.");
  }

  const checkoutUrl =
    (payload as { checkoutUrl?: unknown }).checkoutUrl ??
    (payload as { url?: unknown }).url;

  if (typeof checkoutUrl !== "string" || checkoutUrl.trim().length === 0) {
    throw new Error("Checkout response did not include a redirect URL.");
  }

  return checkoutUrl;
}

export async function getSubscriptions(
  accessToken: string,
): Promise<SubscriptionSummary[]> {
  return requestJson<SubscriptionSummary[]>("/subscriptions", accessToken, {
    method: "GET",
  });
}

export async function createCheckout(
  accessToken: string,
  payload: CheckoutPayload,
): Promise<{ checkoutUrl: string }> {
  const response = await requestJson<unknown>(
    "/subscriptions/checkout",
    accessToken,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  return {
    checkoutUrl: resolveCheckoutUrl(response),
  };
}

export async function createTeam(
  accessToken: string,
  payload: CreateTeamPayload,
): Promise<TeamSummary> {
  return requestJson<TeamSummary>("/teams", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getTeams(accessToken: string): Promise<TeamSummary[]> {
  return requestJson<TeamSummary[]>("/teams", accessToken, {
    method: "GET",
  });
}
