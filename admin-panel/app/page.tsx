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
  live: { streams: number; generating: number };
  lifetime: Totals;
  lifetimeDays: number;
  ranges: Partial<
    Record<
      "24h" | "48h",
      { totals: Totals; buckets: (Totals & { label: string })[] }
    >
  >;
  // Sections that failed to load on the backend and were
  // degraded to empty (exception class names only). Surfaced
  // in the UI so an empty section never masquerades as real
  // zeros.
  dataIssues?: { section: string; error: string }[];
};

type UserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl?: string | null;
  emailVerified: boolean;
  disabled: boolean;
  admin: boolean;
  role: "owner" | "admin" | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  requestsToday: number;
  totalTokensToday: number;
  costUsdToday: number;
  lifetimeRequests: number;
  lifetimeTokens: number;
};

type UserDetail = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  role: "owner" | "admin" | null;
  providers: string[];
  createdAt: number | null;
  lastSignInAt: number | null;
  developer: boolean;
  week: (Totals & { day: string })[];
  lifetime: Totals;
  chats: {
    count: number;
    recent: { id: string; title: string | null; updatedAt: number | null; pinned: boolean }[];
  };
  devices: {
    id: string;
    label: string | null;
    platform: string | null;
    lastSeenAt: number | null;
    signIns: number | null;
  }[];
  apiKeys: {
    id: string;
    name: string | null;
    revoked: boolean;
    createdAt: number | null;
    lastUsedAt: number | null;
  }[];
  securityEvents: { type: string; ts: number; newDevice: boolean }[];
  apiEvents: { model: string | null; totalTokens: number; status: number | string | null; ts: number }[];
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

type LogEntry = {
  id: string;
  ts: number;
  kind: "request" | "search" | "error" | "admin";
  uid: string;
  email: string | null;
  summary: string;
  code: number | string | null;
};

type StorageInfo = {
  configured: boolean;
  source?: string;
  quotaBytes?: number | null;
  cloudinaryError?: string;
  error?: string;
  plan?: string | null;
  cloudName?: string;
  creditsLimit?: number | null;
  creditsUsed?: number | null;
  creditsUsedPercent?: number | null;
  storageBytes?: number | null;
  bandwidthBytes?: number | null;
  objects?: number | null;
  requests?: number | null;
  transformations?: number | null;
  updatedAt?: string | null;
};

type TrashEntry = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  deletedAt: number;
  deletedByRole: string | null;
  chats: number;
  apiKeys: number;
  devices: number;
  lifetimeTokens: number;
  lifetimeRequests: number;
  lifetimeCostUsd: number;
};

type RangeKey = "today" | "24h" | "48h" | "7d" | "lifetime";

type Tab = "overview" | "users" | "owner" | "logs" | "safety" | "media" | "activity" | "system";

type MediaEntry = {
  publicId: string;
  resourceType: string;
  deliveryType: string;
  format?: string | null;
  bytes?: number | null;
  createdAt?: string | null;
  ownerUid?: string | null;
  ownerEmail?: string | null;
  previewUrl?: string | null;
};

type FlagEntry = {
  id: string;
  uid: string;
  email: string | null;
  chatId: string;
  prompt: string;
  category: string;
  signal: string;
  model: string | null;
  status: string;
  ts: number | null;
  reviewedBy: string | null;
};

type ChatMessageRow = {
  id: string;
  role: string;
  content: string;
  status: string | null;
  provider: string | null;
  createdAt: number | null;
};
type ActionKind = "promote" | "demote" | "disable" | "enable" | "delete" | "sign-out-all" | "verify-email" | "unverify-email";

/** Actions the backend only performs for the owner AND with the
 * owner secret — the panel collects it in the confirm modal. */
const SECRET_GATED_ACTIONS: ActionKind[] = ["promote", "demote", "delete"];
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
  if (message.includes("couldn’t be verified")) {
    return "The two project names in the message must be identical. They come from this panel’s NEXT_PUBLIC_FIREBASE_PROJECT_ID and the backend’s Firebase service-account credentials. Fix the side that names the wrong project, redeploy it, then sign out of the panel and back in.";
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

/** Date + time for ledger/log rows — a bare clock time made
 * yesterday's activity look like it happened in the future. */
function dateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A temporary password that satisfies the platform's own
 * password rules (10+ chars, lower, upper, symbol). */
function generateTempPassword(): string {
  const sets = [
    "abcdefghijkmnopqrstuvwxyz",
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "23456789",
    "!@#$%",
  ];
  const all = sets.join("");
  const pick = (source: string) =>
    source[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * source.length)];
  const chars = sets.map((set) => pick(set));
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function date(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(row: { displayName: string | null; email: string | null; uid: string }): string {
  const source = row.displayName || row.email || row.uid;
  const parts = source.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "X") + (parts[1]?.[0] ?? "")).toUpperCase();
}

type AvatarRow = {
  displayName: string | null;
  email: string | null;
  uid: string;
  photoUrl?: string | null;
};

function Avatar({ row, size }: { row: AvatarRow; size?: "sm" | "lg" }) {
  const [broken, setBroken] = useState(false);
  const url = row.photoUrl && !broken ? row.photoUrl : null;
  return (
    <span className={`avatar ${size ?? ""}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        initials(row)
      )}
    </span>
  );
}

function OwnerSecretTester({ user }: { user: User }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  const test = async () => {
    if (!value.trim()) return;
    setState("testing");
    setMessage("");
    try {
      const response = await panelApi(user, "/api/owner-secret", {
        method: "POST",
        body: { ownerSecret: value },
      });
      if (response.ok) {
        setState("ok");
        setMessage("This secret works — granting, revoking and deleting are unlocked with it.");
        setValue("");
        return;
      }
      setState("error");
      setMessage(await apiErrorMessage(response, "That secret didn’t work."));
    } catch {
      setState("error");
      setMessage("The check couldn’t reach the backend. Try again in a moment.");
    }
  };

  return (
    <section className="card owner-card">
      <div className="card-head">
        <h2>Test your owner secret</h2>
        <span className="role-badge owner">owner</span>
      </div>
      <p className="muted">
        Type the secret exactly as it is set on the backend and test it — nothing
        changes. If it fails, the message tells you whether the backend has no
        secret set yet or the value doesn’t match.
      </p>
      <div className="secret-test-row">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter your owner secret"
          autoComplete="current-password"
          onKeyDown={(event) => {
            if (event.key === "Enter") void test();
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void test()}
          disabled={state === "testing" || !value.trim()}
        >
          {state === "testing" ? "Testing…" : "Test secret"}
        </button>
      </div>
      {state === "ok" && <p className="secret-test-ok" role="status">{message}</p>}
      {state === "error" && <p className="alert" role="alert">{message}</p>}
    </section>
  );
}

function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  const width = 120;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - 3 - (value / max) * (height - 8)).toFixed(1)}`)
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} className="spark-area" />
      <polyline points={points} className="spark-line" />
    </svg>
  );
}

