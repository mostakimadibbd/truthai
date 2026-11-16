"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { panelAuth } from "@/lib/firebase-client";
import { apiErrorMessage, panelApi } from "@/lib/api";

type Totals = {
  requests: number;
  chatRequests: number;
  apiRequests: number;
  imageRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

type MinutePoint = Totals & { minute: string };
type ModelTotal = Totals & { model: string };
type TopUser = Totals & { uid: string; email: string | null };

type LedgerEntry = {
  id: string;
  ts: number;
  uid: string;
  email: string | null;
  surface: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  status: string;
};

type SearchEntry = {
  query: string;
  trigger: string;
  provider: string | null;
  resultCount: number;
  ts: number;
};

type ErrorEntry = {
  status: number | null;
  model: string | null;
  webInjected: boolean;
  error: string | null;
  ts: number;
};

type BackendInfo = {
  executionMode: string;
  watermarkEngine: string;
  integrations: Record<string, boolean>;
  integrationsOk: boolean;
};

type Overview = {
  today: string;
  totals: Totals;
  yesterday: Totals;
  week: (Totals & { day: string })[];
  minutes: MinutePoint[];
  models: ModelTotal[];
  topUsers: TopUser[];
  recentEvents: LedgerEntry[];
  recentSearches: SearchEntry[];
  recentErrors: ErrorEntry[];
  backend: BackendInfo;
};

type UserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  admin: boolean;
  role: "owner" | "admin" | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  requestsToday: number;
  totalTokensToday: number;
  costUsdToday: number;
};

type AuditEntry = {
  id: string;
  actorUid: string;
  actorRole: string | null;
  actorEmail: string | null;
  targetUid: string;
  targetEmail: string | null;
  action: string;
  ts: number;
};

type Tab = "overview" | "users" | "activity" | "system";
type ActionKind = "promote" | "demote" | "disable" | "enable" | "delete";
type UserFilter = "all" | "admins" | "disabled" | "unverified";
type UserSort = "tokens" | "joined" | "name";

/** Turn a backend error into the concrete fix, so a setup
 * problem never looks like a product bug. */
function hintFor(message: string): string | null {
  if (message.includes("Invalid service token")) {
    return "The service token this panel sends doesn’t match the backend’s. Set BACKEND_SERVICE_TOKEN to the same value on BOTH the backend project and this panel’s project, then redeploy both.";
  }
  if (message.includes("Invalid admin secret")) {
    return "The admin secret doesn’t match. Set ADMIN_API_SECRET to the same value on the backend project and this panel’s project, then redeploy both.";
  }
  if (message.includes("not configured") || message.includes("isn’t connected")) {
    return "A required environment variable is missing — on the backend: BACKEND_SERVICE_TOKEN, ADMIN_API_SECRET and the FIREBASE_ADMIN trio; on this panel: BACKEND_URL, BACKEND_SERVICE_TOKEN and ADMIN_API_SECRET.";
  }
  if (message.includes("could not be reached")) {
    return "The panel’s BACKEND_URL doesn’t point at the running backend service. Check that variable on this panel’s project.";
  }
  return null;
}

