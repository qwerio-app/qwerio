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
          redirect: { name: "workbench" },
        },
        {
          path: "workbench",
          name: "workbench",
          component: () => import("../views/WorkbenchView.vue"),
        },
        {
          path: "connections",
          name: "connections",
          component: () => import("../views/ConnectionsView.vue"),
        },
        {
          path: "settings",
          redirect: { name: "workbench" },
        },
      ],
    },
  ],
});

export default router;
