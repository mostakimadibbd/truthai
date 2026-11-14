import type { Metadata } from "next";
import AccountPanel from "../account/account-panel";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Xyro AI account.",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <section className="settings-page page-width">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">Your account</span>
          <h1>Settings</h1>
          <p>Manage your profile and find the controls as they become available.</p>
        </div>
        <span className="workspace-badge"><i /> Private account</span>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#profile" aria-current="page">Profile</a>
          <a href="#security">Security</a>
          <a href="#developers">Developers</a>
          <a href="#privacy">Privacy</a>
        </nav>

        <div className="settings-sections">
          <section className="settings-content" id="profile">
            <h2>Profile</h2>
            <p>Your account information is private to your Firebase account.</p>
            <AccountPanel />
          </section>

          <section className="settings-content" id="security">
            <h2>Security</h2>
            <p>Session management and additional security controls are not available yet.</p>
            <span className="settings-placeholder">Not available yet</span>
          </section>

          <section className="settings-content" id="developers">
            <h2>Developers</h2>
            <p>API keys and developer access will appear here after those features are implemented.</p>
            <span className="settings-placeholder">Not available yet</span>
          </section>

          <section className="settings-content" id="privacy">
            <h2>Privacy</h2>
            <p>Read the current privacy notice to understand what this account foundation stores.</p>
            <a className="text-link" href="/privacy">Read the privacy notice <span aria-hidden="true">→</span></a>
          </section>
        </div>
      </div>
    </section>
  );
}
