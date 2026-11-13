import Link from "next/link";

export default function NotFound() {
  return (
    <section className="error-page">
      <span className="eyebrow">404 · Not found</span>
      <h1>This page took a different turn.</h1>
      <p>The address may be outdated, or the page may have moved.</p>
      <Link href="/" className="button button-primary">Back to home <span aria-hidden="true">↗</span></Link>
    </section>
  );
}
