import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia } from "pinia";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import App from "./App.vue";
import router from "./router";
import { queryClient } from "./lib/query-client";
import "./assets/main.css";
import "splitpanes/dist/splitpanes.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient });

app.mount("#app");
