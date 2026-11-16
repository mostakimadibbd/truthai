# Xyro Control — private admin panel

A separate app from the product. It is linked from nowhere in
Xyro AI (no menu item, no settings link, no public route), it is
noindexed, and it holds no data of its own: its server proxies
every request to the Python backend's admin API
(`backend/app/admin.py`), which verifies three credentials on
every call — the shared service token, a dedicated admin secret
that exists only on the backend and this panel, and the
signed-in administrator's Firebase ID token — and then checks
the account's `admin` field in Firestore. Knowing any single
address or secret is not enough to read a single row.

## Deploy (Vercel)

Create a THIRD project from this repository with:

- **Root directory:** `admin-panel`
- **Framework:** Next.js (auto-detected)

Environment variables on the panel project:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | same as the main app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same as the main app |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same as the main app |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same as the main app |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same as the main app |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same as the main app |
| `BACKEND_URL` | the backend service's address (server-only) |
| `BACKEND_SERVICE_TOKEN` | the shared service token (server-only) |
| `ADMIN_API_SECRET` | the dedicated admin secret (server-only) |

One more variable on the **backend** project:

| Name | Value |
| --- | --- |
| `ADMIN_API_SECRET` | the same dedicated admin secret |

None of `BACKEND_URL`, `BACKEND_SERVICE_TOKEN` or
`ADMIN_API_SECRET` is `NEXT_PUBLIC_`, so none of them ever
reaches a browser.

## Who can sign in

Anyone with a Xyro account can complete the sign-in form, but
the backend returns 403 and the panel shows nothing unless the
account's Firestore document (`users/{uid}`) has
`admin: true` — or the account is on the bootstrap allowlist
(the owner's email). Admins manage the flag for everyone else
from the Users tab (promote/demote), and can disable accounts;
every action is written to the `adminActions` audit collection.

## Notes

- The panel's domain must be added to Firebase Authentication →
  Settings → Authorized domains, or sign-in will be refused by
  Firebase.
- The main app's former `/admin` page and `/api/admin/*` routes
  are 404 stubs; structural tests keep them that way.
