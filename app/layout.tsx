import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import PwaRegistration from "./pwa-registration";
import AuthSync from "@/components/auth-sync";
import SiteHeader from "@/components/site-header";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Xyro AI — think, make, and explore",
    template: "%s — Xyro AI",
  },
  description:
    "A thoughtful workspace for asking questions, exploring ideas, and creating with AI.",
  applicationName: "Xyro AI",
  openGraph: {
    type: "website",
    siteName: "Xyro AI",
    title: "Xyro AI — think, make, and explore",
    description:
      "A thoughtful workspace for asking questions, exploring ideas, and creating with AI.",
    url: siteUrl,
    images: [{ url: "/og.svg", width: 1200, height: 630, alt: "Xyro AI" }],
  },
  twitter: {
    card: "summary",
    title: "Xyro AI — think, make, and explore",
    description:
      "A thoughtful workspace for asking questions, exploring ideas, and creating with AI.",
  },
  manifest: "/manifest.webmanifest",
  robots:
    process.env.VERCEL_ENV === "preview"
      ? { index: false, follow: false }
      : { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090b0f" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Runs before first paint: reads the theme preference mirrored in
// localStorage by lib/theme-client.ts (the saved preference itself
// lives in Firestore via /api/settings), resolves "system" against
// the device colour scheme, and sets data-theme on <html> so
// globals.css paints the right theme with no flash. The script is
// served with the middleware CSP nonce, like Next's own scripts.
const THEME_INIT_SCRIPT = `try{var m=window.matchMedia("(prefers-color-scheme: light)");var applyTheme=function(){var t="system";try{t=window.localStorage.getItem("xyro-theme")||"system";}catch(e){}document.documentElement.dataset.theme=t==="light"||(t!=="dark"&&m.matches)?"light":"dark";};applyTheme();if(m.addEventListener){m.addEventListener("change",applyTheme);}}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Request-time rendering lets Next.js attach the middleware CSP nonce to its scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <PwaRegistration />
        <AuthSync />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="footer-top">
            <div>
              <Link className="wordmark footer-wordmark" href="/chat">
                <span className="wordmark-icon" aria-hidden="true">x</span>
                <span>xyro<span className="wordmark-light">ai</span></span>
              </Link>
              <p>A little more room to think.</p>
            </div>
            <div className="footer-links">
              <div>
                <span className="footer-heading">Explore</span>
                <Link href="/about">About</Link>
                <Link href="/company">Company</Link>
                <Link href="/pricing">Pricing</Link>
                <Link href="/changelog">Changelog</Link>
                <Link href="/xyroaidetect">XyroAIDetect</Link>
              </div>
              <div>
                <span className="footer-heading">Support</span>
                <Link href="/help">Help center</Link>
                <Link href="/faq">FAQ</Link>
                <Link href="/contact">Contact</Link>
                <Link href="/status">Status</Link>
              </div>
              <div>
                <span className="footer-heading">Trust &amp; data</span>
                <Link href="/security">Security</Link>
                <Link href="/privacy-center">Privacy center</Link>
                <Link href="/subprocessors">Subprocessors</Link>
                <Link href="/developers">Developers</Link>
              </div>
              <div>
                <span className="footer-heading">Legal</span>
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/acceptable-use">Acceptable use</Link>
                <Link href="/cookies">Cookies</Link>
                <Link href="/api-terms">API terms</Link>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Xyro AI</span>
            <span>AI can make mistakes. Keep your judgment in the loop.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
