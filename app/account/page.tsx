import { redirect } from "next/navigation";

// /account and /settings used to duplicate each other; the account
// surface now lives in the tabbed settings, starting at Profile.
export default function AccountPage() {
  redirect("/settings/profile");
}
