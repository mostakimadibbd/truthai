"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { tryGetFirebaseAuth } from "@/lib/firebase/auth-client";
import { getApiErrorMessage, settingsApi } from "@/lib/preferences-client";

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

type ModelTotal = {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

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

type BackendStatus = {
  configured: boolean;
  reachable: boolean;
  executionMode: string | null;
  watermarkEngine: string | null;
  integrationsOk: boolean | null;
};

type AdminUserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  admin: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  requestsToday: number;
  totalTokensToday: number;
  costUsdToday: number;
};

type AdminOverview = {
  today: string;
  backend?: BackendStatus;
  totals: Totals;
  minutes: MinutePoint[];
  models: ModelTotal[];
  topUsers: TopUser[];
  recentEvents: LedgerEntry[];
  recentSearches?: SearchEntry[];
  recentErrors?: ErrorEntry[];
};

function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

const compactNumber = new Intl.NumberFormat("en", { notation: "compact" });

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AdminShell() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [actingUid, setActingUid] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    uid: string;
    action: "promote" | "demote" | "disable" | "enable";
    label: string;
  } | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const auth = tryGetFirebaseAuth();
    if (!auth) {
      setState("error");
      setErrorMessage("Sign-in isn’t available right now.");
      return;
    }
    const stop = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace("/sign-in?next=/admin");
        return;
      }
      setUser(currentUser);
    });
    return stop;
  }, [router]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const response = await settingsApi(user, "/api/admin/overview", { method: "GET" });
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Admin data couldn’t be loaded."));
      }
      setData((await response.json()) as AdminOverview);
      setLastLoadedAt(Date.now());
      setState("ready");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Admin data couldn’t be loaded.");
    }
  }, [user]);

  const loadUsers = useCallback(async () => {
    if (!user) return;
    try {
      const response = await settingsApi(user, "/api/admin/users", { method: "GET" });
      if (!response.ok) return;
      const payload = (await response.json()) as { users: AdminUserRow[] };
      setUsers(payload.users);
    } catch {
      // The directory is best-effort beside the overview.
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state === "ready") void loadUsers();
  }, [loadUsers, state]);

  const runAction = useCallback(async () => {
    if (!user || !pendingAction) return;
    setActingUid(pendingAction.uid);
    setActionError("");
    try {
      const response = await settingsApi(user, "/api/admin/users", {
        method: "PATCH",
        body: { uid: pendingAction.uid, action: pendingAction.action },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "That action couldn’t be completed."));
      }
      setPendingAction(null);
      await loadUsers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That action couldn’t be completed.");
    } finally {
      setActingUid(null);
    }
  }, [user, pendingAction, loadUsers]);

  useEffect(() => {
    if (state !== "ready") return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load, state]);

  const totals = data?.totals;
  const maxMinute = Math.max(1, ...(data?.minutes ?? []).map((point) => point.totalTokens));
  const promptShare = totals && totals.totalTokens > 0
    ? Math.round((totals.promptTokens / totals.totalTokens) * 100)
    : 0;

  return (
    <main className="admin-page">
      <div className="admin-content">
        <div className="dev-head">
          <div>
            <h1>Admin console</h1>
            <p className="settings-hint">
              Platform token flow and cost, recorded in the background from every
              chat turn, API call and image creation. Visible to Xyro AI
              administrators only — these records are kept even when chats are
              deleted.
            </p>
          </div>
          <div className="settings-inline">
            {lastLoadedAt && (
              <span className="settings-hint">Updated {formatTime(lastLoadedAt)} · auto-refresh 30s</span>
            )}
            <button
              type="button"
              className="button button-outline"
              onClick={() => {
                void load();
                void loadUsers();
              }}
            >
              Refresh
            </button>
            <Link className="button button-outline" href="/settings/profile">Settings</Link>
          </div>
        </div>

        {state === "loading" && <p className="settings-hint" role="status">Loading admin data…</p>}
        {state === "forbidden" && (
          <div className="dev-card">
            <h3>Administrator access only</h3>
            <p className="settings-hint">
              This console is restricted to Xyro AI administrators. Your account
              isn’t marked as an admin in the database, so no platform data is
              shown.
            </p>
          </div>
        )}
        {state === "error" && <div className="auth-alert" role="alert">{errorMessage}</div>}

        {state === "ready" && data && totals && (
          <>
            <div className="dev-stat-grid">
              <div className="dev-stat">
                <span className="dev-stat-label">Tokens today</span>
                <span className="dev-stat-value">{totals.totalTokens.toLocaleString("en-US")}</span>
                <span className="dev-stat-sub">
                  {totals.promptTokens.toLocaleString("en-US")} in ·{" "}
                  {totals.completionTokens.toLocaleString("en-US")} out
                </span>
              </div>
              <div className="dev-stat">
                <span className="dev-stat-label">Requests today</span>
                <span className="dev-stat-value">{totals.requests.toLocaleString("en-US")}</span>
                <span className="dev-stat-sub">
                  {totals.chatRequests} chat · {totals.apiRequests} API · {totals.imageRequests} images
                </span>
              </div>
              <div className="dev-stat">
                <span className="dev-stat-label">Estimated cost today</span>
                <span className="dev-stat-value">{formatUsd(totals.costUsd)}</span>
                <span className="dev-stat-sub">at OpenRouter catalogue prices (free models: $0)</span>
              </div>
              <div className="dev-stat">
                <span className="dev-stat-label">Token flow</span>
                <span className="dev-stat-value">{promptShare}% prompt</span>
                <span className="dev-stat-sub">{100 - promptShare}% completion tokens</span>
              </div>
            </div>

            {data.backend && (
              <div className="dev-card">
                <span className="settings-label">Backend service</span>
                <div className="dev-defs">
                  <div>
                    <span>Status</span>
                    <strong>
                      {!data.backend.configured
                        ? "Not connected — chats run on the built-in path"
                        : data.backend.reachable
                          ? "Online"
                          : "Configured but unreachable — chats fall back to the built-in path"}
                    </strong>
                  </div>
                  {data.backend.configured && data.backend.reachable && (
                    <>
                      <div>
                        <span>Mode</span>
                        <strong>
                          {data.backend.executionMode === "sync"
                            ? "Serverless (synchronous)"
                            : data.backend.executionMode === "async"
                              ? "Persistent (durable jobs)"
                              : "Unknown"}
                          {data.backend.watermarkEngine
                            ? ` · watermark engine: ${data.backend.watermarkEngine}`
                            : ""}
                        </strong>
                      </div>
                      <div>
                        <span>Integrations</span>
                        <strong>
                          {data.backend.integrationsOk
                            ? "All connected"
                            : "Some integrations are not configured — check the service"}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
                <p className="settings-hint">
                  The backend&apos;s address is a server secret: it is never shown
                  here or sent to any browser — only its state is.
                </p>
              </div>
            )}

            <div className="dev-card">
              <span className="settings-label">Token flow — last 60 minutes (UTC {data.today})</span>
              <div className="dev-chart admin-chart" role="img" aria-label="Tokens per minute for the last hour">
                {data.minutes.map((point) => (
                  <div
                    className="dev-chart-col"
                    key={point.minute}
                    title={`${point.minute.slice(11)} UTC: ${point.totalTokens.toLocaleString("en-US")} tokens, ${point.requests} requests, ${formatUsd(point.costUsd)}`}
                  >
                    <span className="dev-chart-value">
                      {point.totalTokens > 0 ? compactNumber.format(point.totalTokens) : ""}
                    </span>
                    <div className="dev-chart-track">
                      <span style={{ height: `${Math.max(2, (point.totalTokens / maxMinute) * 100)}%` }} />
                    </div>
                    <span className="dev-chart-date">
                      {point.minute.endsWith("0") || point.minute.endsWith("5") ? point.minute.slice(11) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="dev-card">
              <span className="settings-label">Where the tokens went — by model, today</span>
              {data.models.length === 0 && (
                <p className="settings-hint">No metered model calls yet today.</p>
              )}
              {data.models.length > 0 && (
                <div className="dev-defs">
                  {data.models.map((model) => (
                    <div key={model.model}>
                      <span><code>{model.model}</code></span>
                      <strong>
                        {model.totalTokens.toLocaleString("en-US")} tokens · {model.requests} requests ·{" "}
                        {model.promptTokens.toLocaleString("en-US")} in /{" "}
                        {model.completionTokens.toLocaleString("en-US")} out · {formatUsd(model.costUsd)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dev-card">
              <span className="settings-label">Top users by tokens — today</span>
              {data.topUsers.length === 0 && (
                <p className="settings-hint">No user activity yet today.</p>
              )}
              {data.topUsers.length > 0 && (
                <div className="dev-defs">
                  {data.topUsers.map((entry) => (
                    <div key={entry.uid}>
                      <span>{entry.email ?? entry.uid}</span>
                      <strong>
                        {entry.totalTokens.toLocaleString("en-US")} tokens · {entry.requests} requests ·{" "}
                        {formatUsd(entry.costUsd)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dev-card">
              <span className="settings-label">Users — access & control</span>
              <p className="settings-hint">
                Every account, its access state and today&apos;s token use. Admin
                power comes from the <code>admin</code> field on the user&apos;s
                database record — only an admin can change it, and every change
                is written to the audit trail. You can&apos;t demote or disable
                your own account.
              </p>
              {actionError && <div className="auth-alert" role="alert">{actionError}</div>}
              {pendingAction && (
                <div className="settings-inline" role="group" aria-label="Confirm action">
                  <span className="settings-hint">{pendingAction.label}</span>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={actingUid !== null}
                    onClick={() => void runAction()}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={actingUid !== null}
                    onClick={() => setPendingAction(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {users.length === 0 && (
                <p className="settings-hint">No accounts found.</p>
              )}
              {users.length > 0 && (
                <ul className="settings-session-list">
                  {users.map((entry) => {
                    const isSelf = user?.uid === entry.uid;
                    return (
                      <li key={entry.uid}>
                        <span className="settings-session-device">
                          {entry.displayName || entry.email || entry.uid}
                          {entry.admin && <span className="settings-badge">Admin</span>}
                          {isSelf && <span className="settings-badge">You</span>}
                          {entry.disabled && (
                            <span className="settings-badge settings-badge-warn">Disabled</span>
                          )}
                          {!entry.emailVerified && (
                            <span className="settings-badge">Unverified</span>
                          )}
                        </span>
                        <span className="settings-file-meta">
                          {entry.email ?? entry.uid}
                          {" · "}
                          {entry.totalTokensToday.toLocaleString("en-US")} tokens today
                          {" · "}{entry.requestsToday} requests
                          {entry.createdAt
                            ? ` · joined ${new Date(entry.createdAt).toLocaleDateString("en-GB")}`
                            : ""}
                          {entry.lastSignInAt
                            ? ` · last sign-in ${new Date(entry.lastSignInAt).toLocaleDateString("en-GB")}`
                            : ""}
                        </span>
                        <span className="settings-inline">
                          {!entry.admin ? (
                            <button
                              type="button"
                              className="button button-outline"
                              disabled={actingUid !== null}
                              onClick={() =>
                                setPendingAction({
                                  uid: entry.uid,
                                  action: "promote",
                                  label: `Make ${entry.email ?? entry.uid} an admin? They will get full control of the app.`,
                                })
                              }
                            >
                              Make admin
                            </button>
                          ) : (
                            !isSelf && (
                              <button
                                type="button"
                                className="button button-outline"
                                disabled={actingUid !== null}
                                onClick={() =>
                                  setPendingAction({
                                    uid: entry.uid,
                                    action: "demote",
                                    label: `Remove admin power from ${entry.email ?? entry.uid}?`,
                                  })
                                }
                              >
                                Remove admin
                              </button>
                            )
                          )}
                          {!isSelf &&
                            (!entry.disabled ? (
                              <button
                                type="button"
                                className="button button-outline"
                                disabled={actingUid !== null}
                                onClick={() =>
                                  setPendingAction({
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
                                className="button button-outline"
                                disabled={actingUid !== null}
                                onClick={() =>
                                  setPendingAction({
                                    uid: entry.uid,
                                    action: "enable",
                                    label: `Re-enable ${entry.email ?? entry.uid} so they can sign in again?`,
                                  })
                                }
                              >
                                Enable
                              </button>
                            ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {data.recentErrors && data.recentErrors.length > 0 && (
              <div className="dev-card">
                <span className="settings-label">Model failures — latest</span>
                <p className="settings-hint">
                  Requests the model chain rejected, with the upstream status and
                  the provider&apos;s own error text — the first place to look when
                  a user reports &quot;the model couldn&apos;t process this request&quot;.
                </p>
                <ul className="settings-session-list">
                  {data.recentErrors.map((entry, index) => (
                    <li key={`${entry.ts}-${index}`}>
                      <span className="settings-session-device">
                        {entry.model ?? "unknown model"}
                        <span className="settings-badge settings-badge-warn">
                          {entry.status ?? "network"}
                        </span>
                        {entry.webInjected && (
                          <span className="settings-badge">with web results</span>
                        )}
                      </span>
                      <span className="settings-file-meta">
                        {entry.error ?? "No error body returned."}
                        {" · "}{formatTime(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dev-card">
              <span className="settings-label">Web searches — latest activity</span>
              <p className="settings-hint">
                Every chat web search, newest first: the query, what triggered it
                (toggle, auto-detected, or a pasted link), which provider answered,
                and how many results came back. Zero-result rows mean every search
                source failed for that query.
              </p>
              {(!data.recentSearches || data.recentSearches.length === 0) && (
                <p className="settings-hint">No web searches recorded yet.</p>
              )}
              {data.recentSearches && data.recentSearches.length > 0 && (
                <ul className="settings-session-list">
                  {data.recentSearches.map((entry, index) => (
                    <li key={`${entry.ts}-${index}`}>
                      <span className="settings-session-device">
                        {entry.query || "(link)"}
                        <span className="settings-badge">{entry.trigger}</span>
                        {entry.resultCount === 0 && (
                          <span className="settings-badge settings-badge-warn">no results</span>
                        )}
                      </span>
                      <span className="settings-file-meta">
                        {entry.provider ?? "no provider"}
                        {" · "}{entry.resultCount} results
                        {" · "}{formatTime(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="dev-card">
              <span className="settings-label">Token ledger — latest activity</span>
              <p className="settings-hint">
                Every metered call, newest first, with its exact second. This ledger
                is stored separately from chats and accounts, so it survives chat
                deletion.
              </p>
              {data.recentEvents.length === 0 && (
                <p className="settings-hint">No metered calls recorded yet.</p>
              )}
              {data.recentEvents.length > 0 && (
                <ul className="settings-session-list">
                  {data.recentEvents.map((entry) => (
                    <li key={entry.id}>
                      <span className="settings-session-device">
                        {entry.model ?? entry.surface}
                        <span className="settings-badge">{entry.surface}</span>
                        {entry.status !== "success" && (
                          <span className="settings-badge settings-badge-warn">{entry.status}</span>
                        )}
                      </span>
                      <span className="settings-file-meta">
                        {entry.totalTokens.toLocaleString("en-US")} tokens (
                        {entry.promptTokens.toLocaleString("en-US")} in /{" "}
                        {entry.completionTokens.toLocaleString("en-US")} out)
                        {" · "}{formatUsd(entry.costUsd)}
                        {" · "}{entry.email ?? entry.uid}
                        {" · "}{formatTime(entry.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
