<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Github,
  LoaderCircle,
  LogOut,
  Minus,
  Plus,
  Square,
  UserRound,
  X,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { md5 } from "../../lib/md5";
import type { GithubDeviceStartResult } from "../../core/auth-types";
import { getRuntimeMode } from "../../core/query-engine-service";
import { useAppTabsStore, type AppTab } from "../../stores/app-tabs";
import { useAuthStore } from "../../stores/auth";
import { useWorkbenchStore } from "../../stores/workbench";

const route = useRoute();
const router = useRouter();
const appTabsStore = useAppTabsStore();
const authStore = useAuthStore();
const workbenchStore = useWorkbenchStore();

const runtimeMode = getRuntimeMode();
const isDesktopRuntime = runtimeMode === "desktop";
const desktopWindow = isDesktopRuntime ? getCurrentWindow() : null;
const profileMenuRootElement = ref<HTMLElement | null>(null);
const isProfileMenuOpen = ref(false);
const emailInput = ref("");
const otpInput = ref("");
const otpRequestedEmail = ref<string | null>(null);
const otpExpiresAt = ref<string | null>(null);
const authMessage = ref("");
const authError = ref("");
const isRequestingOtp = ref(false);
const isVerifyingOtp = ref(false);
const isStartingGithub = ref(false);
const isPollingGithubDevice = ref(false);
const githubDeviceChallenge = ref<GithubDeviceStartResult | null>(null);
const githubDevicePollIntervalSeconds = ref<number>(5);
const githubDevicePollTimeoutId = ref<number | null>(null);
const hasProviderAvatarLoadError = ref(false);
const hasGravatarLoadError = ref(false);

const normalizedUserEmail = computed(
  () => authStore.currentUser?.email?.trim().toLowerCase() ?? "",
);

const providerAvatarUrl = computed(() => {
  const value = authStore.currentUser?.avatarUrl?.trim();
  return value && value.length > 0 ? value : null;
});