function delta(today: number, yesterday: number): string | null {
  if (yesterday <= 0) return today > 0 ? "new today" : null;
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return "same as yesterday";
  return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs yesterday`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

function usd(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function date(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ConsolePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [viewer, setViewer] = useState<{
    uid: string;
    role: string;
    registered: boolean;
  } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ uid: string; action: ActionKind; label: string } | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [userSort, setUserSort] = useState<UserSort>("tokens");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const auth = panelAuth();
    if (!auth) {
      setState("error");
      setErrorMessage("This panel isn’t configured yet (Firebase settings are missing).");
      return;
    }
    const stop = onAuthStateChanged(auth, (current) => {
      if (!current) {
        router.replace("/sign-in");
        return;
      }
      setUser(current);
    });
    return stop;
  }, [router]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [overviewRes, usersRes, auditRes] = await Promise.all([
        panelApi(user, "/api/overview"),
        panelApi(user, "/api/users"),
        panelApi(user, "/api/audit"),
      ]);
      if (overviewRes.status === 403 || usersRes.status === 403) {
        setState("forbidden");
        return;
      }
      if (!overviewRes.ok) {
        throw new Error(await apiErrorMessage(overviewRes, "Console data couldn’t be loaded."));
      }
      setOverview((await overviewRes.json()) as Overview);
      if (usersRes.ok) {
        const payload = (await usersRes.json()) as {
          users: UserRow[];
          viewer: { uid: string; role: string; registered: boolean };
        };
        setUsers(payload.users);
        setViewer(payload.viewer);
      }
      if (auditRes.ok) {
        const payload = (await auditRes.json()) as { entries: AuditEntry[] };
        setAudit(payload.entries);
      }
      setUpdatedAt(Date.now());
      setState("ready");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Console data couldn’t be loaded.");
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== "ready") return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load, state]);

  const runAction = useCallback(async () => {
    if (!user || !pending) return;
    setActing(true);
    setActionError("");
    try {
      const response = await panelApi(user, "/api/users", {
        method: "PATCH",
        body: { uid: pending.uid, action: pending.action },
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "That action couldn’t be completed."));
      }
      const done = pending;
      setPending(null);
      setToast(
        done.action === "promote"
          ? "Admin access granted."
          : done.action === "demote"
            ? "Admin access revoked."
            : done.action === "disable"
              ? "Account disabled."
              : done.action === "enable"
                ? "Account re-enabled."
                : "Account deleted.",
      );
      window.setTimeout(() => setToast(""), 4000);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That action couldn’t be completed.");
    } finally {
      setActing(false);
    }
  }, [user, pending, load]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = users.filter((row) => {
      if (
        needle &&
        !(
          row.email?.toLowerCase().includes(needle) ||
          row.displayName?.toLowerCase().includes(needle) ||
          row.uid.toLowerCase().includes(needle)
        )
      ) {
        return false;
      }
      if (userFilter === "admins") return row.admin;
      if (userFilter === "disabled") return row.disabled;
      if (userFilter === "unverified") return !row.emailVerified;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (userSort === "joined") return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      if (userSort === "name") {
        return (a.displayName || a.email || a.uid).localeCompare(
          b.displayName || b.email || b.uid,
        );
      }
      return b.totalTokensToday - a.totalTokensToday;
    });
    return rows;
  }, [users, query, userFilter, userSort]);

  const totals = overview?.totals;
  const maxMinute = Math.max(1, ...(overview?.minutes ?? []).map((point) => point.totalTokens));
  const promptShare =
    totals && totals.totalTokens > 0
      ? Math.round((totals.promptTokens / totals.totalTokens) * 100)
      : 0;

  async function onSignOut() {
    const auth = panelAuth();
    if (auth) await signOut(auth);
    router.replace("/sign-in");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">X</span>
          <div>
            <strong>Xyro Control</strong>
            <span>Operations console</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Console sections">
          {(
            [
              ["overview", "Overview", "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
              ["users", "Users & access", "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.85M15.5 3.15a3.5 3.5 0 0 1 0 6.7"],
              ["activity", "Activity", "M3 12h4l2.5-6 4 12L16 12h5"],
              ["system", "System", "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 15a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM7.5 7h.01M7.5 17h.01"],
            ] as [Tab, string, string][]
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "side-link active" : "side-link"}
              onClick={() => setTab(id)}
            >
              <svg
                className="side-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="muted small">{user?.email ?? ""}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1>
              {tab === "overview" && "Overview"}
              {tab === "users" && "Users & access"}
              {tab === "activity" && "Activity"}
              {tab === "system" && "System"}
            </h1>
            <p className="muted">
              {updatedAt
                ? `Updated ${time(updatedAt)} · auto-refresh 30s`
                : "Live platform data from the backend service."}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Refresh
          </button>
        </header>

        {toast && (
          <div className="toast" role="status">{toast}</div>
        )}
        {state === "loading" && (
          <div className="skeleton-wrap" role="status" aria-label="Loading console data">
            <div className="skeleton-row">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
            <div className="skeleton tall" />
          </div>
        )}
        {state === "forbidden" && (
          <section className="card">
            <h2>Not an administrator</h2>
            <p className="muted">
              You are signed in, but this account has no entry in the database’s{" "}
              <code>admins</code> registry, so the backend refused to send any data. Only
              the owner can add entries — from this console, or by creating the document{" "}
              <code>admins/&lt;your-uid&gt;</code> in Firestore. The owner’s own account is
              accepted automatically so the panel can be claimed the first time.
            </p>
          </section>
        )}
        {state === "error" && (
          <div className="alert" role="alert">
            <strong>{errorMessage}</strong>
            {hintFor(errorMessage) && <p className="hint">{hintFor(errorMessage)}</p>}
          </div>
        )}

        {state === "ready" && overview && totals && tab === "overview" && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <span>Tokens today</span>
                <strong>{totals.totalTokens.toLocaleString("en-US")}</strong>
                <small>
                  {totals.promptTokens.toLocaleString("en-US")} in ·{" "}
                  {totals.completionTokens.toLocaleString("en-US")} out
                  {delta(totals.totalTokens, overview.yesterday.totalTokens) && (
                    <> · {delta(totals.totalTokens, overview.yesterday.totalTokens)}</>
                  )}
                </small>
              </div>
              <div className="stat">
                <span>Requests today</span>
                <strong>{totals.requests.toLocaleString("en-US")}</strong>
                <small>
                  {totals.chatRequests} chat · {totals.apiRequests} API · {totals.imageRequests} images
                  {delta(totals.requests, overview.yesterday.requests) && (
                    <> · {delta(totals.requests, overview.yesterday.requests)}</>
                  )}
                </small>
              </div>
              <div className="stat">
                <span>Accounts</span>
                <strong>{users.length.toLocaleString("en-US")}</strong>
                <small>{users.filter((row) => row.admin).length} administrators</small>
              </div>
              <div className="stat">
                <span>Estimated cost today</span>
                <strong>{usd(totals.costUsd)}</strong>
                <small>{promptShare}% prompt tokens · free models meter at $0</small>
              </div>
            </div>

            <section className="card">
              <h2>Token flow — last 60 minutes (UTC {overview.today})</h2>
              <div className="chart" role="img" aria-label="Tokens per minute for the last hour">
                {overview.minutes.map((point) => (
                  <div
                    className="chart-col"
                    key={point.minute}
                    title={`${point.minute.slice(11)} UTC: ${point.totalTokens.toLocaleString("en-US")} tokens, ${point.requests} requests`}
                  >
                    <span className="chart-value">
                      {point.totalTokens > 0 ? compact.format(point.totalTokens) : ""}
                    </span>
                    <div className="chart-track">
                      <span style={{ height: `${Math.max(2, (point.totalTokens / maxMinute) * 100)}%` }} />
                    </div>
                    <span className="chart-label">
                      {point.minute.endsWith("0") || point.minute.endsWith("5")
                        ? point.minute.slice(11)
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Last 7 days — tokens per day</h2>
              <div
                className="chart"
                style={{ gridTemplateColumns: "repeat(7, 1fr)", height: "8rem" }}
                role="img"
                aria-label="Tokens per day for the last seven days"
              >
                {overview.week.map((point) => {
                  const maxWeek = Math.max(1, ...overview.week.map((d) => d.totalTokens));
                  return (
                    <div
                      className="chart-col"
                      key={point.day}
                      title={`${point.day}: ${point.totalTokens.toLocaleString("en-US")} tokens, ${point.requests} requests`}
                    >
                      <span className="chart-value">
                        {point.totalTokens > 0 ? compact.format(point.totalTokens) : ""}
                      </span>
                      <div className="chart-track">
                        <span style={{ height: `${Math.max(2, (point.totalTokens / maxWeek) * 100)}%` }} />
                      </div>
                      <span className="chart-label">
                        {new Date(`${point.day}T00:00:00Z`).toLocaleDateString("en-GB", {
                          weekday: "short",
                          timeZone: "UTC",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card">
              <h2>By model — today</h2>
              {overview.models.length === 0 && <p className="muted">No metered model calls yet today.</p>}
              {overview.models.length > 0 && (
                <div className="rows">
                  {overview.models.map((model) => (
                    <div className="row" key={model.model}>
                      <span><code>{model.model}</code></span>
                      <strong>
                        {model.totalTokens.toLocaleString("en-US")} tokens · {model.requests} requests ·{" "}
                        {usd(model.costUsd)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <h2>Top users — today</h2>
              {overview.topUsers.length === 0 && <p className="muted">No user activity yet today.</p>}
              {overview.topUsers.length > 0 && (
                <div className="rows">
                  {overview.topUsers.map((entry) => (
                    <div className="row" key={entry.uid}>
                      <span>{entry.email ?? entry.uid}</span>
                      <strong>
                        {entry.totalTokens.toLocaleString("en-US")} tokens · {entry.requests} requests
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {state === "ready" && tab === "users" && (
          <section className="card">
            <div className="card-head">
              <h2>All accounts</h2>
              <input
                className="search"
                type="search"
                placeholder="Search email, name or uid…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search accounts"
              />
            </div>
            <div className="chip-row" role="group" aria-label="Filter and sort accounts">
              {(
                [
                  ["all", "All"],
                  ["admins", "Admins"],
                  ["disabled", "Disabled"],
                  ["unverified", "Unverified"],
                ] as [UserFilter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={userFilter === id ? "chip active" : "chip"}
                  onClick={() => setUserFilter(id)}
                >
                  {label}
                </button>
              ))}
              <label className="sort-label">
                Sort
                <select
                  value={userSort}
                  onChange={(event) => setUserSort(event.target.value as UserSort)}
                  aria-label="Sort accounts"
                >
                  <option value="tokens">Tokens today</option>
                  <option value="joined">Recently joined</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            <p className="muted">
              Admin power lives in the database’s <code>admins</code> registry — one entry
              per admin uid, marked <code>owner</code> or <code>admin</code>.{" "}
              {viewer?.role === "owner" ? (
                <>
                  As the owner, only you can grant or revoke admin access, at any time;
                  revoking takes effect on that person’s next request. Every change is
                  written to the audit trail.
                </>
              ) : (
                <>
                  Only the owner can grant or revoke admin access — those controls are
                  hidden from your account, and the backend refuses them too.
                </>
              )}
            </p>
            {actionError && <div className="alert" role="alert">{actionError}</div>}
            {pending && (
              <div className="confirm-bar" role="group" aria-label="Confirm action">
                <span>{pending.label}</span>
                <button type="button" className="btn btn-primary" disabled={acting} onClick={() => void runAction()}>
                  Confirm
                </button>
                <button type="button" className="btn btn-ghost" disabled={acting} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            )}
            {filteredUsers.length === 0 && <p className="muted">No accounts match.</p>}
            {filteredUsers.length > 0 && (
              <ul className="user-list">
                {filteredUsers.map((entry) => {
                  const isSelf = user?.uid === entry.uid;
                  return (
                    <li key={entry.uid}>
                      <div className="user-main">
                        <span className="user-name">
                          {entry.displayName || entry.email || entry.uid}
                          {entry.role === "owner" && (
                            <span className="badge badge-owner">Owner</span>
                          )}
                          {entry.role === "admin" && (
                            <span className="badge badge-admin">Admin</span>
                          )}
                          {isSelf && <span className="badge">You</span>}
                          {entry.disabled && <span className="badge badge-warn">Disabled</span>}
                          {!entry.emailVerified && <span className="badge">Unverified</span>}
                        </span>
                        <span className="muted small">
                          {entry.email ?? entry.uid} · {entry.totalTokensToday.toLocaleString("en-US")}{" "}
                          tokens today · {entry.requestsToday} requests · joined {date(entry.createdAt)} ·
                          last sign-in {date(entry.lastSignInAt)}
                        </span>
                      </div>
                      <div className="user-actions">
                        {viewer?.role === "owner" && isSelf && !viewer.registered && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={acting}
                            onClick={() =>
                              setPending({
                                uid: entry.uid,
                                action: "promote",
                                label:
                                  "Record your owner entry in the database’s admins registry? From then on the registry itself is the source of truth for your access.",
                              })
                            }
                          >
                            Claim owner entry
                          </button>
                        )}
                        {viewer?.role === "owner" &&
                          !isSelf &&
                          (!entry.admin ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={acting}
                              onClick={() =>
                                setPending({
                                  uid: entry.uid,
                                  action: "promote",
                                  label: `Make ${entry.email ?? entry.uid} an admin? They will be able to use this console (but not grant admin access to others).`,
                                })
                              }
                            >
                              Make admin
                            </button>
                          ) : (
                            entry.role !== "owner" && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={acting}
                                onClick={() =>
                                  setPending({
                                    uid: entry.uid,
                                    action: "demote",
                                    label: `Remove admin power from ${entry.email ?? entry.uid}? It takes effect on their next request.`,
                                  })
                                }
                              >
                                Remove admin
                              </button>
                            )
                          ))}
                        {!isSelf &&
                          (!entry.disabled ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={acting}
                              onClick={() =>
                                setPending({
                                  uid: entry.uid,
                                  action: "disable",
                                  label: `Disable ${entry.email ?? entry.uid}? They will no longer be able to sign in.`,
                                })
                              }
                            >
                              Disable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={acting}
                              onClick={() =>
                                setPending({
                                  uid: entry.uid,
                                  action: "enable",
                                  label: `Re-enable ${entry.email ?? entry.uid} so they can sign in again?`,
                                })
                              }
                            >
                              Enable
                            </button>
                          ))}
                        {viewer?.role === "owner" && !isSelf && entry.role !== "owner" && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={acting}
                            onClick={() =>
                              setPending({
                                uid: entry.uid,
                                action: "delete",
                                label: `Permanently delete the account ${entry.email ?? entry.uid}? Their sign-in and profile are removed. This cannot be undone.`,
                              })
                            }
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {state === "ready" && overview && tab === "activity" && (
          <>
            <section className="card">
              <h2>Admin actions — audit trail</h2>
              {audit.length === 0 && (
                <p className="muted">No admin actions recorded yet. Grants, revocations, disables and deletions appear here.</p>
              )}
              {audit.length > 0 && (
                <ul className="plain-list">
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      <span>
                        {entry.action === "promote" && "Granted admin"}
                        {entry.action === "demote" && "Revoked admin"}
                        {entry.action === "disable" && "Disabled account"}
                        {entry.action === "enable" && "Re-enabled account"}
                        {entry.action === "delete" && "Deleted account"}
                        {!["promote", "demote", "disable", "enable", "delete"].includes(entry.action) &&
                          entry.action}{" "}
                        <span className="badge">{entry.actorRole ?? "admin"}</span>
                      </span>
                      <span className="muted small">
                        {entry.actorEmail ?? entry.actorUid} → {entry.targetEmail ?? entry.targetUid} ·{" "}
                        {new Date(entry.ts).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {overview.recentErrors.length > 0 && (
              <section className="card">
                <h2>Model failures — latest</h2>
                <ul className="plain-list">
                  {overview.recentErrors.map((entry, index) => (
                    <li key={`${entry.ts}-${index}`}>
                      <span>
                        {entry.model ?? "unknown model"}{" "}
                        <span className="badge badge-warn">{entry.status ?? "network"}</span>
                        {entry.webInjected && <span className="badge">with web results</span>}
                      </span>
                      <span className="muted small">
                        {entry.error ?? "No error body returned."} · {time(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card">
              <h2>Web searches — latest</h2>
              {overview.recentSearches.length === 0 && <p className="muted">No web searches recorded yet.</p>}
              {overview.recentSearches.length > 0 && (
                <ul className="plain-list">
                  {overview.recentSearches.map((entry, index) => (
                    <li key={`${entry.ts}-${index}`}>
                      <span>
                        {entry.query || "(link)"} <span className="badge">{entry.trigger}</span>
                        {entry.resultCount === 0 && <span className="badge badge-warn">no results</span>}
                      </span>
                      <span className="muted small">
                        {entry.provider ?? "no provider"} · {entry.resultCount} results · {time(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Token ledger — latest</h2>
              {overview.recentEvents.length === 0 && <p className="muted">No metered calls recorded yet.</p>}
              {overview.recentEvents.length > 0 && (
                <ul className="plain-list">
                  {overview.recentEvents.map((entry) => (
                    <li key={entry.id}>
                      <span>
                        {entry.model ?? entry.surface} <span className="badge">{entry.surface}</span>
                        {entry.status !== "success" && (
                          <span className="badge badge-warn">{entry.status}</span>
                        )}
                      </span>
                      <span className="muted small">
                        {entry.totalTokens.toLocaleString("en-US")} tokens ({entry.promptTokens.toLocaleString("en-US")} in /{" "}
                        {entry.completionTokens.toLocaleString("en-US")} out) · {usd(entry.costUsd)} ·{" "}
                        {entry.email ?? entry.uid} · {time(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {state === "ready" && overview && tab === "system" && (
          <section className="card">
            <h2>Backend service</h2>
            <div className="rows">
              <div className="row">
                <span>Execution mode</span>
                <strong>
                  {overview.backend.executionMode === "sync"
                    ? "Serverless (synchronous)"
                    : "Persistent (durable jobs)"}
                </strong>
              </div>
              <div className="row">
                <span>Watermark engine</span>
                <strong>{overview.backend.watermarkEngine === "c" ? "Native C core" : "Python"}</strong>
              </div>
              {Object.entries(overview.backend.integrations).map(([name, ok]) => (
                <div className="row" key={name}>
                  <span>{name}</span>
                  <strong className={ok ? "ok" : "bad"}>{ok ? "Connected" : "Not configured"}</strong>
                </div>
              ))}
            </div>
            <p className="muted">
              This panel reaches the backend over a server-to-server connection protected by
              two secrets plus your verified admin sign-in. The service’s address is never
              sent to this browser — only its state is shown here.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