function WeekBars({ week, field }: { week: (Totals & { day: string })[]; field: "totalTokens" | "requests" }) {
  const max = Math.max(1, ...week.map((day) => day[field]));
  return (
    <div className="weekbars">
      {week.map((day) => (
        <div key={day.day} className="weekbar" title={`${day.day}: ${day[field].toLocaleString("en-US")}`}>
          <span className="weekbar-value">{compact.format(day[field])}</span>
          <div className="weekbar-track">
            <div className="weekbar-fill" style={{ height: `${Math.max(3, (day[field] / max) * 100)}%` }} />
          </div>
          <span className="weekbar-day">
            {new Date(`${day.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  overview: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  logs: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  system: "M4 17l6-6-6-6M12 19h8",
  owner: "M12 2l7 3v5c0 5-3.5 9.3-7 11-3.5-1.7-7-6-7-11V5l7-3zM9 12l2 2 4-4",
  flag: "M4 21V4c4-2 8 2 12 0v9c-4 2-8-2-12 0",
  image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z M8.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z M21 15l-5-5L5 21",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};

function bytes(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
    ownerSecretConfigured?: boolean;
  } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [flags, setFlags] = useState<FlagEntry[]>([]);
  const [flagsPending, setFlagsPending] = useState(0);
  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [mediaConfigured, setMediaConfigured] = useState(true);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaConfirmDelete, setMediaConfirmDelete] = useState("");
  const [mediaBusy, setMediaBusy] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [trash, setTrash] = useState<{ entries: TrashEntry[]; totals: { accounts: number; chats: number; lifetimeTokens: number; lifetimeRequests: number } } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [range, setRange] = useState<RangeKey>("today");
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [userSort, setUserSort] = useState<UserSort>("tokens");
  const [logFilter, setLogFilter] = useState<"all" | LogEntry["kind"]>("all");
  const [pending, setPending] = useState<{ uid: string; action: ActionKind; label: string; email?: string | null } | null>(null);
  // Step-up confirmation state for privilege changes: the owner
  // types the target's email (grants) and the owner secret (all
  // gated actions) before anything is sent.
  const [confirmEmail, setConfirmEmail] = useState("");
  const [ownerSecretInput, setOwnerSecretInput] = useState("");
  // Directory-wide search results (server-side, beyond the loaded
  // page of accounts) for the Users tab and the Owner tab.
  const [searchRows, setSearchRows] = useState<UserRow[] | null>(null);
  const [addResults, setAddResults] = useState<UserRow[] | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addPick, setAddPick] = useState<string | null>(null);
  const [usersError, setUsersError] = useState("");
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Create-account modal (any admin; the backend enforces the
  // platform password rules and writes the profile server-side).
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createShowPassword, setCreateShowPassword] = useState(false);
  const [createVerified, setCreateVerified] = useState(true);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  // Tab-level load states so a slow or failed fetch never looks
  // like a permanently stuck tab.
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [flagsError, setFlagsError] = useState("");
  const [mediaLoading, setMediaLoading] = useState(true);
  const [detailError, setDetailError] = useState("");

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

  const loadOverview = useCallback(async () => {
    if (!user) return;
    try {
      const overviewRes = await panelApi(user, "/api/overview");
      if (overviewRes.status === 403) {
        setState("forbidden");
        return;
      }
      if (!overviewRes.ok) {
        throw new Error(await apiErrorMessage(overviewRes, "Console data couldn’t be loaded."));
      }
      setOverview((await overviewRes.json()) as Overview);
      setUpdatedAt(Date.now());
      setState("ready");
    } catch (error) {
      setState((current) => {
        if (current !== "ready") {
          setErrorMessage(error instanceof Error ? error.message : "Console data couldn’t be loaded.");
          return "error";
        }
        return current;
      });
    }
  }, [user]);

  const loadDirectory = useCallback(async () => {
    if (!user) return;
    try {
      const [usersRes, auditRes] = await Promise.all([
        panelApi(user, "/api/users"),
        panelApi(user, "/api/audit"),
      ]);
      if (usersRes.status === 403) {
        setState("forbidden");
        return;
      }
      if (usersRes.ok) {
        const payload = (await usersRes.json()) as {
          users: UserRow[];
          viewer: { uid: string; role: string; registered: boolean; ownerSecretConfigured?: boolean };
        };
        setUsers(payload.users);
        setViewer(payload.viewer);
        setUsersError("");
      } else {
        // Never let a failed directory read masquerade as an
        // empty product: say so, loudly, where the list lives.
        setUsersError(await apiErrorMessage(usersRes, "The user list couldn’t be loaded."));
      }
      if (auditRes.ok) {
        const payload = (await auditRes.json()) as { entries: AuditEntry[] };
        setAudit(payload.entries);
      }
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "The user list couldn’t be loaded.");
    }
  }, [user]);

  const loadCore = useCallback(async () => {
    await Promise.all([loadOverview(), loadDirectory()]);
  }, [loadOverview, loadDirectory]);

  // Directory-wide search: once a query is specific enough, the
  // backend searches EVERY account (the loaded list is only the
  // first page of the directory). Results feed the Users table
  // (searchRows) and the Owner tab's add-admin picker (addResults).
  useEffect(() => {
    const needle = query.trim();
    if (!user || needle.length < 2) {
      setSearchRows(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await panelApi(user, `/api/users?q=${encodeURIComponent(needle)}`);
          if (active && response.ok) {
            const payload = (await response.json()) as { users: UserRow[] };
            setSearchRows(payload.users);
          }
        } catch {
          /* keep the locally loaded rows */
        }
      })();
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [user, query]);

  useEffect(() => {
    const needle = addQuery.trim();
    if (!user || needle.length < 2) {
      setAddResults(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await panelApi(user, `/api/users?q=${encodeURIComponent(needle)}`);
          if (active && response.ok) {
            const payload = (await response.json()) as { users: UserRow[] };
            setAddResults(payload.users);
          }
        } catch {
          /* the picker keeps its empty state */
        }
      })();
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [user, addQuery]);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    try {
      const logsRes = await panelApi(user, "/api/logs");
      if (logsRes.ok) setLogs(((await logsRes.json()) as { entries: LogEntry[] }).entries);
    } catch {
      /* best-effort */
    }
  }, [user]);

  const loadFlags = useCallback(async () => {
    if (!user) return;
    try {
      const res = await panelApi(user, "/api/flags");
      if (res.ok) {
        const data = (await res.json()) as { flags: FlagEntry[]; pendingCount: number };
        setFlags(data.flags);
        setFlagsPending(data.pendingCount);
        setFlagsError("");
      } else {
        setFlagsError(await apiErrorMessage(res, "Safety flags couldn’t be loaded."));
      }
    } catch {
      setFlagsError("Safety flags couldn’t be loaded.");
    } finally {
      setFlagsLoading(false);
    }
  }, [user]);

  const loadMedia = useCallback(async () => {
    if (!user) return;
    setMediaLoading(true);
    try {
      const res = await panelApi(user, "/api/media");
      if (res.ok) {
        const data = (await res.json()) as {
          configured: boolean;
          resources: MediaEntry[];
          error?: string;
        };
        setMediaConfigured(data.configured);
        setMedia(data.resources ?? []);
        setMediaError(data.error ?? "");
      } else {
        setMediaError(await apiErrorMessage(res, "Media couldn’t be loaded."));
      }
    } catch {
      setMediaError("Media couldn’t be loaded.");
    } finally {
      setMediaLoading(false);
    }
  }, [user]);

  const deleteMedia = async (entry: MediaEntry) => {
    if (!user) return;
    setMediaBusy(entry.publicId);
    try {
      const res = await panelApi(user, "/api/media", {
        method: "POST",
        body: {
          publicId: entry.publicId,
          resourceType: entry.resourceType,
          deliveryType: entry.deliveryType,
        },
      });
      if (res.ok) {
        setMedia((current) => current.filter((item) => item.publicId !== entry.publicId));
        setMediaConfirmDelete("");
      }
    } finally {
      setMediaBusy("");
    }
  };

  const downloadMedia = async (entry: MediaEntry) => {
    if (!user) return;
    const params = new URLSearchParams({
      publicId: entry.publicId,
      resourceType: entry.resourceType,
      type: entry.deliveryType,
    });
    if (entry.format) params.set("format", entry.format);
    const res = await panelApi(user, `/api/media/download?${params.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.publicId.split("/").pop() ?? "download";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const uploadMedia = async (file: File) => {
    if (!user) return;
    setMediaBusy("upload");
    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("resourceType", file.type.startsWith("image/") ? "image" : "raw");
      const res = await fetch("/api/media/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { resource?: MediaEntry };
        if (data.resource) {
          setMedia((current) => [data.resource as MediaEntry, ...current]);
        }
      }
    } finally {
      setMediaBusy("");
    }
  };

  const reviewFlag = useCallback(
    async (flagId: string, status: "dismissed" | "actioned") => {
      if (!user) return;
      setReviewingId(flagId);
      try {
        const res = await panelApi(user, "/api/flags", {
          method: "POST",
          body: { flagId, status },
        });
        if (res.ok) {
          setFlags((current) =>
            current.map((flag) => (flag.id === flagId ? { ...flag, status } : flag)),
          );
          setFlagsPending((count) => Math.max(0, count - 1));
        }
      } catch {
        /* best-effort */
      } finally {
        setReviewingId("");
      }
    },
    [user],
  );

  const loadChatMessages = useCallback(
    async (uid: string, chatId: string) => {
      if (!user) return;
      if (openChatId === chatId) {
        setOpenChatId(null);
        return;
      }
      setOpenChatId(chatId);
      setChatLoading(true);
      setChatMessages([]);
      try {
        const res = await panelApi(
          user,
          `/api/user-chats?uid=${encodeURIComponent(uid)}&chatId=${encodeURIComponent(chatId)}`,
        );
        if (res.ok) {
          setChatMessages(((await res.json()) as { messages: ChatMessageRow[] }).messages);
        }
      } catch {
        /* best-effort */
      } finally {
        setChatLoading(false);
      }
    },
    [user, openChatId],
  );

  const loadStorageTrash = useCallback(async () => {
    if (!user) return;
    try {
      const [storageRes, trashRes] = await Promise.all([
        panelApi(user, "/api/storage"),
        panelApi(user, "/api/trash"),
      ]);
      if (storageRes.ok) setStorage((await storageRes.json()) as StorageInfo);
      if (trashRes.ok) setTrash(await trashRes.json());
    } catch {
      /* best-effort */
    }
  }, [user]);

  const loadExtras = useCallback(async () => {
    await Promise.all([loadLogs(), loadStorageTrash()]);
  }, [loadLogs, loadStorageTrash]);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (state === "ready") void loadExtras();
  }, [state, loadExtras]);

  // Realtime feel without hammering the backend: the overview
  // refreshes every 30s, the (heavier) user directory every
  // 90s, logs stream only while the Logs tab is open, and
  // storage/trash load on demand. The backend also caches
  // these reads briefly — Firestore's free daily read quota
  // is finite, and polling is what used to burn it. Plus a 1s
  // ticker for the "updated Xs ago" label.
  useEffect(() => {
    if (state !== "ready") return;
    const fast = window.setInterval(() => {
      if (document.hidden) return;
      void loadOverview();
      if (tab === "logs") void loadLogs();
    }, 30_000);
    const slow = window.setInterval(() => {
      if (document.hidden) return;
      void loadDirectory();
    }, 90_000);
    const ticker = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      window.clearInterval(fast);
      window.clearInterval(slow);
      window.clearInterval(ticker);
    };
  }, [state, tab, loadOverview, loadDirectory, loadLogs]);

  // Storage and trash are slow-changing: fetch them when their
  // tabs are opened rather than on the polling loop.
  useEffect(() => {
    if (state !== "ready") return;
    if (tab === "system" || tab === "users") void loadStorageTrash();
    if (tab === "logs") void loadLogs();
    if (tab === "safety") void loadFlags();
    if (tab === "media") void loadMedia();
  }, [tab, state, loadStorageTrash, loadLogs, loadFlags, loadMedia]);

  const openDetail = useCallback(
    async (uid: string) => {
      if (!user) return;
      setDetailUid(uid);
      setDetail(null);
      setOpenChatId(null);
      setChatMessages([]);
      setResetLink(null);
      setDetailError("");
      setDetailLoading(true);
      try {
        const response = await panelApi(user, `/api/user?uid=${encodeURIComponent(uid)}`);
        if (response.ok) {
          setDetail((await response.json()) as UserDetail);
        } else {
          setDetailError(await apiErrorMessage(response, "This account’s details couldn’t be loaded."));
        }
      } catch {
        setDetailError("This account’s details couldn’t be loaded.");
      } finally {
        setDetailLoading(false);
      }
    },
    [user],
  );

  // Fresh confirmation fields for every new pending action —
  // keyed on the action's identity, not the object, so a
  // re-render can never wipe fields the owner is typing into.
  useEffect(() => {
    setConfirmEmail("");
    setOwnerSecretInput("");
    setActionError("");
  }, [pending?.uid, pending?.action]);

  const runAction = useCallback(async () => {
    if (!user || !pending) return;
    setActing(true);
    setActionError("");
    try {
      const response = await panelApi(user, "/api/users", {
        method: "PATCH",
        body: {
          uid: pending.uid,
          action: pending.action,
          ...(SECRET_GATED_ACTIONS.includes(pending.action)
            ? { ownerSecret: ownerSecretInput }
            : {}),
        },
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
                : done.action === "sign-out-all"
                  ? "Signed out on all devices."
                  : done.action === "verify-email"
                    ? "Email marked as verified."
                    : done.action === "unverify-email"
                      ? "Email marked as unverified."
                      : "Account deleted — a snapshot was saved to the trash archive.",
      );
      window.setTimeout(() => setToast(""), 4500);
      await loadCore();
      if (detailUid) void openDetail(detailUid);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That action couldn’t be completed.");
    } finally {
      setActing(false);
    }
  }, [user, pending, loadCore, detailUid, openDetail, ownerSecretInput]);

  const runResetLink = useCallback(
    async (uid: string) => {
      if (!user) return;
      setActing(true);
      setActionError("");
      try {
        const response = await panelApi(user, "/api/users", {
          method: "PATCH",
          body: { uid, action: "reset-link" },
        });
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, "The reset link couldn’t be created."));
        }
        const payload = (await response.json()) as { link?: string };
        if (payload.link) setResetLink(payload.link);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The reset link couldn’t be created.");
      } finally {
        setActing(false);
      }
    },
    [user],
  );

  const runCreateAccount = useCallback(async () => {
    if (!user) return;
    setCreating(true);
    setCreateError("");
    try {
      const response = await panelApi(user, "/api/users", {
        method: "POST",
        body: {
          email: createEmail.trim(),
          password: createPassword,
          displayName: createName.trim() || undefined,
          emailVerified: createVerified,
        },
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The account couldn’t be created."));
      }
      const payload = (await response.json()) as { uid: string; email: string };
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setToast(`Account created for ${payload.email} — they can sign in now.`);
      window.setTimeout(() => setToast(""), 4500);
      await loadDirectory();
      if (payload.uid) void openDetail(payload.uid);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The account couldn’t be created.");
    } finally {
      setCreating(false);
    }
  }, [user, createEmail, createPassword, createName, createVerified, loadDirectory, openDetail]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = (searchRows ?? users).filter((row) => {
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
        return (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid);
      }
      return b.totalTokensToday - a.totalTokensToday;
    });
    return rows;
  }, [users, searchRows, query, userFilter, userSort]);

  const rangeTotals: Totals | null = useMemo(() => {
    if (!overview) return null;
    if (range === "today") return overview.totals;
    if (range === "24h" || range === "48h") return overview.ranges[range]?.totals ?? overview.totals;
    if (range === "7d") {
      const sum = { ...overview.totals, requests: 0, chatRequests: 0, apiRequests: 0, imageRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
      for (const day of overview.week) {
        (Object.keys(sum) as (keyof Totals)[]).forEach((key) => {
          sum[key] += day[key];
        });
      }
      return sum;
    }
    return overview.lifetime;
  }, [overview, range]);

  const forecast = useMemo(() => {
    if (!overview) return null;
    const now = new Date();
    const elapsed = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
    const projectedToday =
      elapsed > 0.02 ? Math.round(overview.totals.totalTokens / elapsed) : overview.totals.totalTokens;
    const pastDays = overview.week.slice(0, -1);
    const avgDay = pastDays.length
      ? Math.round(pastDays.reduce((acc, day) => acc + day.totalTokens, 0) / pastDays.length)
      : overview.totals.totalTokens;
    return { projectedToday, tomorrow: avgDay, next7d: avgDay * 7 };
  }, [overview]);

  const opsEstimate = useMemo(() => {
    if (!overview) return null;
    const t = overview.totals;
    const writes = t.chatRequests * 4 + t.apiRequests * 3 + t.imageRequests * 2 + t.requests * 2;
    const reads = t.requests * 8 + users.length * 3 + 40;
    return { writes, reads };
  }, [overview, users.length]);

  function exportUsersCsv() {
    const rows = [
      ["email", "name", "role", "verified", "disabled", "joined", "requests_today", "tokens_today", "lifetime_requests", "lifetime_tokens"],
      ...filteredUsers.map((row) => [
        row.email, row.displayName, row.role ?? "", row.emailVerified, row.disabled,
        row.createdAt ? new Date(row.createdAt).toISOString() : "",
        row.requestsToday, row.totalTokensToday, row.lifetimeRequests, row.lifetimeTokens,
      ]),
    ];
    download("xyro-users.csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
    setExportOpen(false);
  }

  function exportLogsCsv() {
    const rows = [
      ["time", "kind", "email", "summary", "code"],
      ...logs.map((row) => [new Date(row.ts).toISOString(), row.kind, row.email, row.summary, row.code]),
    ];
    download("xyro-logs.csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
    setExportOpen(false);
  }

  function exportJson() {
    download(
      "xyro-report.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), overview, users, logs, trash }, null, 2),
      "application/json",
    );
    setExportOpen(false);
  }

  async function onSignOut() {
    const auth = panelAuth();
    if (auth) await signOut(auth);
    router.replace("/sign-in");
  }

  const totals = overview?.totals;
  const promptShare =
    totals && totals.totalTokens > 0 ? Math.round((totals.promptTokens / totals.totalTokens) * 100) : 0;
  const secondsAgo = updatedAt ? Math.max(0, Math.round((nowTick - updatedAt) / 1000)) : null;
  const detailRow = detailUid ? users.find((row) => row.uid === detailUid) : undefined;

  if (state === "loading") {
    return (
      <div className="shell">
        <aside className="sidebar"><div className="brand"><span className="brand-mark">X</span><strong>Xyro Control</strong></div></aside>
        <main className="main"><div className="skel-grid"><div className="skel" /><div className="skel" /><div className="skel" /><div className="skel" /></div></main>
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="center-wrap">
        <div className="center-card">
          <span className="brand-mark big">X</span>
          <h1>Administrators only</h1>
          <p className="muted">
            This console is restricted. If you’re the owner, your access is recorded in the
            admins registry — signing in with the owner account grants it automatically.
          </p>
          <button type="button" className="btn" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    const hint = hintFor(errorMessage);
    return (
      <div className="center-wrap">
        <div className="center-card">
          <span className="brand-mark big">X</span>
          <h1>Something needs attention</h1>
          <div className="alert" role="alert">{errorMessage}</div>
          {hint && <p className="hint">{hint}</p>}
          <button type="button" className="btn btn-primary" onClick={() => void loadCore()}>Retry</button>
        </div>
      </div>
    );
  }

  const navItems: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: ICONS.overview },
    { id: "users", label: "Users & access", icon: ICONS.users },
    { id: "logs", label: "Logs", icon: ICONS.logs },
    { id: "safety", label: "Safety flags", icon: ICONS.flag },
    { id: "media", label: "Media", icon: ICONS.image },
    { id: "activity", label: "Activity", icon: ICONS.activity },
    { id: "system", label: "System", icon: ICONS.system },
  ];
  // The Owner tab exists only for the owner — admins never see it.
  if (viewer?.role === "owner") {
    navItems.splice(2, 0, { id: "owner", label: "Owner", icon: ICONS.owner });
  }
  const pendingGated = pending ? SECRET_GATED_ACTIONS.includes(pending.action) : false;
  const pendingEmailOk =
    pending?.action !== "promote" ||
    (pending?.email != null &&
      confirmEmail.replace(/\s+/g, "").toLowerCase() ===
        pending.email.replace(/\s+/g, "").toLowerCase());
  const pendingSecretOk = !pendingGated || ownerSecretInput.trim().length >= 4;
  const canConfirm = pendingEmailOk && pendingSecretOk && !acting;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">X</span>
          <div>
            <strong>Xyro Control</strong>
            <span className="brand-sub">Admin console</span>
          </div>
          <span className="live-pill"><span className="live-dot" />Live</span>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(item.id)}
            >
              <Icon path={item.icon} />
              {item.label}
              {item.id === "logs" && logs.some((row) => row.kind === "error") && <span className="nav-badge">!</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="viewer-card">
            <Avatar row={{ displayName: user?.displayName ?? null, email: user?.email ?? null, uid: viewer?.uid ?? "?", photoUrl: user?.photoURL ?? null }} />
            <div className="viewer-meta">
              <span className="viewer-email">{user?.email ?? ""}</span>
              <span className={`role-badge ${viewer?.role ?? ""}`}>{viewer?.role ?? "admin"}</span>
            </div>
          </div>
          <button type="button" className="nav-item" onClick={onSignOut}>
            <Icon path={ICONS.out} /> Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.id === tab)?.label}</h1>
            <p className="muted small">
              {secondsAgo === null ? "Connecting…" : secondsAgo < 2 ? "Updated just now" : `Updated ${secondsAgo}s ago`} · auto-refresh on
            </p>
          </div>
          <div className="top-actions">
            <div className="export-wrap">
              <button type="button" className="btn" onClick={() => setExportOpen((open) => !open)}>
                Export ▾
              </button>
              {exportOpen && (
                <div className="export-menu">
                  <button type="button" onClick={exportUsersCsv}>Users (CSV)</button>
                  <button type="button" onClick={exportLogsCsv}>Logs (CSV)</button>
                  <button type="button" onClick={exportJson}>Full report (JSON)</button>
                  <button type="button" onClick={() => { setExportOpen(false); window.print(); }}>Report (PDF — print)</button>
                </div>
              )}
            </div>
            <button type="button" className="btn" onClick={() => { void loadCore(); void loadExtras(); }}>
              <Icon path={ICONS.refresh} /> Refresh
            </button>
          </div>
        </header>

        {tab === "overview" && overview?.dataIssues && overview.dataIssues.length > 0 && (
          <div className="alert" role="alert">
            {overview.dataIssues.some((issue) => issue.error === "ResourceExhausted")
              ? "Live data is limited right now — the database's daily free read quota is used up (it resets at midnight Pacific — 14:00 Dhaka time in winter). Figures below may be incomplete until then."
              : `Some sections couldn't load (${overview.dataIssues.map((issue) => issue.section).join(", ")}) — showing everything that did.`}
          </div>
        )}
        {tab === "overview" && usersError && (
          <div className="alert" role="alert">{usersError}</div>
        )}

        {tab === "overview" && overview && rangeTotals && (
          <>
            <div className="range-row">
              {(["today", "24h", "48h", "7d", "lifetime"] as RangeKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={range === key ? "chip active" : "chip"}
                  onClick={() => setRange(key)}
                >
                  {key === "today" ? "Today" : key === "lifetime" ? "Lifetime" : `Last ${key}`}
                </button>
              ))}
              {range === "lifetime" && (
                <span className="muted small">All time · {overview.lifetimeDays} days of data</span>
              )}
            </div>

            <section className="kpis">
              <div className="kpi">
                <span className="kpi-label">Tokens</span>
                <strong>{compact.format(rangeTotals.totalTokens)}</strong>
                {range === "today" && delta(overview.totals.totalTokens, overview.yesterday.totalTokens) && (
                  <span className="kpi-delta">{delta(overview.totals.totalTokens, overview.yesterday.totalTokens)}</span>
                )}
                <Sparkline values={overview.week.map((day) => day.totalTokens)} />
              </div>
              <div className="kpi">
                <span className="kpi-label">Requests</span>
                <strong>{compact.format(rangeTotals.requests)}</strong>
                {range === "today" && delta(overview.totals.requests, overview.yesterday.requests) && (
                  <span className="kpi-delta">{delta(overview.totals.requests, overview.yesterday.requests)}</span>
                )}
                <Sparkline values={overview.week.map((day) => day.requests)} />
              </div>
              <div className="kpi">
                <span className="kpi-label">Est. value</span>
                <strong>{usd(rangeTotals.costUsd)}</strong>
                <span className="kpi-sub">at OpenRouter list prices — you pay $0 (free models)</span>
                <Sparkline values={overview.week.map((day) => day.costUsd)} />
              </div>
              <div className="kpi">
                <span className="kpi-label">People</span>
                <strong>{users.length}</strong>
                <span className="kpi-sub">
                  {users.filter((row) => row.admin).length} admins · {users.filter((row) => !row.emailVerified).length} unverified
                </span>
                <span className="kpi-sub">
                  {users.filter((row) => row.totalTokensToday > 0).length} active today
                </span>
              </div>
            </section>

            <section className="live-strip">
              <div className="live-cell">
                <span className="live-dot big" />
                <div>
                  <strong>{overview.live.generating} generating now</strong>
                  <span className="muted small">{overview.live.streams} live streams in the realtime database</span>
                </div>
              </div>
              <div className="live-cell">
                <div>
                  <strong>{promptShare}% prompt share</strong>
                  <span className="muted small">of today’s tokens are input; the rest is output</span>
                </div>
                <div className="sharebar"><div style={{ width: `${promptShare}%` }} /></div>
              </div>
              {forecast && (
                <div className="live-cell">
                  <div>
                    <strong>Forecast</strong>
                    <span className="muted small">
                      Today projects to {compact.format(forecast.projectedToday)} tokens · tomorrow ≈{" "}
                      {compact.format(forecast.tomorrow)} · next 7 days ≈ {compact.format(forecast.next7d)}
                    </span>
                  </div>
                </div>
              )}
            </section>

            <div className="grid-2">
              <section className="card">
                <div className="card-head">
                  <h2>{range === "24h" ? "Last 24 hours" : range === "48h" ? "Last 48 hours" : "Last 7 days"}</h2>
                  <span className="muted small">tokens per {range === "24h" ? "hour" : range === "48h" ? "2 hours" : "day"}</span>
                </div>
                {range === "24h" || range === "48h" ? (
                  <BucketBars buckets={overview.ranges[range]?.buckets ?? []} />
                ) : (
                  <WeekBars week={overview.week} field="totalTokens" />
                )}
              </section>

              <section className="card">
                <div className="card-head"><h2>Models today</h2><span className="muted small">free tier</span></div>
                {overview.models.length === 0 && <p className="muted">No model traffic yet today.</p>}
                <div className="model-list">
                  {overview.models.slice(0, 6).map((model) => {
                    const share = overview.totals.totalTokens > 0 ? Math.round((model.totalTokens / overview.totals.totalTokens) * 100) : 0;
                    return (
                      <div key={model.model} className="model-row">
                        <div className="model-top">
                          <span>{model.model.replace(":free", "")}</span>
                          <strong>{compact.format(model.totalTokens)} · {share}%</strong>
                        </div>
                        <div className="sharebar"><div style={{ width: `${share}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="grid-2">
              <section className="card">
                <div className="card-head"><h2>Top users today</h2><span className="muted small">by tokens</span></div>
                {overview.topUsers.length === 0 && <p className="muted">No usage yet today.</p>}
                <div className="rank-list">
                  {overview.topUsers.slice(0, 5).map((row, index) => (
                    <button key={row.uid} type="button" className="rank-row" onClick={() => void openDetail(row.uid)}>
                      <span className="rank-n">{index + 1}</span>
                      <span className="rank-email">{row.email ?? row.uid}</span>
                      <strong>{compact.format(row.totalTokens)}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card-head"><h2>Newest members</h2><span className="muted small">{users.length} total</span></div>
                <div className="rank-list">
                  {[...users]
                    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
                    .slice(0, 5)
                    .map((row) => (
                      <button key={row.uid} type="button" className="rank-row" onClick={() => void openDetail(row.uid)}>
                        <Avatar row={row} size="sm" />
                        <span className="rank-email">{row.email ?? row.uid}</span>
                        <span className="muted small">{date(row.createdAt)}</span>
                      </button>
                    ))}
                </div>
              </section>
            </div>

            <section className="card">
              <div className="card-head"><h2>Recent requests</h2><span className="muted small">the platform’s token ledger, live</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Time</th><th>User</th><th>Surface</th><th>Model</th><th>Tokens</th><th>Status</th></tr></thead>
                  <tbody>
                    {overview.recentEvents.slice(0, 10).map((event) => (
                      <tr key={event.id}>
                        <td>{dateTime(event.ts)}</td>
                        <td>{event.email ?? event.uid.slice(0, 8)}</td>
                        <td>{event.surface}</td>
                        <td>{event.model ?? "—"}</td>
                        <td>{event.totalTokens.toLocaleString("en-US")}</td>
                        <td><span className={`pill ${event.status === "ok" ? "ok" : "warn"}`}>{event.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "owner" && viewer?.role === "owner" && (
          <>
            {viewer.ownerSecretConfigured === false && (
              <section className="card owner-warn">
                <div className="card-head">
                  <h2>Owner secret not set</h2>
                  <span className="role-badge owner">action needed</span>
                </div>
                <p className="muted">
                  Granting or revoking admin access and deleting accounts stay locked until
                  the owner secret exists on the backend. Add <strong>OWNER_SECRET</strong> to
                  the <strong>xyro-backend</strong> project in Vercel, redeploy the backend,
                  then reload this panel. This fail-closed lock is deliberate — a signed-in
                  session alone must never be enough to grant admin.
                </p>
              </section>
            )}

            {user && <OwnerSecretTester user={user} />}

            <section className="card owner-card">
              <div className="card-head">
                <h2>Add an admin</h2>
                <span className="role-badge owner">owner power</span>
              </div>
              <p className="muted">
                Search the whole directory by email, name or uid — not just the first page
                of accounts. Pick an account to open its full details (sign-in providers,
                usage, chats, devices), then grant access from there. The final step asks
                you to type the account’s email and enter your owner secret.
              </p>
              <input
                className="search wide"
                type="search"
                placeholder="Search by email, name or uid…"
                value={addQuery}
                onChange={(event) => {
                  setAddQuery(event.target.value);
                  setAddPick(null);
                }}
                aria-label="Search an account to make admin"
              />
              {addQuery.trim().length >= 2 && (
                <div className="pick-list">
                  {(addResults ?? [])
                    .filter((row) => !row.admin)
                    .slice(0, 8)
                    .map((row) => (
                      <button
                        key={row.uid}
                        type="button"
                        className={addPick === row.uid ? "pick active" : "pick"}
                        onClick={() => {
                          setAddPick(row.uid);
                          void openDetail(row.uid);
                        }}
                      >
                        <Avatar row={row} size="sm" />
                        <span>{row.displayName || row.email || row.uid}</span>
                        <span className="muted small">{row.email ?? row.uid}</span>
                      </button>
                    ))}
                  {(addResults ?? []).filter((row) => !row.admin).length === 0 && (
                    <p className="muted small">No matching account without admin access.</p>
                  )}
                </div>
              )}
              {addPick && (
                <p className="muted small">
                  The account’s full details are open in the drawer — review them, then use
                  “Make admin” there to start the confirmed grant.
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Current admins</h2>
                <span className="muted small">{users.filter((row) => row.admin).length} with access</span>
              </div>
              {users
                .filter((row) => row.admin)
                .map((row) => (
                  <div key={row.uid} className="admin-row">
                    <Avatar row={row} size="sm" />
                    <span className="admin-row-main">
                      <strong>{row.displayName || row.email || row.uid}</strong>
                      <span className="muted small">{row.email ?? row.uid}</span>
                    </span>
                    <span className={`role-badge ${row.role ?? "admin"}`}>{row.role ?? "admin"}</span>
                    {row.role !== "owner" && row.uid !== viewer.uid && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          setPending({
                            uid: row.uid,
                            action: "demote",
                            email: row.email,
                            label: `Remove admin access from ${row.email ?? row.uid}? It takes effect on their next request.`,
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              {users.filter((row) => row.admin).length === 0 && (
                <p className="muted small">No admin accounts found in the loaded directory.</p>
              )}
            </section>
          </>
        )}

        {tab === "users" && (
          <>
            {viewer?.role === "owner" && (
              <section className="card owner-card">
                <div className="card-head">
                  <h2>Admin access</h2>
                  <span className="role-badge owner">owner power</span>
                </div>
                <p className="muted">
                  Granting and revoking admin access now lives in the Owner tab — with
                  directory-wide search, full account details, and an owner-secret
                  confirmation before anything changes.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setTab("owner")}>
                  Open the Owner panel
                </button>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>All accounts</h2>
                <span className="muted small">{searchRows ? `${filteredUsers.length} matches across all accounts` : `${filteredUsers.length} of ${users.length}`} · click a row for full control</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setCreateError("");
                    setCreatePassword(generateTempPassword());
                    setCreateOpen(true);
                  }}
                >
                  Create account
                </button>
              </div>
              {usersError && (
                <div className="alert" role="alert">
                  {usersError}{" "}
                  <button type="button" className="btn btn-ghost" onClick={() => void loadDirectory()}>
                    Retry
                  </button>
                </div>
              )}
              <div className="toolbar">
                <input
                  className="search"
                  type="search"
                  placeholder="Search email, name or uid…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search users"
                />
                <div className="chips">
                  {(["all", "admins", "disabled", "unverified"] as UserFilter[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={userFilter === key ? "chip active" : "chip"}
                      onClick={() => setUserFilter(key)}
                    >
                      {key === "all" ? "All" : key === "admins" ? "Admins" : key === "disabled" ? "Disabled" : "Unverified"}
                    </button>
                  ))}
                </div>
                <select
                  className="select"
                  value={userSort}
                  onChange={(event) => setUserSort(event.target.value as UserSort)}
                  aria-label="Sort users"
                >
                  <option value="tokens">Top usage today</option>
                  <option value="joined">Newest first</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>User</th><th>Role</th><th>Status</th><th>Today</th><th>Lifetime</th><th>Last active</th><th>Joined</th><th /></tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((row) => (
                      <tr key={row.uid} className="clickable" onClick={() => void openDetail(row.uid)}>
                        <td>
                          <span className="user-cell">
                            <Avatar row={row} size="sm" />
                            <span>
                              <span className="user-name">{row.displayName || row.email || row.uid}</span>
                              <span className="user-email">{row.email ?? row.uid}</span>
                            </span>
                          </span>
                        </td>
                        <td>{row.role ? <span className={`role-badge ${row.role}`}>{row.role}</span> : <span className="muted">user</span>}</td>
                        <td>
                          {row.disabled ? (
                            <span className="pill bad">disabled</span>
                          ) : row.emailVerified ? (
                            <span className="pill ok">verified</span>
                          ) : (
                            <>
                              <span className="pill warn">unverified</span>{" "}
                              <button
                                type="button"
                                className="btn btn-ghost btn-mini"
                                disabled={acting}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPending({ uid: row.uid, action: "verify-email", label: `Mark ${row.email ?? row.uid} as verified? They’ll be able to use every feature that requires a verified email, without needing the verification email.` });
                                }}
                              >
                                Verify
                              </button>
                            </>
                          )}
                        </td>
                        <td>{compact.format(row.totalTokensToday)} tok · {row.requestsToday} req</td>
                        <td>{compact.format(row.lifetimeTokens)} tok · {row.lifetimeRequests} req</td>
                        <td>{date(row.lastSignInAt)}</td>
                        <td>{date(row.createdAt)}</td>
                        <td className="chev">›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <p className="muted pad">
                    {users.length === 0
                      ? "No accounts in the directory yet — new sign-ups will appear here automatically."
                      : "No accounts match this search or filter."}
                  </p>
                )}
              </div>
            </section>

            {trash && trash.entries.length > 0 && (
              <section className="card">
                <div className="card-head">
                  <h2>Trash archive</h2>
                  <span className="muted small">
                    {trash.totals.accounts} deleted · {trash.totals.chats} chats ·{" "}
                    {compact.format(trash.totals.lifetimeTokens)} lifetime tokens removed
                  </span>
                </div>
                <p className="muted small">
                  Deleted accounts are archived here with their data measurements for future
                  product decisions. Message contents are purged with the account.
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Account</th><th>Deleted</th><th>Chats</th><th>API keys</th><th>Devices</th><th>Lifetime tokens</th></tr></thead>
                    <tbody>
                      {trash.entries.map((entry) => (
                        <tr key={entry.uid}>
                          <td>{entry.email ?? entry.uid}</td>
                          <td>{date(entry.deletedAt)}</td>
                          <td>{entry.chats}</td>
                          <td>{entry.apiKeys}</td>
                          <td>{entry.devices}</td>
                          <td>{compact.format(entry.lifetimeTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        {tab === "safety" && (
          <section className="card">
            <div className="card-head">
              <h2>Safety flags</h2>
              <span className="live-pill">{flagsPending} awaiting review</span>
            </div>
            <p className="muted small">
              Accounts are flagged silently when a message matches a harmful-request
              pattern or the model refuses on safety grounds. The user is never told
              and keeps using Xyro normally — review the prompt, open the account or
              the chat, then dismiss the flag or mark it actioned and use the user
              controls (disable / delete) if the behaviour warrants it.
            </p>
            {flagsLoading && <p className="muted small">Loading safety flags…</p>}
            {flagsError && (
              <div className="alert" role="alert">
                {flagsError}{" "}
                <button type="button" className="btn btn-ghost" onClick={() => void loadFlags()}>
                  Retry
                </button>
              </div>
            )}
            {!flagsLoading && !flagsError && flags.length === 0 && <p className="muted small">No flags yet.</p>}
            <div className="flag-list">
              {flags.map((flag) => (
                <div key={flag.id} className="flag-row">
                  <div className="flag-main">
                    <span className={`flag-chip ${flag.category}`}>{flag.category}</span>
                    <span className="flag-chip signal">{flag.signal === "model_refusal" ? "model refused" : "prompt pattern"}</span>
                    <span className={`flag-chip status-${flag.status}`}>{flag.status}</span>
                    <span className="muted small">{flag.ts ? time(flag.ts) : ""}</span>
                  </div>
                  <p className="flag-prompt">“{flag.prompt}”</p>
                  <div className="flag-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => flag.uid && void openDetail(flag.uid)}
                    >
                      {flag.email ?? flag.uid}
                    </button>
                    {flag.status === "pending" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={reviewingId === flag.id}
                          onClick={() => void reviewFlag(flag.id, "dismissed")}
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={reviewingId === flag.id}
                          onClick={() => void reviewFlag(flag.id, "actioned")}
                        >
                          Mark actioned
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "media" && (
          <section className="card">
            <div className="card-head">
              <h2>Media library</h2>
              <div className="flag-actions">
                <label className="btn btn-primary media-upload-btn">
                  {mediaBusy === "upload" ? "Uploading…" : "Upload file"}
                  <input
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadMedia(file);
                    }}
                  />
                </label>
                <button type="button" className="btn btn-ghost" onClick={() => void loadMedia()}>
                  Refresh
                </button>
              </div>
            </div>
            <p className="muted small">
              Every file in Cloudinary — generated images, avatars and user uploads.
              Downloads and deletions are written to the audit log. Deleting a file
              here removes the Cloudinary asset; the user’s chat keeps a reference
              that will simply stop loading.
            </p>
            {!mediaConfigured && (
              <p className="muted">
                Media lights up when the backend can see your Cloudinary account —
                add <code>CLOUDINARY_URL</code> (or the cloud name / key / secret
                variables) to the <strong>backend</strong> project and redeploy it.
              </p>
            )}
            {mediaError && <div className="alert" role="alert">{mediaError}</div>}
            <input
              className="input media-search"
              type="search"
              placeholder="Search by file name or owner email…"
              value={mediaSearch}
              onChange={(event) => setMediaSearch(event.target.value)}
            />
            {mediaLoading && <p className="muted small">Loading media…</p>}
            {mediaConfigured && media.length === 0 && !mediaError && !mediaLoading && (
              <p className="muted small">No media files yet.</p>
            )}
            <div className="media-grid">
              {media
                .filter((entry) => {
                  const query = mediaSearch.trim().toLowerCase();
                  if (!query) return true;
                  return (
                    entry.publicId.toLowerCase().includes(query) ||
                    (entry.ownerEmail ?? "").toLowerCase().includes(query)
                  );
                })
                .map((entry) => (
                  <div key={`${entry.resourceType}/${entry.deliveryType}/${entry.publicId}`} className="media-card">
                    {entry.previewUrl && entry.resourceType === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="media-thumb" src={entry.previewUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="media-thumb media-tile">
                        <span>{(entry.format ?? entry.resourceType).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="media-meta">
                      <strong title={entry.publicId}>{entry.publicId.split("/").pop()}</strong>
                      <span className="muted small">
                        {entry.resourceType} · {entry.deliveryType} · {bytes(entry.bytes)}
                      </span>
                      <span className="muted small">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-GB") : ""}
                      </span>
                      {entry.ownerUid ? (
                        <button
                          type="button"
                          className="media-owner"
                          onClick={() => void openDetail(entry.ownerUid as string)}
                        >
                          {entry.ownerEmail ?? entry.ownerUid}
                        </button>
                      ) : (
                        <span className="muted small">admin upload</span>
                      )}
                    </div>
                    <div className="flag-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => void downloadMedia(entry)}>
                        Download
                      </button>
                      {mediaConfirmDelete === entry.publicId ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={mediaBusy === entry.publicId}
                            onClick={() => void deleteMedia(entry)}
                          >
                            Confirm delete
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => setMediaConfirmDelete("")}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost" onClick={() => setMediaConfirmDelete(entry.publicId)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}

        {tab === "logs" && (
          <section className="card">
            <div className="card-head">
              <h2>Realtime logs</h2>
              <span className="live-pill"><span className="live-dot" />streaming · refreshes every 15s</span>
            </div>
            <div className="chips">
              {(["all", "request", "search", "error", "admin"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={logFilter === key ? "chip active" : "chip"}
                  onClick={() => setLogFilter(key)}
                >
                  {key === "all" ? "All" : key === "request" ? "Requests" : key === "search" ? "Searches" : key === "error" ? "Errors" : "Admin"}
                </button>
              ))}
            </div>
            <div className="log-stream">
              {logs
                .filter((row) => logFilter === "all" || row.kind === logFilter)
                .map((row) => (
                  <div key={row.id} className="log-row">
                    <span className={`log-dot ${row.kind}`} />
                    <span className="log-time">{dateTime(row.ts)}</span>
                    <span className={`log-kind ${row.kind}`}>{row.kind}</span>
                    <span className="log-summary">
                      {row.email && <span className="log-email">{row.email} · </span>}
                      {row.summary}
                    </span>
                    {row.code != null && <span className="pill bad">{String(row.code)}</span>}
                  </div>
                ))}
              {logs.length === 0 && <p className="muted pad">No log entries yet — activity will appear here as it happens.</p>}
            </div>
          </section>
        )}

        {tab === "activity" && overview && (
          <>
            <section className="card">
              <div className="card-head"><h2>Admin actions</h2><span className="muted small">every powerful action, audited</span></div>
              {audit.length === 0 && <p className="muted">No admin actions recorded yet.</p>}
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id}>
                        <td>{time(entry.ts)}</td>
                        <td>{entry.actorEmail ?? entry.actorUid.slice(0, 8)} <span className="muted">({entry.actorRole ?? "admin"})</span></td>
                        <td><span className="pill">{entry.action}</span></td>
                        <td>{entry.targetEmail ?? entry.targetUid.slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="grid-2">
              <section className="card">
                <div className="card-head"><h2>Web searches</h2></div>
                {overview.recentSearches.length === 0 && <p className="muted">No searches yet.</p>}
                {overview.recentSearches.slice(0, 8).map((entry, index) => (
                  <div key={index} className="mini-row">
                    <span>“{entry.query}”</span>
                    <span className="muted small">{entry.resultCount} results · {entry.provider ?? "—"}</span>
                  </div>
                ))}
              </section>
              <section className="card">
                <div className="card-head"><h2>Model errors</h2></div>
                {overview.recentErrors.length === 0 && <p className="muted">No model errors recorded. 🎉</p>}
                {overview.recentErrors.slice(0, 8).map((entry, index) => (
                  <div key={index} className="mini-row">
                    <span>{entry.model ?? "model"} <span className="pill bad">{entry.status ?? "—"}</span></span>
                    <span className="muted small">{entry.error ?? ""}</span>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}

        {tab === "system" && overview && (
          <>
            <div className="grid-2">
              <section className="card">
                <div className="card-head"><h2>Media storage</h2><span className="muted small">{storage?.source === "firestore" ? "Fallback store · Firestore" : "Cloudinary"}</span></div>
                {storage?.configured && storage.source === "firestore" ? (
                  <div>
                    {storage.cloudinaryError && <div className="alert" role="alert">{storage.cloudinaryError}</div>}
                    <div className="storage-wrap">
                      <div
                        className="pie"
                        style={{
                          background: `conic-gradient(var(--accent) 0% ${storage.quotaBytes ? Math.min(100, Math.round(((storage.storageBytes ?? 0) / storage.quotaBytes) * 1000) / 10) : 0}%, var(--track) ${storage.quotaBytes ? Math.min(100, Math.round(((storage.storageBytes ?? 0) / storage.quotaBytes) * 1000) / 10) : 0}% 100%)`,
                        }}
                      >
                        <div className="pie-hole">
                          <strong>{storage.quotaBytes ? Math.round(((storage.storageBytes ?? 0) / storage.quotaBytes) * 1000) / 10 : 0}%</strong>
                          <span>of ~1 GB used</span>
                        </div>
                      </div>
                      <div className="rows grow">
                        <div className="row"><span>Store</span><strong>Firestore fallback</strong></div>
                        <div className="row"><span>Storage</span><strong>{bytes(storage.storageBytes)}</strong></div>
                        <div className="row"><span>Media files</span><strong>{storage.objects?.toLocaleString("en-US") ?? "—"}</strong></div>
                        <div className="row"><span>Why</span><strong>Cloudinary account limited — uploads auto-fallback here</strong></div>
                      </div>
                    </div>
                  </div>
                ) : storage?.configured && storage.error ? (
                  <div className="alert" role="alert">{storage.error}</div>
                ) : storage?.configured ? (
                  <div className="storage-wrap">
                    <div
                      className="pie"
                      style={{
                        background: `conic-gradient(var(--accent) 0% ${storage.creditsUsedPercent ?? 0}%, var(--track) ${storage.creditsUsedPercent ?? 0}% 100%)`,
                      }}
                    >
                      <div className="pie-hole">
                        <strong>{storage.creditsUsedPercent ?? 0}%</strong>
                        <span>credits used</span>
                      </div>
                    </div>
                    <div className="rows grow">
                      <div className="row"><span>Plan</span><strong>{storage.plan ?? "—"}</strong></div>
                      <div className="row"><span>Credits</span><strong>{storage.creditsUsed ?? "—"} / {storage.creditsLimit ?? "—"}</strong></div>
                      <div className="row"><span>Storage</span><strong>{bytes(storage.storageBytes)}</strong></div>
                      <div className="row"><span>Bandwidth</span><strong>{bytes(storage.bandwidthBytes)}</strong></div>
                      <div className="row"><span>Media files</span><strong>{storage.objects?.toLocaleString("en-US") ?? "—"}</strong></div>
                      <div className="row"><span>Transformations</span><strong>{storage.transformations?.toLocaleString("en-US") ?? "—"}</strong></div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="muted">
                      Storage statistics light up when the backend can see your Cloudinary account
                      (add <code>CLOUDINARY_URL</code> to the <strong>backend</strong> project), or
                      automatically once the fallback store holds its first file while Cloudinary
                      is unavailable.
                    </p>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head"><h2>Capacity today</h2><span className="muted small">free-tier limits</span></div>
                {opsEstimate && (
                  <div className="cap-list">
                    <div>
                      <div className="model-top"><span>Firestore writes (est.)</span><strong>{opsEstimate.writes.toLocaleString("en-US")} / 20,000</strong></div>
                      <div className="sharebar"><div style={{ width: `${Math.min(100, (opsEstimate.writes / 20000) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <div className="model-top"><span>Firestore reads (est.)</span><strong>{opsEstimate.reads.toLocaleString("en-US")} / 50,000</strong></div>
                      <div className="sharebar"><div style={{ width: `${Math.min(100, (opsEstimate.reads / 50000) * 100)}%` }} /></div>
                    </div>
                    <div>
                      <div className="model-top"><span>OpenRouter free requests</span><strong>{overview.totals.requests} / ~50 per day</strong></div>
                      <div className="sharebar"><div style={{ width: `${Math.min(100, (overview.totals.requests / 50) * 100)}%` }} /></div>
                    </div>
                    <p className="muted small">
                      Firestore figures are estimated from the platform’s own metering; the Firebase
                      Console shows billed totals. The OpenRouter cap is the platform-wide free
                      allowance for accounts without credit, resetting at midnight UTC.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <div className="grid-2">
              <section className="card">
                <div className="card-head"><h2>Forecast</h2><span className="muted small">from the current pace</span></div>
                {forecast && (
                  <div className="rows">
                    <div className="row"><span>Today projects to</span><strong>{compact.format(forecast.projectedToday)} tokens</strong></div>
                    <div className="row"><span>Tomorrow (recent average)</span><strong>≈ {compact.format(forecast.tomorrow)} tokens</strong></div>
                    <div className="row"><span>Next 7 days</span><strong>≈ {compact.format(forecast.next7d)} tokens</strong></div>
                    <div className="row"><span>Lifetime</span><strong>{compact.format(overview.lifetime.totalTokens)} tokens · {overview.lifetime.requests.toLocaleString("en-US")} requests · {overview.lifetimeDays} days</strong></div>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head"><h2>Backend</h2><span className={`pill ${overview.backend.integrationsOk ? "ok" : "warn"}`}>{overview.backend.integrationsOk ? "all connected" : "check integrations"}</span></div>
                <div className="rows">
                  <div className="row"><span>Execution mode</span><strong>{overview.backend.executionMode}</strong></div>
                  <div className="row"><span>Watermark engine</span><strong>{overview.backend.watermarkEngine}</strong></div>
                  <div className="row"><span>Realtime streams</span><strong>{overview.live.streams} nodes · {overview.live.generating} generating</strong></div>
                  {Object.entries(overview.backend.integrations).map(([name, ok]) => (
                    <div key={name} className="row"><span>{name}</span><strong>{ok ? "✓ connected" : "✗ missing"}</strong></div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {detailUid && (
        <div className="drawer-wrap" role="dialog" aria-modal="true" aria-label="User details">
          <button type="button" className="drawer-scrim" aria-label="Close details" onClick={() => setDetailUid(null)} />
          <aside className="drawer">
            <div className="drawer-head">
              {detailRow ? <Avatar row={detailRow} size="lg" /> : <span className="avatar lg">?</span>}
              <div className="grow">
                <strong>{detail?.displayName || detailRow?.displayName || detail?.email || detailRow?.email || detailUid}</strong>
                <span className="muted small">{detail?.email ?? detailRow?.email ?? detailUid}</span>
              </div>
              {detail?.role && <span className={`role-badge ${detail.role}`}>{detail.role}</span>}
              <button type="button" className="btn btn-ghost" onClick={() => setDetailUid(null)}>✕</button>
            </div>

            {detailLoading && <p className="muted pad">Loading everything about this account…</p>}
            {detailError && !detail && (
              <div className="alert" role="alert">
                {detailError}{" "}
                <button type="button" className="btn btn-ghost" onClick={() => detailUid && void openDetail(detailUid)}>
                  Retry
                </button>
              </div>
            )}
            {actionError && <div className="alert" role="alert">{actionError}</div>}

            {detail && (
              <>
                <div className="stat-grid">
                  <div><span>Joined</span><strong>{date(detail.createdAt)}</strong></div>
                  <div><span>Last sign-in</span><strong>{date(detail.lastSignInAt)}</strong></div>
                  <div><span>Email</span><strong>{detail.emailVerified ? "Verified" : "Unverified"}</strong></div>
                  <div><span>State</span><strong>{detail.disabled ? "Disabled" : "Active"}</strong></div>
                  <div><span>Sign-in via</span><strong>{detail.providers.join(", ") || "password"}</strong></div>
                  <div><span>Developer</span><strong>{detail.developer ? "API active" : "—"}</strong></div>
                  <div><span>Lifetime tokens</span><strong>{compact.format(detail.lifetime.totalTokens)}</strong></div>
                  <div><span>Lifetime requests</span><strong>{detail.lifetime.requests.toLocaleString("en-US")}</strong></div>
                </div>

                <h3>Last 7 days</h3>
                <WeekBars week={detail.week} field="totalTokens" />

                <h3>Chats · {detail.chats.count}</h3>
                <p className="muted small">Tap a chat to read its messages. Chat views are recorded in the audit log.</p>
                {detail.chats.recent.length === 0 && <p className="muted small">No chats yet.</p>}
                {detail.chats.recent.map((chat) => (
                  <div key={chat.id}>
                    <button
                      type="button"
                      className="mini-row chat-open-row"
                      onClick={() => void loadChatMessages(detail.uid, chat.id)}
                    >
                      <span>{chat.pinned ? "📌 " : ""}{chat.title || "Untitled chat"}</span>
                      <span className="muted small">{openChatId === chat.id ? "hide" : date(chat.updatedAt)}</span>
                    </button>
                    {openChatId === chat.id && (
                      <div className="chat-thread">
                        {chatLoading && <p className="muted small">Loading messages…</p>}
                        {!chatLoading && chatMessages.length === 0 && (
                          <p className="muted small">No messages in this chat.</p>
                        )}
                        {chatMessages.map((message) => (
                          <div key={message.id} className={`chat-msg ${message.role}`}>
                            <span className="chat-msg-role">
                              {message.role}
                              {message.provider ? ` · via ${message.provider}` : ""}
                            </span>
                            <p>{message.content || <em className="muted">(no text)</em>}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <h3>Devices · {detail.devices.length}</h3>
                {detail.devices.length === 0 && <p className="muted small">No devices recorded.</p>}
                {detail.devices.map((device) => (
                  <div key={device.id} className="mini-row">
                    <span>{device.label || device.platform || "Device"}</span>
                    <span className="muted small">last seen {date(device.lastSeenAt)}</span>
                  </div>
                ))}

                <h3>API keys · {detail.apiKeys.length}</h3>
                {detail.apiKeys.length === 0 && <p className="muted small">No API keys.</p>}
                {detail.apiKeys.map((key) => (
                  <div key={key.id} className="mini-row">
                    <span>{key.name || "Unnamed key"}</span>
                    <span className={`pill ${key.revoked ? "bad" : "ok"}`}>{key.revoked ? "revoked" : "active"}</span>
                  </div>
                ))}

                {(detail.securityEvents.length > 0 || detail.apiEvents.length > 0) && (
                  <>
                    <h3>Recent activity</h3>
                    {detail.securityEvents.map((event, index) => (
                      <div key={`s${index}`} className="mini-row">
                        <span>🔐 {event.type}{event.newDevice ? " · new device" : ""}</span>
                        <span className="muted small">{time(event.ts)}</span>
                      </div>
                    ))}
                    {detail.apiEvents.map((event, index) => (
                      <div key={`a${index}`} className="mini-row">
                        <span>API · {event.model ?? "model"} · {event.totalTokens} tokens</span>
                        <span className="muted small">{time(event.ts)}</span>
                      </div>
                    ))}
                  </>
                )}

                <h3>Controls</h3>
                <div className="drawer-actions">
                  {detail.emailVerified ? (
                    <button type="button" className="btn" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "unverify-email", label: `Mark ${detail.email ?? detail.uid} as UNVERIFIED? Features that require a verified email will stop working for them until they verify or an admin verifies them again.` })}>
                      Mark email unverified
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "verify-email", label: `Mark ${detail.email ?? detail.uid} as verified? They’ll be able to use every feature that requires a verified email, without needing the verification email.` })}>
                      Verify email
                    </button>
                  )}
                  {viewer?.role === "owner" && !detail.role && (
                    <button type="button" className="btn btn-primary" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "promote", email: detail.email, label: `Make ${detail.email ?? detail.uid} an admin? They’ll be able to use this console (but not grant admin access). You can revoke this at any time.` })}>
                      Make admin
                    </button>
                  )}
                  {viewer?.role === "owner" && detail.role === "admin" && (
                    <button type="button" className="btn" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "demote", email: detail.email, label: `Remove admin access from ${detail.email ?? detail.uid}? It takes effect on their next request.` })}>
                      Remove admin
                    </button>
                  )}
                  {detail.disabled ? (
                    <button type="button" className="btn" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "enable", label: `Re-enable ${detail.email ?? detail.uid}? They’ll be able to sign in again.` })}>
                      Enable account
                    </button>
                  ) : (
                    <button type="button" className="btn" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "disable", label: `Disable ${detail.email ?? detail.uid}? They won’t be able to sign in until re-enabled.` })}>
                      Disable account
                    </button>
                  )}
                  <button type="button" className="btn" disabled={acting}
                    onClick={() => setPending({ uid: detail.uid, action: "sign-out-all", label: `Sign ${detail.email ?? detail.uid} out on every device? Their current sessions will end.` })}>
                    Sign out everywhere
                  </button>
                  <button type="button" className="btn" disabled={acting} onClick={() => void runResetLink(detail.uid)}>
                    Password reset link
                  </button>
                  {viewer?.role === "owner" && detail.role !== "owner" && (
                    <button type="button" className="btn btn-danger" disabled={acting}
                      onClick={() => setPending({ uid: detail.uid, action: "delete", email: detail.email, label: `Delete ${detail.email ?? detail.uid} permanently? Their chats and files are removed; a measurement snapshot is kept in the trash archive.` })}>
                      Delete account
                    </button>
                  )}
                </div>
                {resetLink && (
                  <div className="reset-box">
                    <span className="muted small">Password reset link (share it only with the account owner):</span>
                    <code>{resetLink}</code>
                    <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(resetLink)}>
                      Copy link
                    </button>
                  </div>
                )}
                <p className="muted small uid-line">UID <code>{detail.uid}</code></p>
              </>
            )}
          </aside>
        </div>
      )}

      {createOpen && (
        <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Create account">
          <div className="modal">
            <h2>Create account</h2>
            <p className="muted">
              The account is created instantly with a profile — the person can
              sign in right away with the temporary password you give them.
            </p>
            <label className="modal-field">
              <span>Email</span>
              <input
                type="email"
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
                placeholder="person@example.com"
                autoComplete="off"
              />
            </label>
            <label className="modal-field">
              <span>Display name (optional)</span>
              <input
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Their name"
                autoComplete="off"
              />
            </label>
            <label className="modal-field">
              <span>Temporary password</span>
              <span className="field-row">
                <input
                  type={createShowPassword ? "text" : "password"}
                  value={createPassword}
                  onChange={(event) => setCreatePassword(event.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" className="btn btn-ghost" onClick={() => setCreateShowPassword((show) => !show)}>
                  {createShowPassword ? "Hide" : "Show"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setCreatePassword(generateTempPassword())}>
                  Regenerate
                </button>
              </span>
              <span className="muted small">
                Must be 10+ characters with a lowercase letter, an uppercase letter and a symbol — the same rules as public sign-up. Share it with the person privately; they can change it in Settings.
              </span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={createVerified}
                onChange={(event) => setCreateVerified(event.target.checked)}
              />
              <span>Mark the email as verified (recommended for people you know)</span>
            </label>
            {createError && <div className="alert" role="alert">{createError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runCreateAccount()}
                disabled={creating || !createEmail.trim() || !createPassword}
              >
                {creating ? "Creating…" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="modal-wrap" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Are you sure?</h2>
            <p>{pending.label}</p>
            {pending.action === "promote" && pending.email && (
              <div className="modal-field">
                <span>
                  Type the account’s email to confirm (or tap it):{" "}
                  <button
                    type="button"
                    className="email-fill"
                    onClick={() => pending.email && setConfirmEmail(pending.email)}
                  >
                    {pending.email}
                  </button>
                </span>
                <input
                  type="email"
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                  placeholder="Type the email here to confirm"
                  autoComplete="off"
                />
                {pendingEmailOk ? (
                  <span className="match-ok">✓ Email matches — you can confirm.</span>
                ) : (
                  <span className="muted small">
                    Confirm stays disabled until the email matches exactly.
                  </span>
                )}
              </div>
            )}
            {SECRET_GATED_ACTIONS.includes(pending.action) &&
              viewer?.ownerSecretConfigured === false && (
                <div className="alert" role="alert">
                  The owner secret is not set on the backend yet, so this will be
                  refused. Add OWNER_SECRET to the xyro-backend project in Vercel
                  and redeploy it first.
                </div>
              )}
            {SECRET_GATED_ACTIONS.includes(pending.action) && (
              <label className="modal-field">
                <span>Owner secret — required for this change</span>
                <input
                  type="password"
                  value={ownerSecretInput}
                  onChange={(event) => setOwnerSecretInput(event.target.value)}
                  placeholder="Enter your owner secret"
                  autoComplete="current-password"
                />
              </label>
            )}
            {actionError && <div className="alert" role="alert">{actionError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPending(null)} disabled={acting}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void runAction()} disabled={!canConfirm}>
                {acting ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="print-report">
        <h1>Xyro AI — Admin report</h1>
        <p>Generated {new Date().toLocaleString("en-GB")} · {overview?.today}</p>
        {overview && (
          <>
            <h2>Today</h2>
            <p>
              {overview.totals.requests} requests · {overview.totals.totalTokens.toLocaleString("en-US")} tokens ·
              est. {usd(overview.totals.costUsd)} · lifetime {overview.lifetime.totalTokens.toLocaleString("en-US")} tokens
              over {overview.lifetimeDays} days
            </p>
            <h2>Accounts</h2>
            <p>{users.length} accounts · {users.filter((row) => row.admin).length} admins</p>
            <h2>Top models today</h2>
            {overview.models.slice(0, 5).map((model) => (
              <p key={model.model}>{model.model}: {model.totalTokens.toLocaleString("en-US")} tokens</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function BucketBars({ buckets }: { buckets: (Totals & { label: string })[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.totalTokens));
  return (
    <div className="weekbars">
      {buckets.map((bucket, index) => (
        <div key={index} className="weekbar" title={`${bucket.label}: ${bucket.totalTokens.toLocaleString("en-US")} tokens`}>
          <span className="weekbar-value">{compact.format(bucket.totalTokens)}</span>
          <div className="weekbar-track">
            <div className="weekbar-fill" style={{ height: `${Math.max(3, (bucket.totalTokens / max) * 100)}%` }} />
          </div>
          <span className="weekbar-day">{index % 3 === 0 ? bucket.label : ""}</span>
        </div>
      ))}
    </div>
  );
}
