<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { LoaderCircle, RefreshCcw } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useSubscriptionStore } from "../stores/subscription";

const router = useRouter();
const authStore = useAuthStore();
const subscriptionStore = useSubscriptionStore();

const teamName = ref("");
const selectedSubscriptionId = ref<string>("");
const errorMessage = ref("");
const isBootstrapping = ref(false);

const eligibleSubscriptions = computed(
  () => subscriptionStore.eligibleTeamSubscriptions,
);

watch(
  eligibleSubscriptions,
  (nextSubscriptions) => {
    if (
      selectedSubscriptionId.value &&
      nextSubscriptions.some(
        (subscription) => subscription.id === selectedSubscriptionId.value,
      )
    ) {
      return;
    }

    selectedSubscriptionId.value = nextSubscriptions[0]?.id ?? "";
  },
  { immediate: true },
);

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
      void hydrateSubscriptionState();
    }
  },
);

async function hydrateSubscriptionState(): Promise<void> {
  if (!authStore.isAuthenticated) {
    return;
  }

  isBootstrapping.value = true;
  errorMessage.value = "";

  try {
    await authStore.refreshCurrentUser();
    subscriptionStore.hydrateFromAuthUser(authStore.currentUser);
    await subscriptionStore.refreshSubscriptions();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to load team subscriptions.";
  } finally {
    isBootstrapping.value = false;
  }
}

async function submitTeam(): Promise<void> {
  errorMessage.value = "";

  if (!selectedSubscriptionId.value) {
    errorMessage.value = "Choose an eligible team subscription first.";
    return;
  }

  try {
    await subscriptionStore.createTeam(teamName.value, selectedSubscriptionId.value);
    await authStore.refreshCurrentUser();
    subscriptionStore.hydrateFromAuthUser(authStore.currentUser);

    const normalizedTeamName = teamName.value.trim();

    await router.push({
      path: "/connections",
      query: {
        teamCreated: "1",
        teamName: normalizedTeamName || "Team",
      },
    });
  } catch (error) {
    errorMessage.value =
      subscriptionStore.teamError ||
      (error instanceof Error ? error.message : "Failed to create team.");
  }
}

onMounted(() => {
  if (authStore.isAuthenticated) {
    void hydrateSubscriptionState();
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
            Create Team
          </h2>
          <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
            Use an unassigned team subscription to create a new team workspace.
          </p>
        </div>

        <button
          v-if="authStore.isAuthenticated"
          type="button"
          class="chrome-btn inline-flex items-center gap-1 !px-2.5 !py-1.5 text-[11px]"
          :disabled="subscriptionStore.isRefreshingSubscriptions || isBootstrapping"
          @click="hydrateSubscriptionState"
        >
          <RefreshCcw :size="13" />
          Refresh
        </button>
      </div>

      <template v-if="authStore.isHydrating || isBootstrapping">
        <div class="mt-3 inline-flex items-center gap-2 text-xs text-[var(--chrome-ink-dim)]">
          <LoaderCircle :size="13" class="animate-spin" />
          <span>Loading team subscriptions...</span>
        </div>
      </template>

      <template v-else-if="!authStore.isAuthenticated">
        <div class="chrome-empty mt-3 p-3 text-xs">
          Sign in from the profile button in the header before creating a team.
        </div>
      </template>

      <template v-else>
        <p
          v-if="errorMessage"
          class="mt-3 rounded-[3px] border border-[rgba(255,82,82,0.5)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-xs text-[#ffb9b9]"
        >
          {{ errorMessage }}
        </p>

        <section
          v-if="eligibleSubscriptions.length === 0"
          class="chrome-empty mt-4 p-4 text-xs"
        >
          <p>No eligible team subscription found.</p>
          <button
            type="button"
            class="chrome-btn mt-3"
            @click="router.push('/subscriptions')"
          >
            Manage subscription
          </button>
        </section>

        <form v-else class="mt-4 grid gap-3 md:max-w-xl" @submit.prevent="submitTeam">
          <label class="chrome-label" for="team-name-input">Team Name</label>
          <input
            id="team-name-input"
            v-model.trim="teamName"
            type="text"
            maxlength="80"
            class="chrome-input"
            placeholder="Engineering"
          />

          <label class="chrome-label" for="team-subscription-input">
            Team Subscription
          </label>
          <select
            id="team-subscription-input"
            v-model="selectedSubscriptionId"
            class="chrome-input"
          >
            <option
              v-for="subscription in eligibleSubscriptions"
              :key="subscription.id"
              :value="subscription.id"
            >
              {{ subscription.id }} · seats {{ subscription.seatCount ?? "n/a" }} · {{ subscription.status }}
            </option>
          </select>

          <div class="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              class="chrome-btn chrome-btn-primary"
              :disabled="subscriptionStore.isCreatingTeam"
            >
              {{ subscriptionStore.isCreatingTeam ? "Creating..." : "Create team" }}
            </button>
            <button
              type="button"
              class="chrome-btn"
              :disabled="subscriptionStore.isCreatingTeam"
              @click="router.push('/subscriptions')"
            >
              Cancel
            </button>
          </div>
        </form>
      </template>
    </section>
  </div>
</template>
