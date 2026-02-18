import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.LANDING_SITE_URL ?? "https://example.com",
});
