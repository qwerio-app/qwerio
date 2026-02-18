export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  metaDescription: string;
  webAppUrl: string;
  desktopAppUrl: string;
  companyName: string;
  contactEmail: string;
  lastUpdated: string;
}

export const siteConfig: SiteConfig = {
  siteName: "Qwerio",
  siteUrl: "https://example.com",
  metaDescription:
    "Qwerio is a dual-mode SQL workspace for teams that need fast, secure querying on web and desktop.",
  webAppUrl: "https://app.example.com",
  desktopAppUrl: "https://example.com/download",
  companyName: "Qwerio Labs, Inc.",
  contactEmail: "legal@example.com",
  lastUpdated: "February 18, 2026",
};
