<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { LoaderCircle, RefreshCcw } from "lucide-vue-next";
import { useAuthStore } from "../stores/auth";
import { useSubscriptionStore } from "../stores/subscription";

const authStore = useAuthStore();
const subscriptionStore = useSubscriptionStore();

const teamSeatCount = ref(4);
const feedback = ref("");
const feedbackError = ref("");
const isBootstrapping = ref(false);

const hasSubscriptions = computed(
  () => subscriptionStore.subscriptions.length > 0,
);

function formatDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleDateString();
}

function normalizeTeamSeatCount(): number {
  const rounded = Math.round(Number(teamSeatCount.value));

  if (!Number.isFinite(rounded)) {
    return 1;
  }

  if (rounded < 1) {
    return 1;
  }

  if (rounded > 20) {
    return 20;
  }

  return rounded;
}

async function refreshSubscriptionState(showFeedback: boolean): Promise<void> {
  if (!authStore.isAuthenticated) {
    return;
  }

  isBootstrapping.value = true;
  feedback.value = "";
  feedbackError.value = "";

  try {
    await authStore.refreshCurrentUser();
    subscriptionStore.hydrateFromAuthUser(authStore.currentUser);
    await subscriptionStore.refreshSubscriptions();

    if (showFeedback) {
      feedback.value = "Subscription status refreshed.";
    }
  } catch (error) {
    if (!subscriptionStore.subscriptionsError) {
      feedbackError.value =
        error instanceof Error ? error.message : "Failed to refresh subscription state.";
    }
  } finally {
    isBootstrapping.value = false;
  }
}

async function startSoloCheckout(): Promise<void> {
  feedback.value = "";
  feedbackError.value = "";

  try {
    await subscriptionStore.startCheckout("solo");
  } catch {
    return;
  }
}

async function startTeamCheckout(): Promise<void> {
  feedback.value = "";
  feedbackError.value = "";
  teamSeatCount.value = normalizeTeamSeatCount();

  try {
    await subscriptionStore.startCheckout("team", teamSeatCount.value);
  } catch {
    return;
  }
}

watch(
  () => authStore.currentUser,
  (user) => {
    subscriptionStore.hydrateFromAuthUser(user);
  },
  { immediate: true },
);

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    if (isAuthenticated) {
      void refreshSubscriptionState(false);
    }
  },
);

onMounted(() => {
  if (authStore.isAuthenticated) {
    void refreshSubscriptionState(false);
  }
});
</script>

