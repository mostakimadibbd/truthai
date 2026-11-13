import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

const siteUrl = "https://xyro.ai";

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
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a090d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link className="wordmark" href="/" aria-label="Xyro AI home">
            <span className="wordmark-icon" aria-hidden="true">x</span>
            <span>xyro<span className="wordmark-light">ai</span></span>
          </Link>
          <nav className="main-nav" aria-label="Main navigation">
            <Link href="/about">About</Link>
            <Link href="/company">Company</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/help">Help</Link>
          </nav>
          <Link className="header-cta" href="/about">
            Explore Xyro AI <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="footer-top">
            <div>
              <Link className="wordmark footer-wordmark" href="/">
                <span className="wordmark-icon" aria-hidden="true">x</span>
                <span>xyro<span className="wordmark-light">ai</span></span>
              </Link>
              <p>Make room for better questions.</p>
            </div>
            <div className="footer-links">
              <div>
                <span className="footer-heading">Explore</span>
                <Link href="/about">About</Link>
                <Link href="/company">Company</Link>
                <Link href="/pricing">Pricing</Link>
                <Link href="/changelog">Changelog</Link>
              </div>
              <div>
                <span className="footer-heading">Resources</span>
                <Link href="/help">Help center</Link>
                <Link href="/xyroaidetect">XyroAIDetect</Link>
                <Link href="/contact">Contact</Link>
              </div>
              <div>
                <span className="footer-heading">Legal</span>
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/acceptable-use">Acceptable use</Link>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Xyro AI</span>
            <span>Thoughtful tools for curious people.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
