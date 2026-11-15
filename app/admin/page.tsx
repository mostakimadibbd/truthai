import type { Metadata } from "next";
import AdminShell from "./admin-shell";

export const metadata: Metadata = {
  title: "Admin console",
  description: "Xyro AI platform analytics for administrators.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminShell />;
}
