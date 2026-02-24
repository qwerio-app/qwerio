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
const userAvatarUrl = ref<string | null>(null);

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
      const tableTab = tableTabId ? workbenchStore.getTableTab(tableTabId) : null;

      if (!tableTab) {
        const fallbackQuery = workbenchStore.activeTab ?? workbenchStore.addTab();
        appTabsStore.openQueryTab({
          queryTabId: fallbackQuery.id,
          title: fallbackQuery.title,
          routePath: toQueryRoutePath(fallbackQuery.id),
          activate: true,
        });
        void router.replace(toQueryRoutePath(fallbackQuery.id));
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

function closeProfileMenu(): void {
  isProfileMenuOpen.value = false;
}

function clearOtpState(): void {
  otpInput.value = "";
  otpRequestedEmail.value = null;
  otpExpiresAt.value = null;
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

function loginWithGithub(): void {
  authError.value = "";
  authMessage.value = "";
  isStartingGithub.value = true;

  try {
    authStore.beginGithubLogin();
  } finally {
    isStartingGithub.value = false;
  }
}

function signOut(): void {
  authStore.signOut();
  authMessage.value = "Signed out.";
  authError.value = "";
  clearOtpState();
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

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
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

  const fallbackQuery = workbenchStore.activeTab ?? workbenchStore.addTab();
  const fallbackAppTab = appTabsStore.openQueryTab({
    queryTabId: fallbackQuery.id,
    title: fallbackQuery.title,
    routePath: toQueryRoutePath(fallbackQuery.id),
    activate: true,
  });

  await activateTab(fallbackAppTab);
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
      <div ref="profileMenuRootElement" class="relative">
        <button
          type="button"
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] transition hover:border-[#525d74] hover:text-[var(--chrome-ink)]"
          aria-label="User profile"
          :aria-expanded="isProfileMenuOpen"
          @click="handleProfileButtonClick"
        >
          <img
            v-if="userAvatarUrl"
            :src="userAvatarUrl"
            alt="User avatar"
            class="size-5 rounded-full object-cover"
          />
          <span
            v-else-if="authStore.isAuthenticated && userInitial"
            class="inline-flex size-5 items-center justify-center rounded-full border border-[var(--chrome-border)] bg-[#141b2a] text-[10px] font-semibold text-[var(--chrome-ink)]"
          >
            {{ userInitial }}
          </span>
          <UserRound v-else :size="14" class="text-[var(--chrome-ink-muted)]" />
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
                class="chrome-btn inline-flex items-center justify-center gap-1.5"
                @click="signOut"
              >
                <LogOut :size="13" />
                Sign out
              </button>
            </template>

            <template v-else>
              <button
                type="button"
                class="chrome-btn inline-flex items-center justify-center gap-2"
                :disabled="isStartingGithub"
                @click="loginWithGithub"
              >
                <Github :size="13" />
                Continue with GitHub
              </button>

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
