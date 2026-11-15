// Settings tab registry, shared by the server route (app/settings/
// [tab]/page.tsx, which needs the list for params/validation) and the
// client shell that renders the navigation.
export const SETTINGS_TABS = [
  { id: "profile", label: "Profile" },
  { id: "general", label: "General" },
  { id: "personalization", label: "Personalization" },
  { id: "data", label: "Data controls" },
  { id: "security", label: "Security" },
  { id: "usage", label: "Usage" },
  { id: "account", label: "Account" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
