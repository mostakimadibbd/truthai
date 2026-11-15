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

type AdminOverview = {
  today: string;
  totals: Totals;
  minutes: MinutePoint[];
  models: ModelTotal[];
  topUsers: TopUser[];
  recentEvents: LedgerEntry[];
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

  useEffect(() => {
    void load();
  }, [load]);

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
            <button type="button" className="button button-outline" onClick={() => void load()}>
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
              isn’t on the admin allowlist, so no platform data is shown.
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
