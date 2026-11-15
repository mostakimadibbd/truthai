import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SettingsShell from "../settings-shell";
import { SETTINGS_TABS, type SettingsTabId } from "@/lib/settings-tabs";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Xyro AI account.",
  robots: { index: false, follow: false },
};

const TAB_IDS = SETTINGS_TABS.map((tab) => tab.id) as readonly string[];

export function generateStaticParams() {
  return SETTINGS_TABS.map((tab) => ({ tab: tab.id }));
}

export default async function SettingsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  if (!TAB_IDS.includes(tab)) notFound();
  return <SettingsShell tab={tab as SettingsTabId} />;
}
