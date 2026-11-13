import type { Metadata } from "next";
import SignInForm from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Xyro AI account.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <section className="auth-page page-width">
      <div className="auth-intro">
        <span className="eyebrow">Your Xyro AI workspace</span>
        <h1>A little more room<br />to think.</h1>
        <p>Sign in to save your account profile and continue to your workspace.</p>
        <p className="auth-caveat">
          Chat and AI features are not available yet. Your account profile is
          stored privately in your own Firebase user record.
        </p>
      </div>
      <SignInForm />
    </section>
  );
}
