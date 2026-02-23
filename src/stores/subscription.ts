import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { AuthenticatedUser, SubscriptionSummary } from "../core/auth-types";
import {
  createCheckout,
  createTeam as createTeamRequest,
  getSubscriptions,
  getTeams,
  type TeamSummary,
} from "../core/subscription-api";
import { useAuthStore } from "./auth";

export const useSubscriptionStore = defineStore("subscription", () => {
  const authStore = useAuthStore();

  const subscriptions = ref<SubscriptionSummary[]>([]);
  const selectedSubscriptionId = ref<string | null>(null);
  const teams = ref<TeamSummary[]>([]);

  const isRefreshingSubscriptions = ref(false);
  const isLoadingTeams = ref(false);
  const isStartingCheckout = ref(false);
  const isCreatingTeam = ref(false);

  const subscriptionsError = ref("");
  const checkoutError = ref("");
  const teamError = ref("");

  const eligibleTeamSubscriptions = computed(() =>
    subscriptions.value.filter(
      (subscription) =>
        subscription.type === "team" &&
        (subscription.teamId ?? "").trim().length === 0,
    ),
  );

  function ensureSelectedSubscription(): void {
    if (
      selectedSubscriptionId.value &&
      subscriptions.value.some(
        (subscription) => subscription.id === selectedSubscriptionId.value,
      )
    ) {
      return;
    }

    selectedSubscriptionId.value = subscriptions.value[0]?.id ?? null;
  }

  function hydrateFromAuthUser(user: AuthenticatedUser | null): void {
    subscriptions.value = user?.subscriptions ?? [];
    ensureSelectedSubscription();
  }

  function ensureAccessToken(): string {
    const token = authStore.accessToken;

    if (!token) {
      throw new Error("Sign in to manage subscriptions.");
    }

    return token;
  }

  async function refreshSubscriptions(): Promise<void> {
    isRefreshingSubscriptions.value = true;
    subscriptionsError.value = "";

    try {
      const token = ensureAccessToken();
      subscriptions.value = await getSubscriptions(token);
      ensureSelectedSubscription();
    } catch (error) {
      subscriptionsError.value =
        error instanceof Error
          ? error.message
          : "Failed to load subscriptions.";
      throw error;
    } finally {
      isRefreshingSubscriptions.value = false;
    }
  }

  async function refreshTeams(): Promise<void> {
    isLoadingTeams.value = true;
    teamError.value = "";

    try {
      const token = ensureAccessToken();
      teams.value = await getTeams(token);
    } catch (error) {
      teamError.value =
        error instanceof Error ? error.message : "Failed to load teams.";
      throw error;
    } finally {
      isLoadingTeams.value = false;
    }
  }

  async function startCheckout(
    type: "solo" | "team",
    seatCount?: number,
  ): Promise<void> {
    isStartingCheckout.value = true;
    checkoutError.value = "";

    try {
      const token = ensureAccessToken();

      if (type === "team") {
        const normalizedSeatCount = Number(seatCount);

        if (
          !Number.isInteger(normalizedSeatCount) ||
          normalizedSeatCount < 1 ||
          normalizedSeatCount > 20
        ) {
          throw new Error("Team seat count must be between 1 and 20.");
        }

        const result = await createCheckout(token, {
          type: "team",
          seatCount: normalizedSeatCount,
        });
        window.location.assign(result.checkoutUrl);
        return;
      }

      const result = await createCheckout(token, {
        type: "solo",
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      checkoutError.value =
        error instanceof Error ? error.message : "Unable to start checkout.";
      throw error;
    } finally {
      isStartingCheckout.value = false;
    }
  }

  async function createTeam(
    name: string,
    subscriptionId: string,
  ): Promise<TeamSummary> {
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      throw new Error("Team name is required.");
    }

    if (!subscriptionId.trim()) {
      throw new Error("Choose a team subscription first.");
    }

    isCreatingTeam.value = true;
    teamError.value = "";

    try {
      const token = ensureAccessToken();
      const createdTeam = await createTeamRequest(token, {
        name: normalizedName,
        subscriptionId,
      });

      teams.value = teams.value.some((team) => team.id === createdTeam.id)
        ? teams.value.map((team) =>
            team.id === createdTeam.id ? createdTeam : team,
          )
        : [createdTeam, ...teams.value];

      subscriptions.value = subscriptions.value.map((subscription) =>
        subscription.id === subscriptionId
          ? {
              ...subscription,
              teamId: createdTeam.id,
            }
          : subscription,
      );

      ensureSelectedSubscription();
      return createdTeam;
    } catch (error) {
      teamError.value =
        error instanceof Error ? error.message : "Unable to create team.";
      throw error;
    } finally {
      isCreatingTeam.value = false;
    }
  }

  return {
    subscriptions,
    selectedSubscriptionId,
    teams,
    isRefreshingSubscriptions,
    isLoadingTeams,
    isStartingCheckout,
    isCreatingTeam,
    subscriptionsError,
    checkoutError,
    teamError,
    eligibleTeamSubscriptions,
    hydrateFromAuthUser,
    refreshSubscriptions,
    refreshTeams,
    startCheckout,
    createTeam,
  };
});