const gravatarAvatarUrl = computed(() => {
  if (!normalizedUserEmail.value) {
    return null;
  }

  const hash = md5(normalizedUserEmail.value);
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=128`;
});

const activeAvatarSource = computed<"provider" | "gravatar" | null>(() => {
  if (providerAvatarUrl.value && !hasProviderAvatarLoadError.value) {
    return "provider";
  }

  if (gravatarAvatarUrl.value && !hasGravatarLoadError.value) {
    return "gravatar";
  }

  return null;
});

const activeAvatarUrl = computed(() => {
  if (activeAvatarSource.value === "provider") {
    return providerAvatarUrl.value;
  }

  if (activeAvatarSource.value === "gravatar") {
    return gravatarAvatarUrl.value;
  }

  return null;
});

const userLabel = computed(() => {
  if (authStore.currentUser?.displayName) {
    return authStore.currentUser.displayName;
  }

  if (authStore.currentUser?.email) {
    return authStore.currentUser.email;
  }

  return "Authenticated user";
});

const userInitial = computed(() => {
  const normalized = userLabel.value.trim();
  return normalized.length > 0 ? normalized.charAt(0).toUpperCase() : null;
});

const hasEligibleTeamSubscription = computed(() =>
  (authStore.currentUser?.subscriptions ?? []).some(
    (subscription) =>
      subscription.type === "team" &&
      (subscription.teamId ?? "").trim().length === 0,
  ),
);

watch(
  providerAvatarUrl,
  () => {
    hasProviderAvatarLoadError.value = false;
  },
  { immediate: true },
);

watch(
  gravatarAvatarUrl,
  () => {
    hasGravatarLoadError.value = false;
  },
  { immediate: true },
);

function toQueryRoutePath(queryTabId: string): string {
  return `/query/${queryTabId}`;
}

function toTableRoutePath(tableTabId: string): string {
  return `/tables/${tableTabId}`;
}

function getTabTitle(tab: AppTab): string {
  if (tab.kind === "query") {
    return tab.title;
  }

  if (!tab.pageKey.startsWith("table:")) {
    return tab.title;
  }

  const tableTabId = tab.pageKey.slice("table:".length);
  const tableTab = workbenchStore.getTableTab(tableTabId);

  if (tableTab?.tableName) {
    return tableTab.tableName;
  }

  const dotIndex = tab.title.lastIndexOf(".");
  return dotIndex >= 0 ? tab.title.slice(dotIndex + 1) : tab.title;
}

watch(
  () => workbenchStore.tabs.map((tab) => ({ id: tab.id, title: tab.title })),
  (queryTabs) => {
    appTabsStore.syncQueryTabs(queryTabs);
  },
  { immediate: true },
);

watch(
  () =>
    [
      route.name,
      route.path,
      route.params.queryTabId,
      route.params.tableTabId,
      workbenchStore.activeTabId,
    ] as const,
  () => {
    if (route.name === "query") {
      const queryTabId =
        typeof route.params.queryTabId === "string"
          ? route.params.queryTabId
          : workbenchStore.activeTab?.id;
      const queryTab = queryTabId
        ? (workbenchStore.tabs.find((tab) => tab.id === queryTabId) ??
          workbenchStore.activeTab)
        : workbenchStore.activeTab;

      if (!queryTab) {
        return;
      }

      appTabsStore.openQueryTab({
        queryTabId: queryTab.id,
        title: queryTab.title,
        routePath: toQueryRoutePath(queryTab.id),
        activate: true,
      });
      return;
    }

    if (route.name === "table") {
      const tableTabId =
        typeof route.params.tableTabId === "string"
          ? route.params.tableTabId
          : "";
      const tableTab = tableTabId
        ? workbenchStore.getTableTab(tableTabId)
        : null;

      if (!tableTab) {
        const fallbackQuery = workbenchStore.activeTab;

        if (fallbackQuery) {
          appTabsStore.openQueryTab({
            queryTabId: fallbackQuery.id,
            title: fallbackQuery.title,
            routePath: toQueryRoutePath(fallbackQuery.id),
            activate: true,
          });
          void router.replace(toQueryRoutePath(fallbackQuery.id));
          return;
        }

        appTabsStore.clearActiveTab();
        void router.replace("/empty");
        return;
      }

      appTabsStore.openPageTab({
        pageKey: `table:${tableTabId}`,
        title: tableTab.title,
        routePath: toTableRoutePath(tableTabId),
        activate: true,
      });
      return;
    }

    appTabsStore.clearActiveTab();
  },
  { immediate: true },
);

async function minimizeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.minimize();
}

async function toggleMaximizeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.toggleMaximize();
}

async function closeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.close();
}

function handleProfileButtonClick(): void {
  isProfileMenuOpen.value = !isProfileMenuOpen.value;
  authError.value = "";
}

function handleAvatarLoadError(): void {
  if (activeAvatarSource.value === "provider") {
    hasProviderAvatarLoadError.value = true;
    return;
  }

  if (activeAvatarSource.value === "gravatar") {
    hasGravatarLoadError.value = true;
  }
}

function closeProfileMenu(): void {
  isProfileMenuOpen.value = false;
}

function clearOtpState(): void {
  otpInput.value = "";
  otpRequestedEmail.value = null;
  otpExpiresAt.value = null;
}

function clearGithubDevicePollTimer(): void {
  if (
    githubDevicePollTimeoutId.value == null ||
    typeof window === "undefined"
  ) {
    return;
  }

  window.clearTimeout(githubDevicePollTimeoutId.value);
  githubDevicePollTimeoutId.value = null;
}

function clearGithubDeviceState(): void {
  clearGithubDevicePollTimer();
  githubDeviceChallenge.value = null;
  githubDevicePollIntervalSeconds.value = 5;
  isPollingGithubDevice.value = false;
}

function scheduleGithubDevicePoll(seconds: number): void {
  if (typeof window === "undefined") {
    return;
  }

  const delaySeconds = Math.max(1, Math.floor(seconds));
  clearGithubDevicePollTimer();
  githubDevicePollTimeoutId.value = window.setTimeout(() => {
    void pollGithubDeviceLogin();
  }, delaySeconds * 1000);
}

async function openGithubDeviceVerification(): Promise<void> {
  const challenge = githubDeviceChallenge.value;
  if (!challenge) {
    return;
  }

  const verificationUrl =
    challenge.verificationUriComplete ?? challenge.verificationUri;

  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(verificationUrl);
  } catch (error) {
    authError.value =
      error instanceof Error
        ? error.message
        : "Unable to open the GitHub verification page.";
  }
}

async function pollGithubDeviceLogin(): Promise<void> {
  const challenge = githubDeviceChallenge.value;

  if (!challenge) {
    return;
  }

  const expiresAtTimestamp = Date.parse(challenge.expiresAt);
  if (!Number.isNaN(expiresAtTimestamp) && expiresAtTimestamp <= Date.now()) {
    authError.value = "GitHub device login expired. Start again.";
    clearGithubDeviceState();
    return;
  }

  isPollingGithubDevice.value = true;

  try {
    const result = await authStore.pollGithubDeviceLogin(challenge.deviceCode);
    if (result.status === "approved") {
      authMessage.value = "Signed in.";
      clearOtpState();
      clearGithubDeviceState();
      closeProfileMenu();
      return;
    }

    if (githubDeviceChallenge.value?.deviceCode !== challenge.deviceCode) {
      return;
    }

    if (result.status === "pending") {
      githubDevicePollIntervalSeconds.value = result.interval;
      authMessage.value = "Waiting for GitHub authorization...";
      scheduleGithubDevicePoll(result.interval);
      return;
    }

    if (result.status === "slow_down") {
      githubDevicePollIntervalSeconds.value = result.interval;
      authMessage.value = "GitHub asked to slow down polling. Waiting...";
      scheduleGithubDevicePoll(result.interval);
      return;
    }

    if (result.status === "denied") {
      authError.value = "GitHub login was canceled.";
      clearGithubDeviceState();
      return;
    }

    authError.value = "GitHub device login expired. Start again.";
    clearGithubDeviceState();
  } catch (error) {
    authError.value =
      error instanceof Error ? error.message : "GitHub login failed.";
    clearGithubDeviceState();
  } finally {
    isPollingGithubDevice.value = false;
  }
}

function formatExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) {
    return null;
  }

  const timestamp = Date.parse(expiresAt);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toLocaleTimeString();
}

async function requestOtp(): Promise<void> {
  const email = emailInput.value.trim().toLowerCase();

  if (email.length === 0) {
    authError.value = "Email is required.";
    return;
  }

  authError.value = "";
  authMessage.value = "";
  isRequestingOtp.value = true;

  try {
    const response = await authStore.requestLoginOtp(email);
    otpRequestedEmail.value = email;
    otpExpiresAt.value = response.expiresAt;
    otpInput.value = "";
    authMessage.value = response.otp
      ? `OTP sent. Development code: ${response.otp}`
      : "OTP sent. Check your email.";
  } catch (error) {
    authError.value =
      error instanceof Error ? error.message : "Failed to request OTP.";
  } finally {
    isRequestingOtp.value = false;
  }
}

async function verifyOtpLogin(): Promise<void> {
  const email =
    otpRequestedEmail.value ?? emailInput.value.trim().toLowerCase();
  const otp = otpInput.value.trim();

  if (email.length === 0) {
    authError.value = "Request an OTP code before verifying.";
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    authError.value = "OTP must be exactly 6 numbers.";
    return;
  }

  authError.value = "";
  authMessage.value = "";
  isVerifyingOtp.value = true;

  try {
    await authStore.verifyLoginOtp(email, otp);
    authMessage.value = "Signed in.";
    clearOtpState();
    closeProfileMenu();
  } catch (error) {
    authError.value =
      error instanceof Error ? error.message : "Failed to verify OTP.";
  } finally {
    isVerifyingOtp.value = false;
  }
}

async function loginWithGithub(): Promise<void> {
  authError.value = "";
  authMessage.value = "";
  isStartingGithub.value = true;

  try {
    if (isDesktopRuntime) {
      clearGithubDeviceState();
      const challenge = await authStore.startGithubDeviceLogin();
      githubDeviceChallenge.value = challenge;
      githubDevicePollIntervalSeconds.value = challenge.interval;
      authMessage.value = `Enter code ${challenge.userCode} on GitHub to continue.`;
      await openGithubDeviceVerification();

      scheduleGithubDevicePoll(challenge.interval);
      return;
    }

    authStore.beginGithubLogin();
  } catch (error) {
    authError.value =
      error instanceof Error ? error.message : "Failed to start GitHub login.";
  } finally {
    isStartingGithub.value = false;
  }
}

function signOut(): void {
  authStore.signOut();
  authMessage.value = "Signed out.";
  authError.value = "";
  clearOtpState();
  clearGithubDeviceState();
  emailInput.value = "";
  closeProfileMenu();
}

async function navigateToSubscriptions(): Promise<void> {
  closeProfileMenu();

  if (route.path !== "/subscriptions") {
    await router.push("/subscriptions");
  }
}

async function navigateToCreateTeam(): Promise<void> {
  closeProfileMenu();

  if (route.path !== "/teams/create") {
    await router.push("/teams/create");
  }
}

function handleDocumentPointerDown(event: Event): void {
  if (!isProfileMenuOpen.value) {
    return;
  }

  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  const menuRoot = profileMenuRootElement.value;

  if (!menuRoot || menuRoot.contains(target)) {
    return;
  }

  closeProfileMenu();
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }

  closeProfileMenu();
}

watch(
  () => authStore.hydrationError,
  (value) => {
    if (!value) {
      return;
    }

    authError.value = value;
  },
  { immediate: true },
);

watch(
  () => authStore.isAuthenticated,
  (value) => {
    if (value) {
      if (authMessage.value.startsWith("Waiting for GitHub authorization")) {
        authMessage.value = "Signed in.";
      }
      clearGithubDeviceState();
    }
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
  clearGithubDevicePollTimer();
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeyDown);
});

async function activateTab(tab: AppTab): Promise<void> {
  appTabsStore.setActiveTab(tab.id);

  if (tab.kind === "query") {
    workbenchStore.setActiveTab(tab.queryTabId);
  }

  if (route.path !== tab.routePath) {
    await router.push(tab.routePath);
  }
}

async function openNewQueryTab(): Promise<void> {
  const queryTab = workbenchStore.addTab();
  const appTab = appTabsStore.openQueryTab({
    queryTabId: queryTab.id,
    title: queryTab.title,
    routePath: toQueryRoutePath(queryTab.id),
    activate: true,
  });

  await activateTab(appTab);
}

async function closeTab(tab: AppTab): Promise<void> {
  if (tab.kind === "query") {
    const closed = workbenchStore.closeTab(tab.queryTabId);

    if (!closed) {
      return;
    }
  } else if (tab.pageKey.startsWith("table:")) {
    const tableTabId = tab.pageKey.slice("table:".length);
    workbenchStore.removeTableTab(tableTabId);
  }

  const nextTab = appTabsStore.closeTab(tab.id);

  if (nextTab) {
    await activateTab(nextTab);
    return;
  }

  appTabsStore.clearActiveTab();
  await router.replace("/empty");
}
</script>

<template>
  <header
    class="panel chrome-panel-header flex items-center justify-between gap-2 px-2.5 py-2 md:px-3"
  >
    <div
      class="qwerio-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5"
    >
      <button
        v-for="tab in appTabsStore.tabs"
        :key="tab.id"
        type="button"
        :class="[
          'inline-flex shrink-0 items-center gap-2 border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition',
          tab.id === appTabsStore.activeTabId
            ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
            : 'border-[var(--chrome-border)] bg-[#11161f] text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:text-[var(--chrome-ink)]',
        ]"
        @click="activateTab(tab)"
      >
        <span class="max-w-36 truncate">{{ getTabTitle(tab) }}</span>
        <X :size="13" class="opacity-80" @click.stop="closeTab(tab)" />
      </button>

      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center text-xs border border-[var(--chrome-border)] bg-[#11161f] px-1 py-1.5 text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border-strong)] hover:text-[var(--chrome-ink)]"
        aria-label="New query tab"
        @click="openNewQueryTab"
      >
        &nbsp;<Plus :size="13" />&nbsp;
      </button>
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-2">
      <div
        ref="profileMenuRootElement"
        class="relative inline-flex items-center rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] transition hover:border-[#525d74] hover:text-[var(--chrome-ink)]"
      >
        <button
          type="button"
          class="inline-flex size-7 shrink-0 items-center justify-center"
          aria-label="User profile"
          :aria-expanded="isProfileMenuOpen"
          @click="handleProfileButtonClick"
        >
          <img
            v-if="activeAvatarUrl"
            :src="activeAvatarUrl"
            alt="User avatar"
            class="size-full object-cover"
            @error="handleAvatarLoadError"
          />
          <span
            v-else-if="authStore.isAuthenticated && userInitial"
            class="inline-flex size-full items-center justify-center bg-[#141b2a] text-[10px] font-semibold text-[var(--chrome-ink)]"
          >
            {{ userInitial }}
          </span>
          <UserRound v-else :size="15" class="text-[var(--chrome-ink-muted)]" />
        </button>

        <div
          v-if="isProfileMenuOpen"
          class="panel-tight absolute right-0 top-9 z-40 w-[18.25rem] p-3"
        >
          <div class="flex flex-col gap-2 text-[0.72rem]">
            <p
              v-if="authError"
              class="rounded-[3px] border border-[rgba(255,82,82,0.5)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-[#ffb9b9]"
            >
              {{ authError }}
            </p>

            <p
              v-if="authMessage"
              class="rounded-[3px] border border-[rgba(21,208,130,0.55)] bg-[var(--chrome-green-soft)] px-2 py-1.5 text-[var(--chrome-green)]"
            >
              {{ authMessage }}
            </p>

            <template v-if="authStore.isHydrating">
              <div
                class="inline-flex items-center gap-2 text-[var(--chrome-ink-dim)]"
              >
                <LoaderCircle :size="13" class="animate-spin" />
                <span>Loading auth session...</span>
              </div>
            </template>

            <template v-else-if="authStore.isAuthenticated">
              <div
                class="rounded-[3px] border border-[var(--chrome-border)] bg-[#101722] px-2 py-2"
              >
                <p class="font-semibold text-[var(--chrome-ink)]">
                  {{ userLabel }}
                </p>
                <p
                  v-if="authStore.currentUser?.email"
                  class="mt-0.5 truncate text-[var(--chrome-ink-dim)]"
                >
                  {{ authStore.currentUser.email }}
                </p>
                <p class="mt-1.5 text-[var(--chrome-ink-muted)]">
                  Session valid until
                  {{
                    formatExpiry(authStore.session?.expiresAt ?? null) ??
                    "unknown"
                  }}
                </p>
              </div>

              <div class="grid gap-1.5">
                <button
                  type="button"
                  class="chrome-btn text-left"
                  @click="navigateToSubscriptions"
                >
                  Manage subscription
                </button>
                <button
                  v-if="hasEligibleTeamSubscription"
                  type="button"
                  class="chrome-btn text-left"
                  @click="navigateToCreateTeam"
                >
                  Create team
                </button>
              </div>

              <button
                type="button"
                class="chrome-btn inline-flex items-center justify-between gap-1.5"
                @click="signOut"
              >
                Sign out
                <LogOut :size="13" />
              </button>
            </template>

            <template v-else>
              <button
                type="button"
                class="chrome-btn inline-flex items-center justify-center gap-2"
                :disabled="isStartingGithub || isPollingGithubDevice"
                @click="loginWithGithub"
              >
                <Github :size="13" />
                {{
                  isStartingGithub
                    ? "Starting GitHub..."
                    : "Continue with GitHub"
                }}
              </button>

              <div
                v-if="isDesktopRuntime && githubDeviceChallenge"
                class="rounded-[3px] border border-[var(--chrome-border)] bg-[#101722] px-2 py-2"
              >
                <p class="text-[var(--chrome-ink)]">
                  Enter code
                  <span class="font-semibold tracking-[0.08em]">
                    {{ githubDeviceChallenge.userCode }}
                  </span>
                  on GitHub.
                </p>
                <p class="mt-1 text-[var(--chrome-ink-dim)]">
                  Expires
                  {{
                    formatExpiry(githubDeviceChallenge.expiresAt) ??
                    githubDeviceChallenge.expiresAt
                  }}.
                </p>
                <button
                  type="button"
                  class="chrome-btn mt-2"
                  @click="openGithubDeviceVerification"
                >
                  Open GitHub verification page
                </button>
                <p
                  v-if="isPollingGithubDevice"
                  class="mt-1 inline-flex items-center gap-1 text-[var(--chrome-ink-dim)]"
                >
                  <LoaderCircle :size="12" class="animate-spin" />
                  Polling every {{ githubDevicePollIntervalSeconds }}s...
                </p>
              </div>

              <div class="h-px w-full bg-[var(--chrome-border)]" />

              <label class="chrome-label" for="auth-email-input">Email</label>
              <input
                id="auth-email-input"
                v-model.trim="emailInput"
                type="email"
                autocomplete="email"
                class="chrome-input chrome-input-xs"
                placeholder="user@example.com"
                @keyup.enter="requestOtp"
              />

              <button
                type="button"
                class="chrome-btn"
                :disabled="isRequestingOtp"
                @click="requestOtp"
              >
                {{ isRequestingOtp ? "Sending..." : "Send OTP" }}
              </button>

              <p v-if="otpRequestedEmail" class="text-[var(--chrome-ink-dim)]">
                OTP requested for {{ otpRequestedEmail
                }}<span v-if="otpExpiresAt">
                  (expires
                  {{ formatExpiry(otpExpiresAt) ?? otpExpiresAt }})</span
                >.
              </p>

              <label
                v-if="otpRequestedEmail"
                class="chrome-label"
                for="auth-otp-input"
              >
                6-digit OTP
              </label>
              <input
                v-if="otpRequestedEmail"
                id="auth-otp-input"
                v-model.trim="otpInput"
                type="text"
                inputmode="numeric"
                maxlength="6"
                class="chrome-input chrome-input-xs tracking-[0.22em]"
                placeholder="123456"
                @keyup.enter="verifyOtpLogin"
              />

              <button
                v-if="otpRequestedEmail"
                type="button"
                class="chrome-btn chrome-btn-primary"
                :disabled="isVerifyingOtp"
                @click="verifyOtpLogin"
              >
                {{ isVerifyingOtp ? "Verifying..." : "Verify OTP" }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <span
        v-if="isDesktopRuntime"
        class="inline-flex items-center rounded-[3px] border border-[var(--chrome-border)] bg-[#0f141d]"
      >
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center border-r border-[var(--chrome-border)] text-[var(--chrome-ink-dim)] transition hover:bg-[#1a212f] hover:text-[var(--chrome-ink)]"
          aria-label="Minimize window"
          @click="minimizeWindow"
        >
          <Minus :size="13" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center border-r border-[var(--chrome-border)] text-[var(--chrome-ink-dim)] transition hover:bg-[#1a212f] hover:text-[var(--chrome-ink)]"
          aria-label="Maximize window"
          @click="toggleMaximizeWindow"
        >
          <Square :size="11" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center text-[#ff8f8f] transition hover:bg-[#3a1117] hover:text-[#ffb3b3]"
          aria-label="Close window"
          @click="closeWindow"
        >
          <X :size="13" />
        </button>
      </span>
    </div>
  </header>
</template>
