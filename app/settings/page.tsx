import { redirect } from "next/navigation";

// Settings live under /settings/[tab] so every tab is deep-linkable;
// the bare /settings path lands on the profile tab.
export default function SettingsPage() {
  redirect("/settings/profile");
}
