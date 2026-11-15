"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  onAuthStateChanged,
  reload,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import ConfirmDialog from "@/components/confirm-dialog";
import SignOutDialog, { type SignOutVariant } from "@/components/sign-out-dialog";
import { isFirebaseConfigured, tryGetFirebaseAuth } from "@/lib/firebase/auth-client";
import { tryGetFirebaseFirestore } from "@/lib/firebase/firestore-client";
import { performSignOut } from "@/lib/firebase/sign-out";
import {
  MAX_INSTRUCTIONS_LENGTH,
  THEMES,
  TYPING_SPEEDS,
  type Preferences,
  type Theme,
  type TypingSpeed,
} from "@/lib/preferences";
import { applyThemePreference } from "@/lib/theme-client";
import {
  fetchPreferences,
  getApiErrorMessage,
  patchPreferences,
  settingsApi,
} from "@/lib/preferences-client";

import { SETTINGS_TABS, type SettingsTabId } from "@/lib/settings-tabs";

type ProfileView = { displayName: string; photoURL: string; email: string };

const APP_VERSION = "0.1.0";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SettingsShell({ tab }: { tab: SettingsTabId }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "not-configured" | "signed-out" | "ready" | "error"
  >("loading");
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [toast, setToast] = useState("");
  const [saveError, setSaveError] = useState("");
  const toastTimer = useRef<number>(0);
  const lastServerPreferences = useRef<Preferences | null>(null);
  const pendingPatch = useRef<Partial<Preferences>>({});
  const saveTimer = useRef<number>(0);
  const [signOutVariant, setSignOutVariant] = useState<SignOutVariant | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthState("not-configured");
      return;
    }
    const auth = tryGetFirebaseAuth();
    const db = tryGetFirebaseFirestore();
    if (!auth || !db) {
      setAuthState("error");
      return;
    }
    let stopProfile: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (currentUser) => {
      stopProfile?.();
      stopProfile = undefined;
      if (!currentUser) {
        setUser(null);
        setAuthState("signed-out");
        router.replace(`/sign-in?next=/settings/${tab}`);
        return;
      }
      setUser(currentUser);
      setAuthState("ready");
      stopProfile = onSnapshot(
        doc(db, "users", currentUser.uid),
        (snapshot) => {
          const data = snapshot.data();
          setProfile({
            displayName:
              typeof data?.displayName === "string" ? data.displayName : "",
            photoURL: typeof data?.photoURL === "string" ? data.photoURL : "",
            email: typeof data?.email === "string" ? data.email : (currentUser.email ?? ""),
          });
        },
        () => setAuthState("error"),
      );
      void fetchPreferences(currentUser)
        .then((loaded) => {
          lastServerPreferences.current = loaded;
          setPreferences(loaded);
        })
        .catch(() => setSaveError("Settings couldn’t be loaded. Changes may not save."));
    });
    return () => {
      stopAuth();
      stopProfile?.();
    };
  }, [router, tab]);

  // Instant save with optimistic UI: apply locally at once, debounce
  // 600 ms so a burst of changes is one PATCH (one Firestore write),
  // show "Saved" on success, and roll back with an error on failure.
  const savePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      if (!user) return;
      setSaveError("");
      setPreferences((current) => (current ? { ...current, ...patch } : current));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const toSend = pendingPatch.current;
        pendingPatch.current = {};
        if (Object.keys(toSend).length === 0) return;
        void patchPreferences(user, toSend)
          .then((saved) => {
            lastServerPreferences.current = saved;
            setPreferences(saved);
            showToast("Saved");
          })
          .catch((error) => {
            setPreferences(lastServerPreferences.current);
            setSaveError(
              error instanceof Error
                ? error.message
                : "Your change couldn’t be saved.",
            );
          });
      }, 600);
    },
    [user, showToast],
  );

  async function confirmSignOut() {
    if (!signOutVariant) return;
    setSigningOut(true);
    await performSignOut({ allDevices: signOutVariant === "all" });
    setSigningOut(false);
    setSignOutVariant(null);
  }

  return (
    <section className="settings-page page-width">
      <header className="workspace-heading">
        <div>
          <span className="eyebrow">Your account</span>
          <h1>Settings</h1>
          <p>
            <Link className="text-link" href="/chat">← Back to chat</Link>
          </p>
        </div>
        <span className="workspace-badge"><i /> Private account</span>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((entry) => (
            <Link
              key={entry.id}
              href={`/settings/${entry.id}`}
              aria-current={entry.id === tab ? "page" : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <div className="settings-sections">
          {authState === "loading" && (
            <div className="settings-content" aria-busy="true">
              <div className="settings-skeleton settings-skeleton-title" />
              <div className="settings-skeleton" />
              <div className="settings-skeleton" />
              <span className="settings-visually-hidden" role="status">Loading settings…</span>
            </div>
          )}
          {authState === "not-configured" && (
            <div className="settings-content">
              <div className="auth-alert" role="alert">
                Firebase is not configured. Add the Firebase web settings locally or in Vercel, then redeploy.
              </div>
            </div>
          )}
          {authState === "error" && (
            <div className="settings-content">
              <div className="auth-alert" role="alert">
                We couldn’t load your account details. Check your connection and try again.
              </div>
            </div>
          )}
          {authState === "ready" && user && (
            <>
              {tab === "profile" && (
                <ProfileTab
                  user={user}
                  profile={profile}
                  onToast={showToast}
                />
              )}
              {tab === "general" && preferences && (
                <GeneralTab
                  user={user}
                  preferences={preferences}
                  onSave={savePreferences}
                />
              )}
              {tab === "personalization" && preferences && (
                <PersonalizationTab
                  preferences={preferences}
                  onSave={savePreferences}
                />
              )}
              {tab === "data" && <DataTab user={user} onToast={showToast} />}
              {tab === "security" && (
                <SecurityTab
                  user={user}
                  onToast={showToast}
                  onSignOutAll={() => setSignOutVariant("all")}
                />
              )}
              {tab === "developer" && <DeveloperTab user={user} onToast={showToast} />}
              {tab === "usage" && <UsageTab user={user} />}
              {tab === "account" && (
                <AccountTab
                  user={user}
                  onSignOut={() => setSignOutVariant("single")}
                />
              )}
              {(tab === "general" || tab === "personalization") && !preferences && (
                <div className="settings-content" aria-busy="true">
                  <div className="settings-skeleton settings-skeleton-title" />
                  <div className="settings-skeleton" />
                  <span className="settings-visually-hidden" role="status">Loading preferences…</span>
                </div>
              )}
            </>
          )}
          {saveError && (
            <div className="auth-alert settings-save-error" role="alert">{saveError}</div>
          )}
        </div>
      </div>

      {toast && (
        <div className="settings-toast" role="status">{toast}</div>
      )}
      <SignOutDialog
        open={signOutVariant !== null}
        variant={signOutVariant ?? "single"}
        busy={signingOut}
        onCancel={() => setSignOutVariant(null)}
        onConfirm={confirmSignOut}
      />
    </section>
  );
}

/* ------------------------------ Profile ------------------------------ */

function ProfileTab({
  user,
  profile,
  onToast,
}: {
  user: User;
  profile: ProfileView | null;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNote, setResendNote] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    setName(profile?.displayName ?? "");
  }, [profile?.displayName]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setResendCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function saveName() {
    setNameBusy(true);
    setNameError("");
    try {
      const response = await settingsApi(user, "/api/settings/profile", {
        method: "PATCH",
        body: { displayName: name },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Your name couldn’t be saved."));
      }
      await updateProfile(user, { displayName: name.trim() }).catch(() => {});
      onToast("Saved");
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "Your name couldn’t be saved.");
    } finally {
      setNameBusy(false);
    }
  }

  async function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarError("");
    if (!file.type.startsWith("image/")) {
      setAvatarError("Choose an image file for your picture.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAvatarError("Choose an image up to 10 MB; it will be cropped and resized.");
      return;
    }
    setAvatarBusy(true);
    try {
      // Centre square-crop to 256×256 on a canvas, then upload.
      const bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image editing isn’t available in this browser.");
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        256,
        256,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("That image couldn’t be prepared.");
      if (blob.size > 2 * 1024 * 1024) {
        throw new Error("The cropped picture is still over 2 MB. Try a smaller image.");
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          resolve(result.split(",")[1] ?? "");
        };
        reader.onerror = () => reject(new Error("That image couldn’t be read."));
        reader.readAsDataURL(blob);
      });
      const response = await settingsApi(user, "/api/settings/avatar", {
        method: "POST",
        body: { dataBase64: base64, contentType: "image/png" },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Your picture couldn’t be saved."));
      }
      const data = (await response.json()) as { photoURL?: string };
      if (data.photoURL) {
        await updateProfile(user, { photoURL: data.photoURL }).catch(() => {});
      }
      setTick((value) => value + 1);
      onToast("Saved");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Your picture couldn’t be saved.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function resendVerification() {
    if (resendCooldown > 0) return;
    setResendBusy(true);
    setResendNote("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "xyro",
        },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "We couldn’t send the verification email."));
      }
      setResendCooldown(60);
      setResendNote("A fresh verification link is on its way. Check your inbox and spam folder.");
    } catch (error) {
      setResendNote(error instanceof Error ? error.message : "We couldn’t send the verification email.");
    } finally {
      setResendBusy(false);
    }
  }

  const photoURL = profile?.photoURL || user.photoURL || "";
  const email = profile?.email || user.email || "";

  return (
    <section className="settings-content" aria-labelledby="settings-profile-heading">
      <h2 id="settings-profile-heading">Profile</h2>
      <p>How you appear in Xyro AI.</p>

      <div className="settings-field">
        <span className="settings-label">Picture</span>
        <div className="settings-avatar-row">
          {photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="settings-avatar" src={photoURL} alt="" width={64} height={64} />
          ) : (
            <span className="settings-avatar settings-avatar-fallback" aria-hidden="true">
              {(name || email || "x").slice(0, 1).toUpperCase()}
            </span>
          )}
          <label className="button button-outline settings-avatar-button">
            {avatarBusy ? "Uploading…" : "Upload picture"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="settings-visually-hidden"
              onChange={handleAvatar}
              disabled={avatarBusy}
            />
          </label>
        </div>
        <p className="settings-hint">PNG, JPEG, WebP or GIF. Cropped to a square, up to 2 MB.</p>
        {avatarError && <p className="settings-error" role="alert">{avatarError}</p>}
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-display-name">Display name</label>
        <div className="settings-inline">
          <input
            id="settings-display-name"
            type="text"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
          <button
            type="button"
            className="button button-primary"
            onClick={saveName}
            disabled={nameBusy || name.trim() === (profile?.displayName ?? "")}
          >
            {nameBusy ? "Saving…" : "Save"}
          </button>
        </div>
        {nameError && <p className="settings-error" role="alert">{nameError}</p>}
      </div>

      <div className="settings-field">
        <span className="settings-label">Email</span>
        <p className="settings-value">
          {email}{" "}
          {user.emailVerified ? (
            <span className="settings-badge settings-badge-ok">Verified</span>
          ) : (
            <span className="settings-badge settings-badge-warn">Not verified</span>
          )}
        </p>
        {!user.emailVerified && (
          <>
            <button
              type="button"
              className="button button-outline"
              onClick={resendVerification}
              disabled={resendBusy || resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Resend verification (${resendCooldown}s)`
                : "Resend verification email"}
            </button>
            {resendNote && <p className="settings-hint" role="status">{resendNote}</p>}
            <button
              type="button"
              className="text-link"
              onClick={() => void reload(user).then(() => setTick((v) => v + 1))}
            >
              I’ve verified — refresh status
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ General ------------------------------ */

function GeneralTab({
  user,
  preferences,
  onSave,
}: {
  user: User;
  preferences: Preferences;
  onSave: (patch: Partial<Preferences>) => void;
}) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([
    { id: "openrouter/free", name: "Auto (Free)" },
  ]);
  const [modelsNote, setModelsNote] = useState("");

  useEffect(() => {
    let active = true;
    void settingsApi(user, "/api/models", { method: "GET" })
      .then(async (response) => {
        if (!response.ok) throw new Error("models");
        const data = (await response.json()) as {
          models?: { id: string; name: string }[];
          source?: string;
        };
        if (!active || !Array.isArray(data.models)) return;
        setModels(data.models);
        if (data.source === "fallback") {
          setModelsNote("Showing the built-in free list — the live catalogue couldn’t be reached.");
        }
      })
      .catch(() => {
        if (active) setModelsNote("The model list couldn’t be loaded; Auto (Free) remains available.");
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <section className="settings-content" aria-labelledby="settings-general-heading">
      <h2 id="settings-general-heading">General</h2>
      <p>Everyday behaviour of the chat workspace. Changes save automatically.</p>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-theme">Theme</label>
        <select
          id="settings-theme"
          value={preferences.theme}
          onChange={(event) => {
            const theme = event.target.value as Theme;
            // Apply at once (and mirror for the pre-paint script);
            // onSave persists it through /api/settings like every
            // other preference.
            applyThemePreference(theme);
            onSave({ theme });
          }}
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {theme === "system"
                ? "System"
                : theme[0].toUpperCase() + theme.slice(1)}
            </option>
          ))}
        </select>
        <p className="settings-hint">
          System follows your device&apos;s light or dark setting. Your choice applies on every device you sign in on.
        </p>
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-typing-speed">Typing speed</label>
        <select
          id="settings-typing-speed"
          value={preferences.typingSpeed}
          onChange={(event) =>
            onSave({ typingSpeed: event.target.value as TypingSpeed })
          }
        >
          {TYPING_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed[0].toUpperCase() + speed.slice(1)}
            </option>
          ))}
        </select>
        <p className="settings-hint">How quickly AI replies appear on screen.</p>
      </div>

      <div className="settings-field">
        <span className="settings-label" id="settings-send-key-label">Sending messages</span>
        <div role="radiogroup" aria-labelledby="settings-send-key-label" className="settings-radio-group">
          <label>
            <input
              type="radio"
              name="send-key"
              checked={preferences.sendWithEnter}
              onChange={() => onSave({ sendWithEnter: true })}
            />{" "}
            Send with Enter
          </label>
          <label>
            <input
              type="radio"
              name="send-key"
              checked={!preferences.sendWithEnter}
              onChange={() => onSave({ sendWithEnter: false })}
            />{" "}
            Send with Cmd/Ctrl + Enter
          </label>
        </div>
        <p className="settings-hint">With Cmd/Ctrl + Enter, plain Enter adds a new line.</p>
      </div>

      <div className="settings-field">
        <label className="settings-switch-row">
          <span>
            <span className="settings-label">Show suggestions on an empty chat</span>
            <span className="settings-hint">Prompt ideas on a new, empty conversation.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={preferences.showSuggestions}
            onChange={(event) => onSave({ showSuggestions: event.target.checked })}
          />
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-default-model">Default model</label>
        <select
          id="settings-default-model"
          value={preferences.defaultModel}
          onChange={(event) => onSave({ defaultModel: event.target.value })}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
          {!models.some((model) => model.id === preferences.defaultModel) && (
            <option value={preferences.defaultModel}>{preferences.defaultModel}</option>
          )}
        </select>
        <p className="settings-hint">
          Free models from OpenRouter. If a chosen model is busy, chat falls back to Auto (Free) once.
        </p>
        {modelsNote && <p className="settings-hint" role="status">{modelsNote}</p>}
      </div>
    </section>
  );
}

/* --------------------------- Personalization --------------------------- */

function PersonalizationTab({
  preferences,
  onSave,
}: {
  preferences: Preferences;
  onSave: (patch: Partial<Preferences>) => void;
}) {
  return (
    <section className="settings-content" aria-labelledby="settings-personalization-heading">
      <h2 id="settings-personalization-heading">Personalization</h2>
      <p>
        Custom instructions are added to every chat while the switch is on.
        Changes save automatically.
      </p>

      <div className="settings-field">
        <label className="settings-switch-row">
          <span>
            <span className="settings-label">Use custom instructions</span>
            <span className="settings-hint">Turn off to keep the text but stop sending it to the model.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={preferences.instructionsEnabled}
            onChange={(event) => onSave({ instructionsEnabled: event.target.checked })}
          />
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-instructions-about">
          What should Xyro AI know about you?
        </label>
        <textarea
          id="settings-instructions-about"
          rows={5}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          value={preferences.instructionsAbout}
          onChange={(event) => onSave({ instructionsAbout: event.target.value })}
          placeholder="For example: I’m a product designer in Dhaka, I prefer metric units…"
        />
        <p className="settings-hint settings-counter">
          {preferences.instructionsAbout.length} / {MAX_INSTRUCTIONS_LENGTH}
        </p>
      </div>

      <div className="settings-field">
        <label className="settings-label" htmlFor="settings-instructions-style">
          How should it respond?
        </label>
        <textarea
          id="settings-instructions-style"
          rows={5}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          value={preferences.instructionsStyle}
          onChange={(event) => onSave({ instructionsStyle: event.target.value })}
          placeholder="For example: Be concise, use headings, show code examples…"
        />
        <p className="settings-hint settings-counter">
          {preferences.instructionsStyle.length} / {MAX_INSTRUCTIONS_LENGTH}
        </p>
      </div>
    </section>
  );
}

/* -------------------------------- Data -------------------------------- */

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  status: string;
  createdAt: number;
};

function DataTab({
  user,
  onToast,
}: {
  user: User;
  onToast: (message: string) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[] | null>(null);
  const [filesError, setFilesError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const [deleteAllNote, setDeleteAllNote] = useState("");

  const loadFiles = useCallback(async () => {
    try {
      const response = await settingsApi(user, "/api/settings/files", { method: "GET" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Your files couldn’t be loaded."));
      }
      const data = (await response.json()) as { files?: UploadedFile[] };
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : "Your files couldn’t be loaded.");
    }
  }, [user]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  async function deleteFile(file: UploadedFile) {
    setDeletingId(file.id);
    try {
      const response = await settingsApi(user, "/api/settings/files", {
        method: "DELETE",
        body: { assetId: file.id },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "This file couldn’t be deleted."));
      }
      setFiles((current) => (current ? current.filter((item) => item.id !== file.id) : current));
      onToast("File deleted");
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : "This file couldn’t be deleted.");
    } finally {
      setDeletingId("");
    }
  }

  async function exportData(format: "json" | "markdown") {
    setExportBusy(true);
    setExportNote("");
    try {
      const response = await settingsApi(user, "/api/export", {
        method: "POST",
        body: { format },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Your export couldn’t be prepared."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format === "markdown" ? "xyro-data-export.md" : "xyro-data-export.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNote("Your export has downloaded. You can export again tomorrow.");
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : "Your export couldn’t be prepared.");
    } finally {
      setExportBusy(false);
    }
  }

  async function deleteAllChats() {
    setDeleteAllBusy(true);
    setDeleteAllNote("");
    try {
      let continuation = false;
      let total = 0;
      for (let round = 0; round < 200; round += 1) {
        const response = await settingsApi(user, "/api/settings/delete-chats", {
          method: "POST",
          body: { confirmation: "DELETE", continuation },
        });
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Some chats couldn’t be deleted."));
        }
        const data = (await response.json()) as { done?: boolean; deleted?: number };
        total += typeof data.deleted === "number" ? data.deleted : 0;
        if (data.done) break;
        continuation = true;
        if (round === 199) throw new Error("Deletion is taking longer than expected. Run it again to continue.");
      }
      setDeleteAllOpen(false);
      setDeleteAllText("");
      setDeleteAllNote(
        total > 0
          ? `Deleted ${total} chat${total === 1 ? "" : "s"} and their files.`
          : "All chats are deleted.",
      );
    } catch (error) {
      setDeleteAllNote(
        error instanceof Error
          ? `${error.message} You can run it again to continue where it stopped.`
          : "Some chats couldn’t be deleted.",
      );
    } finally {
      setDeleteAllBusy(false);
    }
  }

  return (
    <section className="settings-content" aria-labelledby="settings-data-heading">
      <h2 id="settings-data-heading">Data controls</h2>
      <p>Export, review and remove what Xyro AI stores for you.</p>

      <div className="settings-field">
        <span className="settings-label">Export my data</span>
        <p className="settings-hint">
          Profile, settings, chats with messages, and uploaded-file details. Once a day.
        </p>
        <div className="settings-inline">
          <button type="button" className="button button-outline" onClick={() => void exportData("json")} disabled={exportBusy}>
            {exportBusy ? "Preparing…" : "Download JSON"}
          </button>
          <button type="button" className="button button-outline" onClick={() => void exportData("markdown")} disabled={exportBusy}>
            Download Markdown
          </button>
        </div>
        {exportNote && <p className="settings-hint" role="status">{exportNote}</p>}
      </div>

      <div className="settings-field">
        <span className="settings-label">Uploaded files</span>
        {filesError && <p className="settings-error" role="alert">{filesError}</p>}
        {files === null && !filesError && <p className="settings-hint" role="status">Loading your files…</p>}
        {files !== null && files.length === 0 && (
          <p className="settings-hint">You haven’t uploaded any files yet.</p>
        )}
        {files !== null && files.length > 0 && (
          <ul className="settings-file-list">
            {files.map((file) => (
              <li key={file.id}>
                <span className="settings-file-name">{file.name}</span>
                <span className="settings-file-meta">
                  {formatBytes(file.size)} · {formatDate(file.createdAt)}
                </span>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => void deleteFile(file)}
                  disabled={deletingId === file.id}
                >
                  {deletingId === file.id ? "Deleting…" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-field settings-danger-zone">
        <span className="settings-label">Delete all chats</span>
        <p className="settings-hint">
          Removes every conversation, its messages and the files attached to those chats. This can’t be undone.
        </p>
        <button type="button" className="button button-danger" onClick={() => setDeleteAllOpen(true)}>
          Delete all chats
        </button>
        {deleteAllNote && <p className="settings-hint" role="status">{deleteAllNote}</p>}
      </div>

      <ConfirmDialog
        open={deleteAllOpen}
        title="Delete all chats?"
        body="Every conversation and its files will be permanently deleted. Type DELETE to confirm."
        confirmLabel="Delete all chats"
        busy={deleteAllBusy}
        busyLabel="Deleting…"
        onCancel={() => {
          setDeleteAllOpen(false);
          setDeleteAllText("");
        }}
        onConfirm={() => {
          if (deleteAllText === "DELETE") void deleteAllChats();
        }}
      >
        <label className="settings-label" htmlFor="delete-all-confirm-text">Type DELETE</label>
        <input
          id="delete-all-confirm-text"
          type="text"
          value={deleteAllText}
          onChange={(event) => setDeleteAllText(event.target.value)}
          autoComplete="off"
          placeholder="DELETE"
        />
        {deleteAllText !== "DELETE" && (
          <p className="settings-hint">The confirm button activates when the text matches.</p>
        )}
      </ConfirmDialog>
    </section>
  );
}

/* ------------------------------ Security ------------------------------ */

type SessionInfo = {
  sid: string;
  device: string;
  city: string | null;
  country: string | null;
  createdAt: number;
  lastActiveAt: number;
  current: boolean;
  deviceId?: string | null;
  authMethod?: string | null;
  newDevice?: boolean;
};

type DeviceInfo = {
  deviceId: string;
  label: string;
  browser: string;
  os: string;
  deviceType: string;
  firstSeenAt: number;
  lastSeenAt: number;
  loginCount: number;
};

type SecurityEventInfo = {
  id: string;
  type: string;
  deviceLabel: string | null;
  createdAt: number;
};

const SECURITY_EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in with password",
  sign_up: "Account created",
  google_sign_in: "Signed in with Google",
  new_device: "Sign-in from a new device",
  device_velocity: "Many accounts created from one device",
};

function SecurityTab({
  user,
  onToast,
  onSignOutAll,
}: {
  user: User;
  onToast: (message: string) => void;
  onSignOutAll: () => void;
}) {
  const [methods, setMethods] = useState<{ id: string; email: string | null }[] | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [recentEvents, setRecentEvents] = useState<SecurityEventInfo[] | null>(null);
  const [securityError, setSecurityError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNote, setPasswordNote] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<SessionInfo | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);

  const loadSecurity = useCallback(async () => {
    try {
      const response = await settingsApi(user, "/api/account/sessions", { method: "GET" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Security details couldn’t be loaded."));
      }
      const data = (await response.json()) as {
        sessions?: SessionInfo[];
        devices?: DeviceInfo[];
        recentEvents?: SecurityEventInfo[];
        methods?: { id: string; email: string | null }[];
      };
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setRecentEvents(Array.isArray(data.recentEvents) ? data.recentEvents : []);
      setMethods(Array.isArray(data.methods) ? data.methods : []);
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Security details couldn’t be loaded.");
    }
  }, [user]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  const hasPassword = methods?.some((method) => method.id === "password") ?? false;
  const methodsLoaded = methods !== null;

  async function changePassword() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordNote("");
    try {
      const response = await settingsApi(user, "/api/account/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      const data = (await response.json().catch(() => null)) as
        | { warning?: string; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Your password couldn’t be changed.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setPasswordNote(
        data?.warning ??
          "Your password was changed. Other devices have been signed out; this device stays signed in.",
      );
      onToast("Password changed");
      void loadSecurity();
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Your password couldn’t be changed.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function revokeSession(target: SessionInfo) {
    setRevokeBusy(true);
    try {
      const response = await settingsApi(user, "/api/account/sessions", {
        method: "POST",
        body: { action: "revoke", sid: target.sid },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "That device couldn’t be signed out."));
      }
      setSessions((current) =>
        current ? current.filter((session) => session.sid !== target.sid) : current,
      );
      onToast("Device signed out");
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "That device couldn’t be signed out.");
    } finally {
      setRevokeBusy(false);
      setRevokeTarget(null);
    }
  }

  async function revokeOthers() {
    setRevokeBusy(true);
    try {
      const response = await settingsApi(user, "/api/account/sessions", {
        method: "POST",
        body: { action: "revokeOthers" },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Other devices couldn’t be signed out."));
      }
      onToast("Other devices signed out");
      void loadSecurity();
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Other devices couldn’t be signed out.");
    } finally {
      setRevokeBusy(false);
      setRevokeOthersOpen(false);
    }
  }

  return (
    <section className="settings-content" aria-labelledby="settings-security-heading">
      <h2 id="settings-security-heading">Security</h2>
      <p>Password, sign-in methods and the devices signed in to your account.</p>
      {securityError && <p className="settings-error" role="alert">{securityError}</p>}

      <div className="settings-field">
        <span className="settings-label">Sign-in methods</span>
        {!methodsLoaded && <p className="settings-hint" role="status">Loading…</p>}
        {methodsLoaded && (
          <ul className="settings-method-list">
            {methods.map((method) => (
              <li key={method.id}>
                {method.id === "password"
                  ? "Email and password"
                  : method.id === "google.com"
                    ? "Google"
                    : method.id}
                {method.email ? <span className="settings-file-meta"> · {method.email}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-field">
        <span className="settings-label">Change password</span>
        {methodsLoaded && !hasPassword ? (
          <p className="settings-hint">
            This account signs in with Google, so there’s no Xyro AI password to change.
            Manage your password in your Google account instead.
          </p>
        ) : (
          <>
            <label className="settings-label" htmlFor="settings-current-password">Current password</label>
            <input
              id="settings-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
            <label className="settings-label" htmlFor="settings-new-password">New password</label>
            <input
              id="settings-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <p className="settings-hint">At least 10 characters, and not a password that appears in known data breaches.</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void changePassword()}
              disabled={passwordBusy || !currentPassword || newPassword.length < 10}
            >
              {passwordBusy ? "Changing…" : "Change password"}
            </button>
            {passwordError && <p className="settings-error" role="alert">{passwordError}</p>}
            {passwordNote && <p className="settings-hint" role="status">{passwordNote}</p>}
          </>
        )}
      </div>

      <div className="settings-field">
        <span className="settings-label">Sessions</span>
        <p className="settings-hint">
          Revoking a device stops its access to your account’s API right away; the app on
          that device will ask for a fresh sign-in before it can load or send anything.
        </p>
        {sessions === null && <p className="settings-hint" role="status">Loading sessions…</p>}
        {sessions !== null && sessions.length === 0 && (
          <p className="settings-hint">No sessions are recorded yet. They appear here after your next sign-in.</p>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul className="settings-session-list">
            {sessions.map((session) => (
              <li key={session.sid}>
                <span className="settings-session-device">
                  {session.device}
                  {session.current && <span className="settings-badge settings-badge-ok">This device</span>}
                  {session.newDevice && <span className="settings-badge">New device</span>}
                </span>
                <span className="settings-file-meta">
                  {[session.city, session.country].filter(Boolean).join(", ") || "Location unavailable"}
                  {" · "}Active {formatDate(session.lastActiveAt)}
                  {session.authMethod && (
                    <>{" · "}via {session.authMethod === "google" ? "Google" : "password"}</>
                  )}
                </span>
                {!session.current && (
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setRevokeTarget(session)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="settings-inline">
          <button type="button" className="button button-outline" onClick={() => setRevokeOthersOpen(true)}>
            Sign out of all other devices
          </button>
          <button type="button" className="button button-outline" onClick={onSignOutAll}>
            Sign out of all devices
          </button>
        </div>
      </div>

      <div className="settings-field">
        <span className="settings-label">Your devices</span>
        <p className="settings-hint">
          Devices are recognised by a privacy-preserving fingerprint computed in your
          browser at sign-in. It helps spot sign-ins you don’t recognise; it is never
          used to track you across other sites.
        </p>
        {devices === null && <p className="settings-hint" role="status">Loading devices…</p>}
        {devices !== null && devices.length === 0 && (
          <p className="settings-hint">No devices recorded yet. They appear here after your next sign-in.</p>
        )}
        {devices !== null && devices.length > 0 && (
          <ul className="settings-session-list">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <span className="settings-session-device">{device.label}</span>
                <span className="settings-file-meta">
                  First seen {formatDate(device.firstSeenAt)}
                  {" · "}Last active {formatDate(device.lastSeenAt)}
                  {" · "}{device.loginCount} {device.loginCount === 1 ? "sign-in" : "sign-ins"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-field">
        <span className="settings-label">Recent security activity</span>
        {recentEvents === null && <p className="settings-hint" role="status">Loading activity…</p>}
        {recentEvents !== null && recentEvents.length === 0 && (
          <p className="settings-hint">No security activity recorded yet.</p>
        )}
        {recentEvents !== null && recentEvents.length > 0 && (
          <ul className="settings-session-list">
            {recentEvents.map((event) => (
              <li key={event.id}>
                <span className="settings-session-device">
                  {SECURITY_EVENT_LABELS[event.type] ?? "Security event"}
                </span>
                <span className="settings-file-meta">
                  {event.deviceLabel ?? "Unknown device"}
                  {" · "}{formatDate(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Sign out this device?"
        body={`${revokeTarget?.device ?? "This device"} will lose access to your account right away and will need to sign in again.`}
        confirmLabel="Sign out device"
        busy={revokeBusy}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) void revokeSession(revokeTarget);
        }}
      />
      <ConfirmDialog
        open={revokeOthersOpen}
        title="Sign out of all other devices?"
        body="Every other signed-in device will lose access right away and will need to sign in again. This device stays signed in."
        confirmLabel="Sign out other devices"
        busy={revokeBusy}
        onCancel={() => setRevokeOthersOpen(false)}
        onConfirm={() => void revokeOthers()}
      />
    </section>
  );
}

/* ----------------------------- Developer ----------------------------- */

type DeveloperProfileInfo = {
  projectName: string;
  useCase: string;
  builderType: string;
  language: string;
  website: string | null;
  plan: string;
  createdAt: number;
};

type ApiKeyInfo = {
  keyId: string;
  name: string;
  displayPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
};

type DailyUsageInfo = {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type DeveloperEventInfo = {
  id: string;
  createdAt: number;
  keyPrefix: string | null;
  endpoint: string;
  model: string | null;
  status: string;
  httpStatus: number;
  totalTokens: number;
  deviceLabel: string | null;
};

type DeveloperOverview = {
  activated: boolean;
  emailVerified: boolean;
  profile?: DeveloperProfileInfo;
  keys?: ApiKeyInfo[];
  limit?: number;
  usage?: { today: DailyUsageInfo; last7Days: DailyUsageInfo[] };
  recentEvents?: DeveloperEventInfo[];
};

const API_USE_CASE_OPTIONS: [string, string][] = [
  ["chatbot", "Chatbot"],
  ["ai-assistant", "AI assistant / copilot"],
  ["website-integration", "Website integration"],
  ["mobile-app", "Mobile app"],
  ["automation", "Automation / workflow"],
  ["content-generation", "Content generation"],
  ["customer-support", "Customer support"],
  ["research", "Research / learning"],
  ["other", "Something else"],
];

const API_BUILDER_OPTIONS: [string, string][] = [
  ["individual", "Individual developer"],
  ["hobbyist", "Hobbyist"],
  ["student", "Student"],
  ["startup", "Startup"],
  ["company", "Company / team"],
  ["agency", "Agency / client work"],
];

const API_LANGUAGE_OPTIONS: [string, string][] = [
  ["javascript", "JavaScript / TypeScript"],
  ["python", "Python"],
  ["curl", "cURL / HTTP"],
  ["other", "Another language"],
];

function optionLabel(options: [string, string][], value: string): string {
  return options.find(([id]) => id === value)?.[1] ?? value;
}

function DeveloperTab({
  user,
  onToast,
}: {
  user: User;
  onToast: (message: string) => void;
}) {
  const [overview, setOverview] = useState<DeveloperOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://truthai-six.vercel.app/api/v1");

  // Activation popup state.
  const [activateOpen, setActivateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [useCase, setUseCase] = useState("chatbot");
  const [builderType, setBuilderType] = useState("individual");
  const [language, setLanguage] = useState("javascript");
  const [website, setWebsite] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");

  // Shown exactly once: after activation and after key creation.
  const [freshKey, setFreshKey] = useState<string | null>(null);

  // Key management state.
  const [newKeyName, setNewKeyName] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [revokeKeyTarget, setRevokeKeyTarget] = useState<ApiKeyInfo | null>(null);

  // Quickstart language tab (defaults to the activation answer).
  const [sampleTab, setSampleTab] = useState("javascript");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/api/v1`);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const response = await settingsApi(user, "/api/developer/overview", { method: "GET" });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Developer details couldn’t be loaded."));
      }
      const data = (await response.json()) as DeveloperOverview;
      setOverview(data);
      if (data.profile?.language) setSampleTab(data.profile.language);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Developer details couldn’t be loaded.");
    }
  }, [user]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(message);
    } catch {
      onToast("Copy failed — select the text and copy it manually.");
    }
  }

  async function activate() {
    setActivating(true);
    setActivateError("");
    try {
      const response = await settingsApi(user, "/api/developer/activate", {
        method: "POST",
        body: {
          projectName: projectName.trim(),
          useCase,
          builderType,
          language,
          website: website.trim(),
          termsAccepted,
        },
      });
      const data = (await response.json().catch(() => null)) as
        | { apiKey?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !data?.apiKey) {
        throw new Error(data?.error?.message ?? "Activation failed. Please try again.");
      }
      setFreshKey(data.apiKey);
      await loadOverview();
    } catch (error) {
      setActivateError(error instanceof Error ? error.message : "Activation failed. Please try again.");
    } finally {
      setActivating(false);
    }
  }

  async function createKey() {
    setKeyBusy(true);
    try {
      const response = await settingsApi(user, "/api/developer/keys", {
        method: "POST",
        body: { action: "create", name: newKeyName.trim() },
      });
      const data = (await response.json().catch(() => null)) as
        | { apiKey?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !data?.apiKey) {
        throw new Error(data?.error?.message ?? "The key couldn’t be created.");
      }
      setFreshKey(data.apiKey);
      setNewKeyName("");
      await loadOverview();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "The key couldn’t be created.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function revokeKey(target: ApiKeyInfo) {
    setKeyBusy(true);
    try {
      const response = await settingsApi(user, "/api/developer/keys", {
        method: "POST",
        body: { action: "revoke", keyId: target.keyId },
      });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "The key couldn’t be revoked."));
      }
      setRevokeKeyTarget(null);
      await loadOverview();
      onToast("API key revoked.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "The key couldn’t be revoked.");
    } finally {
      setKeyBusy(false);
    }
  }

  const samples: Record<string, string> = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openrouter/free",
    "messages": [
      {"role": "user", "content": "Hello from my app!"}
    ]
  }'`,
    javascript: `const response = await fetch("${baseUrl}/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Hello from my app!" }],
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);`,
    python: `import requests

response = requests.post(
    "${baseUrl}/chat/completions",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "openrouter/free",
        "messages": [{"role": "user", "content": "Hello from my app!"}],
    },
)
data = response.json()
print(data["choices"][0]["message"]["content"])`,
    other: `POST ${baseUrl}/chat/completions
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "openrouter/free",
  "messages": [{ "role": "user", "content": "Hello from my app!" }]
}`,
  };

  const limit = overview?.limit ?? 100_000;
  const today = overview?.usage?.today;
  const usedPercent = today ? Math.min(100, (today.totalTokens / limit) * 100) : 0;
  const activeKeys = (overview?.keys ?? []).filter((key) => !key.revoked);

  return (
    <section className="settings-panel" aria-labelledby="settings-developer-heading">
      <h2 id="settings-developer-heading">Developer</h2>
      <p>
        Build on Xyro AI with an OpenAI-compatible API, powered by the same free models
        as the app. Keys, usage and request logs are stored on your account and metered
        against the free plan.
      </p>

      {overview === null && !loadError && (
        <p className="settings-hint" role="status">Loading developer details…</p>
      )}
      {loadError && <div className="auth-alert" role="alert">{loadError}</div>}

      {overview !== null && !overview.activated && (
        <div className="settings-field">
          <span className="settings-label">API access</span>
          <p className="settings-hint">
            The free plan includes <strong>100,000 tokens per day</strong>, access to every
            free model, and a usage dashboard with per-request logs. Answer a few questions
            to activate — your first API key is issued right away.
          </p>
          {overview.emailVerified ? (
            <div className="settings-inline">
              <button type="button" className="button button-primary" onClick={() => setActivateOpen(true)}>
                Activate developer access
              </button>
            </div>
          ) : (
            <p className="settings-hint">
              Verify your email address first — developer access needs a verified account,
              the same rule as sending messages. Use the verification banner in your
              workspace, then come back here.
            </p>
          )}
        </div>
      )}

      {overview !== null && overview.activated && overview.profile && (
        <>
          <div className="settings-field">
            <span className="settings-label">
              Plan <span className="settings-badge settings-badge-ok">Free plan</span>
            </span>
            <p className="settings-hint">
              {overview.profile.projectName} · {optionLabel(API_USE_CASE_OPTIONS, overview.profile.useCase)}
              {" · "}Active since {formatDate(overview.profile.createdAt)}
            </p>
            {today && (
              <>
                <p className="dev-usage-total">
                  {today.totalTokens.toLocaleString("en-US")}
                  <span className="settings-hint"> of {limit.toLocaleString("en-US")} tokens used today</span>
                </p>
                <div
                  className="dev-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(usedPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Daily token usage"
                >
                  <span style={{ width: `${usedPercent}%` }} />
                </div>
                <p className="settings-hint">
                  {today.requests.toLocaleString("en-US")} requests ·{" "}
                  {today.promptTokens.toLocaleString("en-US")} prompt tokens ·{" "}
                  {today.completionTokens.toLocaleString("en-US")} completion tokens ·
                  resets at midnight UTC
                </p>
              </>
            )}
            {overview.usage && overview.usage.last7Days.length > 0 && (
              <ul className="settings-session-list">
                {[...overview.usage.last7Days].reverse().map((day) => (
                  <li key={day.date}>
                    <span className="settings-session-device">{day.date}</span>
                    <span className="settings-file-meta">
                      {day.totalTokens.toLocaleString("en-US")} tokens ·{" "}
                      {day.requests.toLocaleString("en-US")} requests
                    </span>
                    <span className="dev-day-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (day.totalTokens / limit) * 100)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="settings-field">
            <span className="settings-label">API keys</span>
            <p className="settings-hint">
              Keys are shown in full only once, when they are created. Only a hash of each
              key is stored, so a lost key can’t be recovered — revoke it and create a new one.
            </p>
            <ul className="settings-session-list">
              {(overview.keys ?? []).map((key) => (
                <li key={key.keyId}>
                  <span className="settings-session-device">
                    {key.name}
                    {key.revoked ? (
                      <span className="settings-badge">Revoked</span>
                    ) : (
                      <span className="settings-badge settings-badge-ok">Active</span>
                    )}
                  </span>
                  <span className="settings-file-meta">
                    <code>{key.displayPrefix}</code>
                    {" · "}Created {formatDate(key.createdAt)}
                    {" · "}{key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : "Never used"}
                  </span>
                  {!key.revoked && (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => setRevokeKeyTarget(key)}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="settings-inline">
              <input
                type="text"
                value={newKeyName}
                onChange={(event) => setNewKeyName(event.target.value)}
                placeholder="Key name (e.g. Production)"
                maxLength={60}
                aria-label="New key name"
              />
              <button
                type="button"
                className="button button-primary"
                disabled={keyBusy || activeKeys.length >= 5}
                onClick={() => void createKey()}
              >
                Create new key
              </button>
            </div>
            {activeKeys.length >= 5 && (
              <p className="settings-hint">You have the maximum of 5 active keys. Revoke one to create another.</p>
            )}
          </div>

          <div className="settings-field">
            <span className="settings-label">Quickstart</span>
            <p className="settings-hint">
              The API is OpenAI-compatible: send your key as a Bearer token and post
              messages. Replace <code>YOUR_API_KEY</code> with a key from above, and keep
              keys on your server — never ship them in browser or mobile code.
            </p>
            <p className="settings-hint">
              Base URL{" "}
              <button type="button" className="dev-copy-link" onClick={() => void copyText(baseUrl, "Base URL copied.")}>
                <code>{baseUrl}</code> ⧉
              </button>
            </p>
            <div className="settings-inline" role="tablist" aria-label="Code sample language">
              {API_LANGUAGE_OPTIONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sampleTab === id}
                  className={`button ${sampleTab === id ? "button-primary" : "button-outline"}`}
                  onClick={() => setSampleTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="chat-code-block">
              <div className="chat-code-header">
                <span>{optionLabel(API_LANGUAGE_OPTIONS, sampleTab)}</span>
                <button
                  type="button"
                  onClick={() => void copyText(samples[sampleTab] ?? "", "Code sample copied.")}
                >
                  Copy
                </button>
              </div>
              <pre><code>{samples[sampleTab]}</code></pre>
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-label">Endpoints and limits</span>
            <ul className="settings-session-list">
              <li>
                <span className="settings-session-device"><code>POST /chat/completions</code></span>
                <span className="settings-file-meta">
                  Body: model (optional, defaults to Auto free), messages (1–50 of role
                  system/user/assistant), max_tokens (1–4096). Returns an OpenAI-shaped
                  chat.completion with usage. Streaming is not supported yet.
                </span>
              </li>
              <li>
                <span className="settings-session-device"><code>GET /models</code></span>
                <span className="settings-file-meta">
                  Lists the free models your key can use right now.
                </span>
              </li>
              <li>
                <span className="settings-session-device">Free plan limits</span>
                <span className="settings-file-meta">
                  {limit.toLocaleString("en-US")} tokens per day (prompt + completion,
                  resets midnight UTC) · 20 requests per minute per key · up to 5 active
                  keys. Errors use the OpenAI shape: an error object with message, type
                  and code — daily_token_limit_exceeded means the daily cap is reached.
                </span>
              </li>
            </ul>
            <p className="settings-hint">
              Full terms: <a href="/api-terms" target="_blank" rel="noreferrer">API terms</a>
              {" · "}
              <a href="/acceptable-use" target="_blank" rel="noreferrer">Acceptable use</a>
              {" · "}
              <a href="/developers" target="_blank" rel="noreferrer">Developer page</a>
            </p>
          </div>

          <div className="settings-field">
            <span className="settings-label">Recent API activity</span>
            <p className="settings-hint">
              Every API call is logged with its request fingerprint — device, browser and
              a hashed IP — so you can spot keys being used from unexpected places.
            </p>
            {(overview.recentEvents ?? []).length === 0 && (
              <p className="settings-hint">No API calls yet. Make your first request with the quickstart above.</p>
            )}
            {(overview.recentEvents ?? []).length > 0 && (
              <ul className="settings-session-list">
                {(overview.recentEvents ?? []).map((event) => (
                  <li key={event.id}>
                    <span className="settings-session-device">
                      {event.model ?? event.endpoint}
                      {event.status === "success" && <span className="settings-badge settings-badge-ok">Success</span>}
                      {event.status === "error" && <span className="settings-badge settings-badge-warn">Error {event.httpStatus}</span>}
                      {event.status === "rejected" && <span className="settings-badge settings-badge-warn">Limit reached</span>}
                    </span>
                    <span className="settings-file-meta">
                      {event.totalTokens.toLocaleString("en-US")} tokens
                      {" · "}{event.deviceLabel ?? "Unknown device"}
                      {" · "}{formatDate(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {activateOpen && (
        <div className="signout-overlay">
          <div className="signout-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-activate-heading">
            {freshKey ? (
              <>
                <h3 id="dev-activate-heading">Developer access is active</h3>
                <p>
                  Here is your first API key. Copy it now and store it somewhere safe —
                  it is shown only once and can’t be recovered later.
                </p>
                <div className="chat-code-block">
                  <pre><code>{freshKey}</code></pre>
                </div>
                <div className="signout-dialog-actions">
                  <button type="button" className="button button-outline" onClick={() => void copyText(freshKey, "API key copied.")}>
                    Copy key
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => {
                      setFreshKey(null);
                      setActivateOpen(false);
                    }}
                  >
                    Done — show my dashboard
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 id="dev-activate-heading">Activate developer access</h3>
                <p>Tell us a little about your project. Your answers are saved to your account and help us keep the free API sustainable.</p>
                <div className="dev-form">
                  <label className="settings-label" htmlFor="dev-project-name">Project name</label>
                  <input
                    id="dev-project-name"
                    type="text"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="e.g. My support chatbot"
                    maxLength={60}
                  />
                  <label className="settings-label" htmlFor="dev-use-case">What are you building?</label>
                  <select id="dev-use-case" value={useCase} onChange={(event) => setUseCase(event.target.value)}>
                    {API_USE_CASE_OPTIONS.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <label className="settings-label" htmlFor="dev-builder-type">What best describes you?</label>
                  <select id="dev-builder-type" value={builderType} onChange={(event) => setBuilderType(event.target.value)}>
                    {API_BUILDER_OPTIONS.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <label className="settings-label" htmlFor="dev-language">Primary language</label>
                  <select id="dev-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                    {API_LANGUAGE_OPTIONS.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <label className="settings-label" htmlFor="dev-website">Website or repository (optional)</label>
                  <input
                    id="dev-website"
                    type="text"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                    placeholder="https://…"
                    maxLength={200}
                  />
                  <label className="dev-terms">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                    />
                    <span>
                      I agree to the{" "}
                      <a href="/api-terms" target="_blank" rel="noreferrer">API terms</a>
                      {" "}and{" "}
                      <a href="/acceptable-use" target="_blank" rel="noreferrer">acceptable use policy</a>.
                    </span>
                  </label>
                </div>
                {activateError && <div className="auth-alert" role="alert">{activateError}</div>}
                <div className="signout-dialog-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setActivateOpen(false)}
                    disabled={activating}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => void activate()}
                    disabled={activating || projectName.trim().length < 2 || !termsAccepted}
                  >
                    {activating ? "Activating…" : "Activate and get my key"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {freshKey && !activateOpen && (
        <div className="signout-overlay">
          <div className="signout-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-key-heading">
            <h3 id="dev-key-heading">Your new API key</h3>
            <p>Copy it now and store it somewhere safe — it is shown only once.</p>
            <div className="chat-code-block">
              <pre><code>{freshKey}</code></pre>
            </div>
            <div className="signout-dialog-actions">
              <button type="button" className="button button-outline" onClick={() => void copyText(freshKey, "API key copied.")}>
                Copy key
              </button>
              <button type="button" className="button button-primary" onClick={() => setFreshKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeKeyTarget && (
        <div className="signout-overlay">
          <div className="signout-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-revoke-heading">
            <h3 id="dev-revoke-heading">Revoke this API key?</h3>
            <p>
              <strong>{revokeKeyTarget.name}</strong> (<code>{revokeKeyTarget.displayPrefix}</code>) will stop
              working immediately. Anything still using it will start receiving
              authentication errors.
            </p>
            <div className="signout-dialog-actions">
              <button type="button" className="button button-outline" onClick={() => setRevokeKeyTarget(null)} disabled={keyBusy}>
                Keep key
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => void revokeKey(revokeKeyTarget)}
                disabled={keyBusy}
              >
                {keyBusy ? "Revoking…" : "Revoke key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- Usage ------------------------------- */

type UsageData = {
  available: boolean;
  messages: { today: number; dayLimit: number; thisMinute: number; minuteLimit: number };
  uploads: { today: number; dayLimit: number; thisMinute: number; minuteLimit: number };
  resetAt: number | null;
};

function UsageTab({ user }: { user: User }) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void settingsApi(user, "/api/usage", { method: "GET" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Usage couldn’t be loaded."));
        }
        const data = (await response.json()) as UsageData;
        if (active) setUsage(data);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Usage couldn’t be loaded.");
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <section className="settings-content" aria-labelledby="settings-usage-heading">
      <h2 id="settings-usage-heading">Usage</h2>
      <p>Today’s activity against the free-plan limits.</p>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {usage === null && !error && (
        <div aria-busy="true">
          <div className="settings-skeleton" />
          <div className="settings-skeleton" />
          <span className="settings-visually-hidden" role="status">Loading usage…</span>
        </div>
      )}
      {usage && !usage.available && (
        <p className="settings-hint" role="status">
          Live counters aren’t available on this deployment, so today’s counts can’t be shown.
          The limits below still apply.
        </p>
      )}
      {usage && (
        <>
          <div className="settings-usage-row">
            <span className="settings-label">Messages today</span>
            <span className="settings-value">
              {usage.available ? `${usage.messages.today} / ${usage.messages.dayLimit}` : `Limit ${usage.messages.dayLimit} / day`}
            </span>
            <span className="settings-hint">Also limited to {usage.messages.minuteLimit} per minute.</span>
          </div>
          <div className="settings-usage-row">
            <span className="settings-label">Uploads today</span>
            <span className="settings-value">
              {usage.available ? `${usage.uploads.today} / ${usage.uploads.dayLimit}` : `Limit ${usage.uploads.dayLimit} / day`}
            </span>
            <span className="settings-hint">Also limited to {usage.uploads.minuteLimit} per minute.</span>
          </div>
          <p className="settings-hint">
            {usage.resetAt
              ? `Today’s counters reset around ${formatDate(usage.resetAt)}.`
              : "Counters reset 24 hours after the first message or upload of the day."}
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------ Account ------------------------------ */

function AccountTab({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const router = useRouter();

  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      let continuation = false;
      for (let round = 0; round < 200; round += 1) {
        const response = await settingsApi(user, "/api/account/delete", {
          method: "POST",
          body: {
            confirmation: "DELETE",
            password: deletePassword || undefined,
            continuation,
          },
        });
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, "Account deletion couldn’t continue."));
        }
        const data = (await response.json()) as { done?: boolean };
        if (data.done) {
          // The server cleared the session cookie and deleted the Auth
          // user; sign the local client out and go home.
          try {
            const auth = tryGetFirebaseAuth();
            if (auth) await auth.signOut();
          } catch {
            // The account is gone server-side either way.
          }
          router.replace("/");
          return;
        }
        continuation = true;
        if (round === 199) throw new Error("Deletion is taking longer than expected. Run it again to continue.");
      }
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? `${error.message} Nothing further was deleted; you can try again to continue.`
          : "Account deletion couldn’t continue.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="settings-content" aria-labelledby="settings-account-heading">
      <h2 id="settings-account-heading">Account</h2>
      <p>About this app, signing out, and closing your account.</p>

      <div className="settings-field">
        <span className="settings-label">About</span>
        <p className="settings-value">Xyro AI, version {APP_VERSION}</p>
        <p className="settings-hint">
          <Link className="text-link" href="/terms">Terms</Link>
          {" · "}
          <Link className="text-link" href="/privacy">Privacy</Link>
        </p>
      </div>

      <div className="settings-field">
        <span className="settings-label">Sign out</span>
        <p className="settings-hint">You’ll need to sign in again to open your chats.</p>
        <button type="button" className="button button-outline" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="settings-field settings-danger-zone">
        <span className="settings-label">Delete account</span>
        <p className="settings-hint">
          Permanently deletes your profile, settings, chats, messages, uploaded files and
          sign-in. This can’t be undone.
        </p>
        <button type="button" className="button button-danger" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </button>
        {deleteError && <p className="settings-error" role="alert">{deleteError}</p>}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account?"
        body="Your profile, settings, chats, messages and files will be permanently deleted, and your sign-in will be removed. Type DELETE and enter your password (if you have one) to confirm."
        confirmLabel="Delete account"
        busy={deleteBusy}
        busyLabel="Deleting…"
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteText("");
          setDeletePassword("");
        }}
        onConfirm={() => {
          if (deleteText === "DELETE") void deleteAccount();
        }}
      >
        <label className="settings-label" htmlFor="delete-account-text">Type DELETE</label>
        <input
          id="delete-account-text"
          type="text"
          value={deleteText}
          onChange={(event) => setDeleteText(event.target.value)}
          autoComplete="off"
          placeholder="DELETE"
        />
        <label className="settings-label" htmlFor="delete-account-password">Password (email accounts)</label>
        <input
          id="delete-account-password"
          type="password"
          value={deletePassword}
          onChange={(event) => setDeletePassword(event.target.value)}
          autoComplete="current-password"
          placeholder="Leave blank for Google accounts"
        />
      </ConfirmDialog>
    </section>
  );
}
