import { notFound } from "next/navigation";

// There is no admin console in this app. Administration lives in
// a separate, unlinked panel app (see admin-panel/) that talks to
// the backend service — nothing in this product's UI or routes
// exposes it. This stub keeps the old path a plain 404.
export default function AdminPage() {
  notFound();
}
