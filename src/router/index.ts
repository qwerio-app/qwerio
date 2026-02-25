import { createRouter, createWebHistory } from "vue-router";
import AppShell from "../layouts/AppShell.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: AppShell,
      children: [
        {
          path: "",
          redirect: { name: "query" },
        },
        {
          path: "query/:queryTabId?",
          name: "query",
          component: () => import("../views/QueryView.vue"),
        },
        {
          path: "empty",
          name: "empty",
          component: () => import("../views/EmptyView.vue"),
        },
        {
          path: "connections",
          name: "connections",
          component: () => import("../views/ConnectionsView.vue"),
        },
        {
          path: "subscriptions",
          name: "subscriptions",
          component: () => import("../views/SubscriptionView.vue"),
        },
        {
          path: "teams/create",
          name: "team-create",
          component: () => import("../views/TeamCreateView.vue"),
        },
        {
          path: "tables/:tableTabId",
          name: "table",
          component: () => import("../views/TableView.vue"),
        },
        {
          path: "collections/:collectionTabId",
          name: "collection",
          component: () => import("../views/CollectionView.vue"),
        },
        {
          path: "settings",
          name: "settings",
          component: () => import("../views/SettingsView.vue"),
        },
      ],
    },
  ],
});

export default router;
