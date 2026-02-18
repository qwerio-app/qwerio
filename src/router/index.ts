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
          path: "connections",
          name: "connections",
          component: () => import("../views/ConnectionsView.vue"),
        },
        {
          path: "tables/:tableTabId",
          name: "table",
          component: () => import("../views/TableView.vue"),
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