<template>
  <div class="qwerio-scroll min-h-0 flex-1 overflow-auto">
    <section class="panel-tight p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
          >
            Subscriptions
          </h2>
          <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
            Choose a subscription plan, then create a team when you have an
            unassigned team subscription.
          </p>
        </div>

        <button
          v-if="authStore.isAuthenticated"
          type="button"
          class="chrome-btn inline-flex items-center gap-1 !px-2.5 !py-1.5 text-[11px]"
          :disabled="subscriptionStore.isRefreshingSubscriptions || isBootstrapping"
          @click="refreshSubscriptionState(true)"
        >
          <RefreshCcw :size="13" />
          Refresh
        </button>
      </div>

      <template v-if="authStore.isHydrating || isBootstrapping">
        <div class="mt-3 inline-flex items-center gap-2 text-xs text-[var(--chrome-ink-dim)]">
          <LoaderCircle :size="13" class="animate-spin" />
          <span>Loading subscription data...</span>
        </div>
      </template>

      <template v-else-if="!authStore.isAuthenticated">
        <div class="chrome-empty mt-3 p-3 text-xs">
          Sign in from the profile button in the header to manage your
          subscription.
        </div>
      </template>

      <template v-else>
        <p
          v-if="feedback"
          class="mt-3 rounded-[3px] border border-[rgba(21,208,130,0.5)] bg-[var(--chrome-green-soft)] px-2 py-1.5 text-xs text-[var(--chrome-green)]"
        >
          {{ feedback }}
        </p>

        <p
          v-if="feedbackError"
          class="mt-3 rounded-[3px] border border-[rgba(255,82,82,0.5)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-xs text-[#ffb9b9]"
        >
          {{ feedbackError }}
        </p>

        <p
          v-if="subscriptionStore.subscriptionsError"
          class="mt-3 rounded-[3px] border border-[rgba(255,82,82,0.5)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-xs text-[#ffb9b9]"
        >
          {{ subscriptionStore.subscriptionsError }}
        </p>

        <p
          v-if="subscriptionStore.checkoutError"
          class="mt-3 rounded-[3px] border border-[rgba(255,82,82,0.5)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-xs text-[#ffb9b9]"
        >
          {{ subscriptionStore.checkoutError }}
        </p>

        <section v-if="hasSubscriptions" class="mt-4">
          <h3
            class="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--chrome-ink-dim)]"
          >
            Your Subscriptions
          </h3>

          <div class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <article
              v-for="subscription in subscriptionStore.subscriptions"
              :key="subscription.id"
              class="border border-[var(--chrome-border)] bg-[#0f141d] p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink)]">
                  {{ subscription.type }}
                </p>
                <span
                  class="chrome-pill"
                  :class="
                    subscription.status === 'active'
                      ? 'chrome-pill-ok'
                      : 'chrome-pill-bad'
                  "
                >
                  {{ subscription.status }}
                </span>
              </div>

              <dl class="mt-3 space-y-1 text-xs text-[var(--chrome-ink-dim)]">
                <div class="flex items-center justify-between gap-2">
                  <dt>Subscription</dt>
                  <dd class="text-[var(--chrome-ink)]">{{ subscription.id }}</dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt>Seats</dt>
                  <dd class="text-[var(--chrome-ink)]">
                    {{ subscription.seatCount ?? "n/a" }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt>Team</dt>
                  <dd class="text-[var(--chrome-ink)]">
                    {{ subscription.teamId ?? "Not assigned" }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt>Period ends</dt>
                  <dd class="text-[var(--chrome-ink)]">
                    {{ formatDate(subscription.currentPeriodEnd) }}
                  </dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section v-else class="mt-4">
          <h3
            class="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--chrome-ink-dim)]"
          >
            Start a Subscription
          </h3>

          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <article class="border border-[var(--chrome-border)] bg-[#0f141d] p-4">
              <h4 class="font-display text-lg font-semibold text-[var(--chrome-ink)]">
                Solo
              </h4>
              <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
                Single-user access for personal usage.
              </p>
              <button
                type="button"
                class="chrome-btn chrome-btn-primary mt-4"
                :disabled="subscriptionStore.isStartingCheckout"
                @click="startSoloCheckout"
              >
                {{ subscriptionStore.isStartingCheckout ? "Starting..." : "Checkout solo" }}
              </button>
            </article>

            <article class="border border-[var(--chrome-border)] bg-[#0f141d] p-4">
              <h4 class="font-display text-lg font-semibold text-[var(--chrome-ink)]">
                Team
              </h4>
              <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
                Team workspace with configurable seats.
              </p>

              <label class="chrome-label mt-4" for="team-seat-count">
                Seats (1-20)
              </label>
              <input
                id="team-seat-count"
                v-model.number="teamSeatCount"
                type="number"
                min="1"
                max="20"
                class="chrome-input chrome-input-sm mt-1 w-24"
              />

              <button
                type="button"
                class="chrome-btn chrome-btn-primary mt-4"
                :disabled="subscriptionStore.isStartingCheckout"
                @click="startTeamCheckout"
              >
                {{ subscriptionStore.isStartingCheckout ? "Starting..." : "Checkout team" }}
              </button>
            </article>
          </div>
        </section>
      </template>
    </section>
  </div>
</template>
