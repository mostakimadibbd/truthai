import type { Metadata } from "next";
import SignInForm from "../sign-in/sign-in-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a Xyro AI account and start your workspace.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <SignInForm initialMode="sign-up" />;
}
