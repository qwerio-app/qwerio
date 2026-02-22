import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { getAuthMe, getGithubLoginUrl, requestEmailOtp, verifyEmailOtp } from "../core/auth-api";
import {
  isAuthSessionExpired,
  loadAuthSessionFromStorage,
  saveAuthSessionToStorage,
  toAuthSession,
} from "../core/auth-session";
import type { AuthSession, OtpRequestResult } from "../core/auth-types";

type GithubCallbackParams = {
  accessToken: string;
  expiresAt: string;
};

function extractGithubCallbackParamsFromUrl(): GithubCallbackParams | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const accessToken = url.searchParams.get("accessToken")?.trim() ?? "";
  const expiresAt = url.searchParams.get("expiresAt")?.trim() ?? "";

  if (!accessToken || !expiresAt) {
    return null;
  }

  return {
    accessToken,
    expiresAt,
  };
}

function stripGithubCallbackParamsFromUrl(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const hadAccessToken = url.searchParams.has("accessToken");
  const hadExpiresAt = url.searchParams.has("expiresAt");

  if (!hadAccessToken && !hadExpiresAt) {
    return;
  }

  url.searchParams.delete("accessToken");
  url.searchParams.delete("expiresAt");

  const search = url.searchParams.toString();
  const nextLocation = `${url.pathname}${search.length > 0 ? `?${search}` : ""}${url.hash}`;
  window.history.replaceState({}, document.title, nextLocation);
}

export const useAuthStore = defineStore("auth", () => {
  const session = ref<AuthSession | null>(null);
  const hasHydrated = ref(false);
  const isHydrating = ref(true);
  const hydrationError = ref<string>("");

  watch(
    session,
    (value) => {
      if (!hasHydrated.value) {
        return;
      }

      void saveAuthSessionToStorage(value);
    },
    { deep: true },
  );

  async function applySessionFromGithubCallback(): Promise<boolean> {
    const callbackParams = extractGithubCallbackParamsFromUrl();

    if (!callbackParams) {
      return false;
    }

    stripGithubCallbackParamsFromUrl();

    const provisionalSession: AuthSession = {
      accessToken: callbackParams.accessToken,
      expiresAt: callbackParams.expiresAt,
      user: {
        id: "",
        email: null,
        displayName: null,
      },
    };

    if (isAuthSessionExpired(provisionalSession)) {
      throw new Error("GitHub login session already expired. Start login again.");
    }

    const user = await getAuthMe(callbackParams.accessToken);
    session.value = {
      ...provisionalSession,
      user,
    };

    return true;
  }

  async function hydrateSessionFromStorage(): Promise<void> {
    const storedSession = await loadAuthSessionFromStorage();

    if (!storedSession) {
      session.value = null;
      return;
    }

    if (isAuthSessionExpired(storedSession)) {
      session.value = null;
      return;
    }

    try {
      const user = await getAuthMe(storedSession.accessToken);
      session.value = {
        ...storedSession,
        user,
      };
    } catch {
      session.value = null;
    }
  }

  void (async () => {
    try {
      const appliedFromGithubRedirect = await applySessionFromGithubCallback();

      if (!appliedFromGithubRedirect) {
        await hydrateSessionFromStorage();
      }

      hydrationError.value = "";
    } catch (error) {
      session.value = null;
      hydrationError.value =
        error instanceof Error
          ? error.message
          : "Authentication bootstrap failed.";
    } finally {
      hasHydrated.value = true;
      isHydrating.value = false;
      void saveAuthSessionToStorage(session.value);
    }
  })();

  const isAuthenticated = computed(
    () => !!session.value && !isAuthSessionExpired(session.value),
  );
  const accessToken = computed(() =>
    isAuthenticated.value ? session.value?.accessToken ?? null : null,
  );
  const currentUser = computed(() =>
    isAuthenticated.value ? session.value?.user ?? null : null,
  );

  function beginGithubLogin(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.location.assign(getGithubLoginUrl());
  }

  async function requestLoginOtp(email: string): Promise<OtpRequestResult> {
    return requestEmailOtp(email);
  }

  async function verifyLoginOtp(email: string, otp: string): Promise<void> {
    const authResult = await verifyEmailOtp(email, otp);
    const nextSession = toAuthSession(authResult);
    session.value = nextSession;
    await saveAuthSessionToStorage(nextSession);
  }

  async function refreshCurrentUser(): Promise<void> {
    const token = accessToken.value;

    if (!token || !session.value) {
      return;
    }

    const user = await getAuthMe(token);
    session.value = {
      ...session.value,
      user,
    };
  }

  function signOut(): void {
    session.value = null;
    void saveAuthSessionToStorage(null);
  }

  return {
    session,
    hasHydrated,
    isHydrating,
    hydrationError,
    isAuthenticated,
    accessToken,
    currentUser,
    beginGithubLogin,
    requestLoginOtp,
    verifyLoginOtp,
    refreshCurrentUser,
    signOut,
  };
});
