import type { Metadata } from "next";
import AccountPanel from "./account-panel";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <section className="account-page page-width">
      <span className="eyebrow">Xyro AI account</span>
      <h1>Your profile</h1>
      <p className="account-intro">
        Your profile is saved in your private Firestore user record.
      </p>
      <AccountPanel />
    </section>
  );
}
