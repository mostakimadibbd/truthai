"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  reload,
  type User,
} from "firebase/auth";
import { onValue, ref } from "firebase/database";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";

// Phase 8 (performance): the markdown stack (react-markdown +
// remark-gfm + rehype-sanitize, ~48 kB gzip) is only needed once a
// message renders, so it is split out of the chat page's first load.
// The workspace warms the chunk on mount (below) while auth and
// history load, so in practice it is ready before the first message;
// the empty fallback only covers a genuinely cold first render.
const ChatMarkdown = dynamic(() => import("@/components/chat-markdown"), {
  ssr: false,
  loading: () => <div className="chat-markdown" aria-hidden="true" />,
});
import FirebasePresence from "@/components/firebase-presence";
import SignOutDialog, { type SignOutVariant } from "@/components/sign-out-dialog";
import { performSignOut } from "@/lib/firebase/sign-out";
import { sortByConversationOrder } from "@/lib/message-order";
import { usePreferences } from "@/lib/preferences-client";
import { useTypewriter } from "@/lib/typewriter";
import { isFirebaseConfigured, tryGetFirebaseAuth } from "@/lib/firebase/auth-client";
import { getFirebaseFirestore } from "@/lib/firebase/firestore-client";
import { getFirebaseRealtimeDatabase } from "@/lib/firebase/database-client";

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  accessUrl?: string;
  uploading?: boolean;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments: Attachment[];
  status?: "generating" | "complete" | "failed" | "stopped";
  /** Web sources the reply drew on (set server-side on web turns). */
  sources?: { title: string; url: string }[];
};

type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  searchText?: string;
  lastMessagePreview?: string;
  persisted?: boolean;
  pinned?: boolean;
};

type AuthState = "loading" | "not-configured" | "signed-out" | "unverified" | "ready";

type UploadSignature = {
  assetId: string;
  cloudName: string;
  apiKey: string;
  uploadPreset: string;
  signature: string;
  timestamp: number;
  publicId: string;
  resourceType: "image" | "raw";
  deliveryType: "authenticated";
};

const HISTORY_LIMIT = 20;
const MESSAGE_LIMIT = 30;
const MESSAGE_MAX_LENGTH = 12_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_BYTES_PER_MESSAGE = 20 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 5;
const ACCEPTED_FILE_TYPES = ".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.csv";
const IMAGE_FILE_TYPES = ".jpg,.jpeg,.png,.webp,.gif";
const AUTO_MODEL_OPTION = { id: "openrouter/free", name: "Auto (Free)" };

type ModelOption = { id: string; name: string };

type StreamTarget = {
  chatId: string;
  responseId: string;
  messageId: string;
  startedAt: number;
};

function toMillis(value: unknown, fallback = Date.now()): number {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function getApiError(response: Response, fallback: string): Promise<string> {
  const result: unknown = await response.json().catch(() => null);
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  ) {
    return result.error.message;
  }
  return fallback;
}

function isUploadSignature(value: unknown): value is UploadSignature {
  if (typeof value !== "object" || value === null) return false;
  return (
    "assetId" in value &&
    typeof value.assetId === "string" &&
    "cloudName" in value &&
    typeof value.cloudName === "string" &&
    "apiKey" in value &&
    typeof value.apiKey === "string" &&
    "uploadPreset" in value &&
    typeof value.uploadPreset === "string" &&
    "signature" in value &&
    typeof value.signature === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "number" &&
    "publicId" in value &&
    typeof value.publicId === "string" &&
    "resourceType" in value &&
    (value.resourceType === "image" || value.resourceType === "raw") &&
    "deliveryType" in value &&
    value.deliveryType === "authenticated"
  );
}

function isAttachment(value: unknown): value is Attachment & { accessUrl: string } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "mimeType" in value &&
    typeof value.mimeType === "string" &&
    "size" in value &&
    typeof value.size === "number" &&
    "accessUrl" in value &&
    typeof value.accessUrl === "string"
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isChat(value: unknown): value is Chat {
  if (typeof value !== "object" || value === null) return false;
  const chat = value as Partial<Chat>;
  return (
    typeof chat.id === "string" &&
    typeof chat.title === "string" &&
    typeof chat.updatedAt === "number" &&
    Array.isArray(chat.messages) &&
    chat.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        typeof message.createdAt === "number",
    )
  );
}

function getHistoryKey(uid: string) {
  return `xyro-ai:chat-history:v1:${uid}`;
}

function newChat(): Chat {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    updatedAt: Date.now(),
    messages: [],
    searchText: "",
    persisted: false,
  };
}

function newMessage(role: Message["role"], content = ""): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), attachments: [] };
}

function getChatGroup(timestamp: number): string {
  const age = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (age < day && new Date(timestamp).getDate() === new Date().getDate()) return "Today";
  if (age < day * 7) return "Previous 7 days";
  return "Older";
}

function Icon({
  name,
  size = 18,
}: {
  name:
    | "menu"
    | "plus"
    | "search"
    | "send"
    | "stop"
    | "copy"
    | "trash"
    | "close"
    | "spark"
    | "edit"
    | "download"
    | "attach"
    | "dots"
    | "image"
    | "globe"
    | "mic"
    | "file";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
    send: <><path d="m21 3-7.5 18-3.8-7.7L2 9.5 21 3Z" /><path d="M9.7 13.3 14 9" /></>,
    stop: <><rect x="5" y="5" width="14" height="14" rx="3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    edit: <><path d="m14 5 5 5M4 20l4.3-.9L19 8.4 15.6 5 4.9 15.7 4 20Z" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" /></>,
    attach: <><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></>,
    dots: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
    image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17 5-4 4 3 3-2 4 3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    file: <><path d="M6 2.8h8L19 8v13.2H6z" /><path d="M13.5 3v5.5H19" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * Assistant text with the Phase 3 typewriter: live chunks from
 * Realtime Database are buffered and drained at the user's typing
 * speed; clicking the text skips to the full reply. Completed messages
 * render instantly (active=false snaps to the full text). The drained
 * text is rendered as sanitized markdown (Phase 5).
 */
function TypewriterText({
  text,
  speed,
  active,
}: {
  text: string;
  speed: Parameters<typeof useTypewriter>[1];
  active: boolean;
}) {
  const { displayed, skip } = useTypewriter(text, speed, active);
  return (
    <div onClick={skip} title={active ? "Click to show the full reply" : undefined}>
      <ChatMarkdown text={displayed} />
    </div>
  );
}

export default function ChatWorkspace() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<User | null>(null);
  // Settings preferences (Phase 3): typing speed, send key, empty-chat
  // suggestions and the default model all read from the same live
  // Firestore-backed hook the settings pages write through /api/settings.
  const { preferences, loaded: preferencesLoaded } = usePreferences(user);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [webSearchOn, setWebSearchOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("xyro:websearch") === "1";
    } catch {
      return false;
    }
  });
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const [notice, setNotice] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [signOutVariant, setSignOutVariant] = useState<SignOutVariant | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  // Model picker (Phase 5): the live free-model list from /api/models
  // and the user's current selection. The selection starts from the
  // stored per-device choice, then the default-model preference, and
  // is sent with every /api/chat request (the server re-validates it
  // against the free list and falls back to the preference/Auto).
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([AUTO_MODEL_OPTION]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Image creation (Phase 7): when create mode is on, the composer
  // describes a picture instead of sending a chat message. Submitting
  // posts to /api/images/generate; the server checks the live
  // catalogue for a free image model and says so plainly when none
  // is available. Created pictures arrive as a normal assistant
  // message (with the image attached) through the Firestore listener.
  const [createMode, setCreateMode] = useState(false);
  const [creatingImage, setCreatingImage] = useState(false);
  const [fileAccept, setFileAccept] = useState(ACCEPTED_FILE_TYPES);
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // Streaming target (Phase 5): non-null only while a response is in
  // flight. The Realtime Database listener exists only while this is
  // set, and it accepts chunks for exactly this responseId/messageId.
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);
  const streamSeqRef = useRef(0);
  const lastChunkAtRef = useRef(0);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const attachmentUrlLoadingRef = useRef(new Set<string>());
  const previousUserIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const previousChatIdRef = useRef<string | null>(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const activeMessages = activeChat?.messages ?? [];
  const attachmentPreviewKey = activeMessages
    .flatMap((message) => message.attachments.map((attachment) => attachment.id))
    .join(",");
  const updateChat = useCallback((chatId: string, update: (chat: Chat) => Chat) => {
    setChats((previous) =>
      previous.map((chat) => (chat.id === chatId ? update(chat) : chat))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, HISTORY_LIMIT),
    );
  }, []);

  // Warm the lazily loaded markdown chunk while auth/history load,
  // so the first rendered message does not wait on it (Phase 8).
  useEffect(() => {
    void import("@/components/chat-markdown");
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthState("not-configured");
      return;
    }

    const auth = tryGetFirebaseAuth();
    if (!auth) {
      setAuthState("not-configured");
      return;
    }

    return onAuthStateChanged(auth, (currentUser) => {
      if (previousUserIdRef.current !== (currentUser?.uid ?? null)) {
        setPendingAttachments([]);
        setAttachmentUrls({});
        previousUserIdRef.current = currentUser?.uid ?? null;
      }
      if (!currentUser) {
        setUser(null);
        setHistoryLoaded(false);
        setChats([]);
        setActiveChatId(null);
        setAuthState("signed-out");
        router.replace("/sign-in");
        return;
      }

      setHistoryLoaded(false);
      setChats([]);
      setActiveChatId(null);
      setUser(currentUser);
      if (!currentUser.emailVerified) {
        setAuthState("unverified");
        return;
      }

      setAuthState("ready");
    });
  }, [router]);

  useEffect(() => {
    if (!user || (authState !== "ready" && authState !== "unverified")) return;
    const currentUser = user;
    let active = true;
    let unsubscribeChats: (() => void) | undefined;

    async function loadChats() {
      try {
        const historyKey = getHistoryKey(currentUser.uid);
        const saved = localStorage.getItem(historyKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (!Array.isArray(parsed)) {
            throw new Error("Your saved chat history has an unexpected format.");
          }
          const legacyChats = parsed.filter(isChat);
          if (legacyChats.length !== parsed.length) {
            throw new Error("Some saved chats couldn’t be read, so the browser copy was kept.");
          }
          if (legacyChats.length) {
            const idToken = await currentUser.getIdToken();
            const response = await fetch("/api/chats/migrate", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${idToken}`,
                "Content-Type": "application/json",
                "X-Requested-With": "xyro",
              },
              body: JSON.stringify({ chats: legacyChats }),
            });
            if (!response.ok) {
              throw new Error(await getApiError(response, "Your saved chat history couldn’t be synced."));
            }
          }
          localStorage.removeItem(historyKey);
        }
      } catch (error) {
        console.error("Couldn’t migrate this browser’s chat history.", error);
        if (active) {
          setNotice(
            error instanceof Error
              ? `${error.message} Your browser copy is still available.`
              : "Your chat history couldn’t be synced. Your browser copy is still available.",
          );
        }
      }

      if (!active) return;
      try {
        const chatsQuery = query(
          collection(getFirebaseFirestore(), "users", currentUser.uid, "chats"),
          orderBy("updatedAt", "desc"),
          limit(HISTORY_LIMIT),
        );
        unsubscribeChats = onSnapshot(
          chatsQuery,
          (snapshot) => {
            const loadedChats = snapshot.docs.map((chatDocument) => {
              const data = chatDocument.data();
              return {
                id: chatDocument.id,
                title: typeof data.title === "string" ? data.title : "New chat",
                updatedAt: toMillis(data.updatedAt),
                messages: [],
                searchText: typeof data.searchText === "string" ? data.searchText : "",
                lastMessagePreview:
                  typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : "",
                persisted: true,
                pinned: data.pinned === true,
              };
            });
            setChats((previous) => {
              const previousById = new Map(previous.map((chat) => [chat.id, chat]));
              return loadedChats.map((chat) => ({
                ...chat,
                messages: previousById.get(chat.id)?.messages ?? [],
              }));
            });
            // Land on a NEW chat, always (the ChatGPT/Gemini
            // behaviour the owner asked for): a selection only
            // survives while it still exists — a fresh load, a
            // login, or a deleted active chat all fall back to the
            // empty new-chat state, never to the latest old chat.
            setActiveChatId((current) =>
              current && loadedChats.some((chat) => chat.id === current)
                ? current
                : null,
            );
            setHistoryLoaded(true);
          },
          (error) => {
            console.error("Firestore chat history listener failed.", error);
            setNotice("Cloud chat history couldn’t be loaded. Check your connection and try again.");
            setHistoryLoaded(true);
          },
        );
      } catch (error) {
        console.error("Couldn’t initialize Firestore chat history.", error);
        setNotice("Cloud chat history couldn’t be loaded. Check your Firebase setup.");
        setHistoryLoaded(true);
      }
    }

    void loadChats();
    return () => {
      active = false;
      unsubscribeChats?.();
    };
  }, [authState, user]);

  useEffect(() => {
    if (!user || !activeChatId || (authState !== "ready" && authState !== "unverified")) return;
    let unsubscribeMessages: (() => void) | undefined;
    try {
      const messagesQuery = query(
        collection(getFirebaseFirestore(), "users", user.uid, "chats", activeChatId, "messages"),
        orderBy("createdAt", "asc"),
        limit(MESSAGE_LIMIT),
      );
      unsubscribeMessages = onSnapshot(
        messagesQuery,
        (snapshot) => {
          const messages = snapshot.docs.map((messageDocument) => {
            const data = messageDocument.data();
            return {
              id: messageDocument.id,
              role: data.role === "assistant" ? "assistant" as const : "user" as const,
              content: typeof data.content === "string" ? data.content : "",
              createdAt: toMillis(data.createdAt),
              attachments: Array.isArray(data.attachments)
                ? data.attachments.flatMap((item: unknown) =>
                    typeof item === "object" &&
                    item !== null &&
                    "id" in item &&
                    typeof item.id === "string" &&
                    "name" in item &&
                    typeof item.name === "string" &&
                    "mimeType" in item &&
                    typeof item.mimeType === "string" &&
                    "size" in item &&
                    typeof item.size === "number"
                      ? [{
                          id: item.id,
                          name: item.name,
                          mimeType: item.mimeType,
                          size: item.size,
                        }]
                      : [],
                  )
                : [],
              status:
                data.status === "generating" ||
                data.status === "failed" ||
                data.status === "stopped"
                  ? data.status
                  : "complete",
              sources: Array.isArray(data.sources)
                ? data.sources.flatMap((item: unknown) =>
                    typeof item === "object" &&
                    item !== null &&
                    "title" in item &&
                    typeof item.title === "string" &&
                    "url" in item &&
                    typeof item.url === "string" &&
                    /^https?:\/\//.test(item.url)
                      ? [{ title: item.title, url: item.url }]
                      : [],
                  )
                : undefined,
            };
          });
          updateChat(activeChatId, (chat) => ({
            ...chat,
            // Firestore breaks createdAt ties by document id, which
            // scrambled question/answer pairs on screen; re-apply
            // the deterministic conversation order.
            messages: sortByConversationOrder(
              messages,
              (message) => message.createdAt,
              (message) => message.role,
            ),
          }));
        },
        (error) => {
          console.error("Firestore chat message listener failed.", error);
          setNotice("Messages couldn’t be loaded. Check your connection and try again.");
        },
      );
    } catch (error) {
      console.error("Couldn’t initialize the Firestore message listener.", error);
      setNotice("Messages couldn’t be loaded. Check your Firebase setup.");
    }
    return () => unsubscribeMessages?.();
  }, [activeChatId, authState, updateChat, user]);

  useEffect(() => {
    if (!activeChatId || !pendingAttachments.length) return;
    const attachedIds = new Set(
      activeMessages.flatMap((message) =>
        message.attachments.map((attachment) => attachment.id),
      ),
    );
    if (!attachedIds.size) return;
    setPendingAttachments((previous) =>
      previous.filter((attachment) => !attachedIds.has(attachment.id)),
    );
  }, [activeChatId, activeMessages, pendingAttachments.length]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    for (const attachment of activeMessages.flatMap((message) => message.attachments)) {
      if (attachment.accessUrl || attachmentUrlLoadingRef.current.has(attachment.id)) continue;
      attachmentUrlLoadingRef.current.add(attachment.id);
      void (async () => {
        try {
          const idToken = await user.getIdToken();
          const response = await fetch(
            `/api/uploads/access?assetId=${encodeURIComponent(attachment.id)}`,
            { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" },
          );
          if (!response.ok) {
            throw new Error(await getApiError(response, "This attachment is temporarily unavailable."));
          }
          const result: unknown = await response.json();
          if (
            typeof result !== "object" ||
            result === null ||
            !("accessUrl" in result) ||
            typeof result.accessUrl !== "string"
          ) {
            throw new Error("This attachment is temporarily unavailable.");
          }
          const accessUrl = result.accessUrl;
          if (active) {
            setAttachmentUrls((previous) => ({
              ...previous,
              [attachment.id]: accessUrl,
            }));
          }
        } catch (error) {
          if (active) {
            console.error("Couldn’t load a private chat attachment.", error);
            setNotice("An attachment preview couldn’t be loaded. Try again shortly.");
          }
        } finally {
          attachmentUrlLoadingRef.current.delete(attachment.id);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [activeChatId, attachmentPreviewKey, user]);

  // Model list for the top-bar picker (Phase 5). Fetched once per
  // signed-in user from /api/models (session + ID token; the server
  // serves only free OpenRouter models). On any failure the picker
  // keeps just Auto (Free), which the server always accepts.
  useEffect(() => {
    if (!user) {
      setAvailableModels([AUTO_MODEL_OPTION]);
      setSelectedModel(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/models", {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (
          active &&
          typeof result === "object" &&
          result !== null &&
          "models" in result &&
          Array.isArray(result.models)
        ) {
          const models = result.models.flatMap((item: unknown) =>
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            typeof item.id === "string" &&
            "name" in item &&
            typeof item.name === "string"
              ? [{ id: item.id, name: item.name }]
              : [],
          );
          if (models.length) setAvailableModels(models);
        }
      } catch (error) {
        console.error("Couldn’t load the free model list.", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Initial model selection: the per-device stored choice wins, then
  // the default-model preference once it has loaded.
  useEffect(() => {
    if (!user || selectedModel !== null) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`xyro:model:${user.uid}`);
    } catch {
      stored = null;
    }
    if (stored) {
      setSelectedModel(stored);
    } else if (preferencesLoaded) {
      setSelectedModel(preferences.defaultModel);
    }
  }, [preferences.defaultModel, preferencesLoaded, selectedModel, user]);

  function handleModelChange(modelId: string) {
    setSelectedModel(modelId);
    if (user) {
      try {
        localStorage.setItem(`xyro:model:${user.uid}`, modelId);
      } catch {
        // Storage can be unavailable (private mode); the in-memory
        // selection still applies for this session.
      }
    }
  }

  // Realtime Database streaming (Phase 5 hardening). The listener is
  // attached ONLY while a response is in flight (streamTarget set by
  // sendMessage, cleared when the request settles) to respect the
  // Realtime Database connection quota, and it detaches on completion,
  // error and unmount via the onValue unsubscribe.
  //
  // A chunk is rendered only when ALL of these hold:
  //   - its responseId equals the in-flight request's responseId and
  //     its messageId equals the in-flight assistant message (chunks
  //     from a previous response in the same chat are ignored);
  //   - its seq is strictly greater than the last applied seq, so
  //     duplicated or out-of-order deliveries never rewind the text
  //     (nodes written before seq existed are accepted once);
  //   - its updatedAt is not stale: not older than this request's
  //     start (a leftover node from an earlier response) and not
  //     older than five minutes in absolute terms.
  useEffect(() => {
    if (!user || !streamTarget) return;
    if (streamTarget.chatId !== activeChatId) return;
    let unsubscribe: (() => void) | undefined;
    try {
      const streamRef = ref(
        getFirebaseRealtimeDatabase(),
        `chatStreams/${user.uid}/${streamTarget.chatId}`,
      );
      unsubscribe = onValue(
        streamRef,
        (snapshot) => {
          const stream = snapshot.val();
          if (typeof stream !== "object" || stream === null) return;
          if (stream.responseId !== streamTarget.responseId) return;
          if (stream.messageId !== streamTarget.messageId) return;
          if (stream.status !== "generating") return;
          if (typeof stream.text !== "string") return;
          if (typeof stream.updatedAt === "number") {
            if (stream.updatedAt < streamTarget.startedAt - 5_000) return;
            if (Date.now() - stream.updatedAt > 5 * 60 * 1000) return;
          }
          if (typeof stream.seq === "number") {
            if (stream.seq <= streamSeqRef.current) return;
            streamSeqRef.current = stream.seq;
          }
          lastChunkAtRef.current = Date.now();
          const text = stream.text;
          updateChat(streamTarget.chatId, (chat) => ({
            ...chat,
            messages: chat.messages.map((message) =>
              message.id === streamTarget.messageId
                ? { ...message, content: text, status: "generating" }
                : message,
            ),
          }));
        },
        (error) => {
          console.error("Realtime Database response listener failed.", error);
          setNotice("Live response updates are temporarily unavailable.");
        },
      );
    } catch (error) {
      console.error("Couldn’t initialize the Realtime Database response listener.", error);
      setNotice("Live response updates are unavailable. Check your Firebase setup.");
    }
    return () => unsubscribe?.();
  }, [activeChatId, streamTarget, updateChat, user]);

  // Firestore fallback for a stalled stream (Phase 5): while a
  // response is in flight, if no Realtime Database chunk has arrived
  // for 30 seconds, read the assistant message document directly from
  // Firestore and render whatever the server has saved so far instead
  // of leaving the UI hanging. (The Firestore messages listener above
  // is the second safety net and delivers the final state on its own.)
  useEffect(() => {
    if (!user || !streamTarget) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastChunkAtRef.current < 30_000) return;
      void (async () => {
        try {
          const snapshot = await getDoc(
            doc(
              getFirebaseFirestore(),
              "users",
              user.uid,
              "chats",
              streamTarget.chatId,
              "messages",
              streamTarget.messageId,
            ),
          );
          if (!snapshot.exists()) return;
          const data = snapshot.data();
          if (typeof data.content !== "string" || !data.content) return;
          const status =
            data.status === "complete" ||
            data.status === "failed" ||
            data.status === "stopped"
              ? data.status
              : undefined;
          lastChunkAtRef.current = Date.now();
          updateChat(streamTarget.chatId, (chat) => ({
            ...chat,
            messages: chat.messages.map((message) =>
              message.id === streamTarget.messageId
                ? {
                    ...message,
                    content: data.content as string,
                    ...(status ? { status } : {}),
                  }
                : message,
            ),
          }));
        } catch (error) {
          console.error("Couldn’t load the Firestore fallback response.", error);
        }
      })();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [streamTarget, updateChat, user]);

  // Close the composer attach menu / sidebar chat menu on any click
  // outside them (Phase 5).
  useEffect(() => {
    if (!attachMenuOpen && !menuChatId) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target?.closest(".chat-attach-wrap, .chat-history-menu-wrap")) {
        setAttachMenuOpen(false);
        setMenuChatId(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [attachMenuOpen, menuChatId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [draft]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (modifierPressed && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (modifierPressed && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        startNewChat();
      } else if (event.key === "Escape") {
        if (sending) controllerRef.current?.abort();
        else setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [sending]);

  const visibleChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    return chats.filter(
      (chat) =>
        !query ||
        chat.title.toLowerCase().includes(query) ||
          chat.searchText?.toLowerCase().includes(query) ||
          chat.lastMessagePreview?.toLowerCase().includes(query) ||
        chat.messages.some((message) => message.content.toLowerCase().includes(query)),
    );
  }, [chats, search]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;

    const chatChanged = previousChatIdRef.current !== activeChatId;
    previousChatIdRef.current = activeChatId;
    const distanceFromBottom =
      conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight;
    if (chatChanged || distanceFromBottom < 140) {
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: chatChanged ? "smooth" : "auto",
      });
    }
  }, [activeChatId, activeMessages.at(-1)?.content, activeMessages.length]);

  async function ensurePersistedChat(chat: Chat): Promise<Chat> {
    if (chat.persisted) return chat;
    if (!user) throw new Error("Sign in again before creating a conversation.");
    const idToken = await user.getIdToken();
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "xyro",
      },
      body: JSON.stringify({ chatId: chat.id }),
    });
    if (!response.ok) {
      throw new Error(await getApiError(response, "The conversation couldn’t be saved."));
    }
    const persistedChat = { ...chat, persisted: true };
    setChats((previous) =>
      previous.map((item) => item.id === chat.id ? persistedChat : item),
    );
    return persistedChat;
  }

  function startNewChat() {
    if (sending || uploadingFiles || pendingAttachments.length) {
      setNotice("Send or remove the current attachments before starting another chat.");
      return;
    }
    const chat = newChat();
    setChats((previous) => [chat, ...previous].slice(0, HISTORY_LIMIT));
    setActiveChatId(chat.id);
    setDraft("");
    setNotice("");
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectChat(chatId: string) {
    if (pendingAttachments.length || uploadingFiles) {
      setNotice("Send or remove the current attachments before switching chats.");
      return;
    }
    if (sending) controllerRef.current?.abort();
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setMenuChatId(null);
    setNotice("");
  }

  async function deleteChat(chatId: string) {
    if (!user) return;
    if (activeChatId === chatId && sending) {
      setNotice("Stop the active response before deleting this chat.");
      return;
    }
    if (activeChatId === chatId && (pendingAttachments.length || uploadingFiles)) {
      setNotice("Send or remove the current attachments before deleting this chat.");
      return;
    }
    try {
      const chat = chats.find((item) => item.id === chatId);
      if (chat?.persisted) {
        const idToken = await user.getIdToken();
        const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "X-Requested-With": "xyro",
          },
        });
        if (!response.ok) {
          throw new Error(await getApiError(response, "This conversation couldn’t be deleted."));
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This conversation couldn’t be deleted.");
      return;
    }
    setChats((previous) => previous.filter((chat) => chat.id !== chatId));
    if (editingChatId === chatId) setEditingChatId(null);
    if (activeChatId === chatId) {
      // Deleting the open conversation returns to a new chat.
      setActiveChatId(null);
    }
  }

  function beginRenameChat(chat: Chat) {
    setEditingChatId(chat.id);
    setRenameDraft(chat.title);
  }

  async function saveChatRename(chatId: string) {
    const title = renameDraft.trim().slice(0, 60);
    setEditingChatId(null);
    setRenameDraft("");
    if (!title || !user) return;
    const previousTitle = chats.find((chat) => chat.id === chatId)?.title ?? "New chat";
    updateChat(chatId, (chat) => ({ ...chat, title }));
    try {
      const chat = chats.find((item) => item.id === chatId);
      if (!chat) return;
      await ensurePersistedChat(chat);
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "xyro",
        },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        throw new Error(await getApiError(response, "The conversation name couldn’t be saved."));
      }
      updateChat(chatId, (current) => ({ ...current, persisted: true, title }));
    } catch (error) {
      updateChat(chatId, (chat) => ({ ...chat, title: previousTitle }));
      setNotice(error instanceof Error ? error.message : "The conversation name couldn’t be saved.");
    }
  }

  async function togglePinChat(chat: Chat) {
    if (!user) return;
    const pinned = !chat.pinned;
    updateChat(chat.id, (current) => ({ ...current, pinned }));
    try {
      await ensurePersistedChat(chat);
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/chats/${encodeURIComponent(chat.id)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "xyro",
        },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) {
        throw new Error(await getApiError(response, "The pin couldn’t be saved."));
      }
      updateChat(chat.id, (current) => ({ ...current, persisted: true, pinned }));
    } catch (error) {
      updateChat(chat.id, (current) => ({ ...current, pinned: !pinned }));
      setNotice(error instanceof Error ? error.message : "The pin couldn’t be saved.");
    }
  }

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length || !user) return;
    if (sending || uploadingFiles) return;

    const slots = MAX_FILES_PER_MESSAGE - pendingAttachments.length;
    if (slots <= 0) {
      setNotice(`Attach up to ${MAX_FILES_PER_MESSAGE} files to one message.`);
      return;
    }

    const validFiles: File[] = [];
    let totalBytes = pendingAttachments.reduce((total, item) => total + item.size, 0);
    let validationMessage = "";
    for (const file of files.slice(0, slots)) {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      const accepted = ACCEPTED_FILE_TYPES.split(",").includes(`.${extension}`);
      if (!accepted || file.size < 1 || file.size > MAX_FILE_SIZE) {
        validationMessage = "Use an image, PDF, TXT, Markdown, or CSV file no larger than 10 MB.";
        continue;
      }
      if (totalBytes + file.size > MAX_FILE_BYTES_PER_MESSAGE) {
        validationMessage = "Files in one message can total no more than 20 MB.";
        continue;
      }
      totalBytes += file.size;
      validFiles.push(file);
    }
    if (files.length > slots) {
      validationMessage = `Attach up to ${MAX_FILES_PER_MESSAGE} files to one message.`;
    }
    if (!validFiles.length) {
      if (validationMessage) setNotice(validationMessage);
      return;
    }

    setUploadingFiles(true);
    setNotice(validationMessage);
    try {
      let chat = chats.find((item) => item.id === activeChatId);
      if (!chat) {
        const createdChat = newChat();
        chat = createdChat;
        setChats((previous) => [createdChat, ...previous].slice(0, HISTORY_LIMIT));
        setActiveChatId(chat.id);
      }
      await ensurePersistedChat(chat);

      for (const file of validFiles) {
        const placeholder: Attachment = {
          id: `uploading-${crypto.randomUUID()}`,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          uploading: true,
        };
        setPendingAttachments((previous) => [...previous, placeholder]);
        let assetId = "";
        try {
          const idToken = await user.getIdToken();
          const signatureResponse = await fetch("/api/uploads/sign", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "Content-Type": "application/json",
              "X-Requested-With": "xyro",
            },
            body: JSON.stringify({
              chatId: chat.id,
              name: file.name,
              mimeType: file.type,
              size: file.size,
            }),
          });
          if (!signatureResponse.ok) {
            throw new Error(await getApiError(signatureResponse, "The file couldn’t be prepared for upload."));
          }
          const signatureValue: unknown = await signatureResponse.json();
          if (!isUploadSignature(signatureValue)) {
            throw new Error("The upload service returned invalid signing details.");
          }
          assetId = signatureValue.assetId;

          const uploadData = new FormData();
          uploadData.append("file", file);
          uploadData.append("api_key", signatureValue.apiKey);
          uploadData.append("timestamp", String(signatureValue.timestamp));
          uploadData.append("public_id", signatureValue.publicId);
          uploadData.append("type", signatureValue.deliveryType);
          uploadData.append("overwrite", "false");
          uploadData.append("upload_preset", signatureValue.uploadPreset);
          uploadData.append("signature", signatureValue.signature);

          const cloudinaryResponse = await fetch(
            `https://api.cloudinary.com/v1_1/${encodeURIComponent(signatureValue.cloudName)}/${signatureValue.resourceType}/upload`,
            { method: "POST", body: uploadData },
          );
          if (!cloudinaryResponse.ok) {
            throw new Error("Cloudinary couldn’t upload this file. Please try again.");
          }

          const confirmResponse = await fetch("/api/uploads/confirm", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "Content-Type": "application/json",
              "X-Requested-With": "xyro",
            },
            body: JSON.stringify({ assetId }),
          });
          if (!confirmResponse.ok) {
            throw new Error(await getApiError(confirmResponse, "The uploaded file couldn’t be verified."));
          }
          const confirmation: unknown = await confirmResponse.json();
          const attachmentValue =
            typeof confirmation === "object" &&
            confirmation !== null &&
            "attachment" in confirmation
              ? confirmation.attachment
              : undefined;
          if (!isAttachment(attachmentValue) || attachmentValue.size !== file.size) {
            throw new Error("The uploaded file didn’t match its verified metadata.");
          }

          setPendingAttachments((previous) =>
            previous.map((item) => item.id === placeholder.id ? attachmentValue : item),
          );
          setAttachmentUrls((previous) => ({
            ...previous,
            [attachmentValue.id]: attachmentValue.accessUrl,
          }));
        } catch (error) {
          if (assetId) {
            try {
              const cleanupToken = await user.getIdToken();
              const cleanupResponse = await fetch(`/api/uploads/${encodeURIComponent(assetId)}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${cleanupToken}`,
                  "X-Requested-With": "xyro",
                },
              });
              if (!cleanupResponse.ok) {
                console.error(
                  "Couldn’t remove the failed upload.",
                  await getApiError(cleanupResponse, "Cloudinary cleanup failed."),
                );
              }
            } catch (cleanupError) {
              console.error("Couldn’t remove the failed upload.", cleanupError);
            }
          }
          setPendingAttachments((previous) =>
            previous.filter((item) => item.id !== placeholder.id),
          );
          setNotice(
            `${file.name}: ${
              error instanceof Error ? error.message : "The file couldn’t be uploaded."
            }`,
          );
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Files couldn’t be uploaded.");
    } finally {
      setUploadingFiles(false);
    }
  }

  async function removePendingAttachment(attachment: Attachment) {
    if (attachment.uploading || !user) return;
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/uploads/${encodeURIComponent(attachment.id)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "X-Requested-With": "xyro",
        },
      });
      if (!response.ok) {
        throw new Error(await getApiError(response, "This attachment couldn’t be removed."));
      }
      setPendingAttachments((previous) =>
        previous.filter((item) => item.id !== attachment.id),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This attachment couldn’t be removed.");
    }
  }

  function exportChat(chat: Chat) {
    if (!chat.messages.length) {
      setNotice("Add a message before exporting this conversation.");
      return;
    }

    const markdown = chat.messages
      .map((message) => `## ${message.role === "user" ? "You" : "Xyro AI"}\n\n${message.content}`)
      .join("\n\n---\n\n");
    const fileName =
      chat.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      "xyro-conversation";
    const url = URL.createObjectURL(
      new Blob([`# ${chat.title}\n\n${markdown}\n`], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("");
  }

  async function sendMessage(text: string, regenerate = false) {
    const content = text.trim();
    if (!user || sending) return;
    if (!user.emailVerified) {
      // Unverified users may enter the app and read their chats, but
      // sending stays blocked until the email is verified (the API
      // enforces the same rule server-side).
      setNotice("Verify your email to send messages. Use the banner above to resend the link.");
      return;
    }
    if (content.length > MESSAGE_MAX_LENGTH) {
      setNotice(`Messages must be ${MESSAGE_MAX_LENGTH.toLocaleString()} characters or fewer.`);
      return;
    }

    let chat = chats.find((item) => item.id === activeChatId);
    if (!chat) {
      const createdChat = newChat();
      chat = createdChat;
      setChats((previous) => [createdChat, ...previous].slice(0, HISTORY_LIMIT));
      setActiveChatId(chat.id);
    }
    const lastUserMessage = [...chat.messages].reverse().find((item) => item.role === "user");
    const attachments = regenerate
      ? lastUserMessage?.attachments ?? []
      : pendingAttachments.filter((attachment) => !attachment.uploading);
    if (pendingAttachments.some((attachment) => attachment.uploading) || uploadingFiles) {
      setNotice("Wait for your uploads to finish before sending.");
      return;
    }
    if (regenerate && !lastUserMessage) return;
    if (!regenerate && !content && !attachments.length) return;
    if (attachments.length > MAX_FILES_PER_MESSAGE) {
      setNotice(`Attach up to ${MAX_FILES_PER_MESSAGE} files to one message.`);
      return;
    }

    const messageContent = regenerate ? lastUserMessage?.content ?? "" : content;
    const userMessageId = regenerate ? lastUserMessage?.id : crypto.randomUUID();
    if (!userMessageId) return;
    const assistantMessageId = crypto.randomUUID();
    const responseId = crypto.randomUUID();
    const controller = new AbortController();
    controllerRef.current = controller;
    setDraft("");
    setNotice("");
    setSending(true);
    try {
      chat = await ensurePersistedChat(chat);
      const persistedChatId = chat.id;
      // Arm the hardened stream listener for exactly this response
      // (Phase 5): chunks for any other responseId, or with a seq at
      // or below the last applied one, are ignored by the listener.
      streamSeqRef.current = 0;
      lastChunkAtRef.current = Date.now();
      setStreamTarget({
        chatId: persistedChatId,
        responseId,
        messageId: assistantMessageId,
        startedAt: Date.now(),
      });
      const idToken = await user.getIdToken();
      const sendRequest = () =>
        fetch("/api/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
            "X-Requested-With": "xyro",
          },
          body: JSON.stringify({
            chatId: persistedChatId,
            responseId,
            userMessageId,
            assistantMessageId,
            content: messageContent,
            attachmentIds: attachments.map((attachment) => attachment.id),
            regenerate,
            model: selectedModel ?? preferences.defaultModel,
            webSearch: webSearchOn,
          }),
          signal: controller.signal,
        });
      let response = await sendRequest();

      // Daily-budget queue (Phase 4): at >=85% of the daily
      // Firestore budget the server answers 429 BUDGET_QUEUE. That
      // is not an error — show a queued state and retry once after
      // the server's Retry-After. The rejected attempt wrote
      // nothing server-side, so re-sending the same ids is safe.
      // (BUDGET_PAUSED, 503, falls through to the normal error path
      // below, whose message explains the pause.)
      if (response.status === 429) {
        const peek: unknown = await response.clone().json().catch(() => null);
        const code =
          typeof peek === "object" &&
          peek !== null &&
          "error" in peek &&
          typeof peek.error === "object" &&
          peek.error !== null &&
          "code" in peek.error
            ? peek.error.code
            : undefined;
        if (code === "BUDGET_QUEUE") {
          setNotice(
            "You’re in a short queue — today’s capacity is nearly full. Retrying your message shortly…",
          );
          const retryAfterSeconds = Math.min(
            Number(response.headers.get("Retry-After")) || 30,
            60,
          );
          await new Promise((resolve) =>
            window.setTimeout(resolve, retryAfterSeconds * 1000),
          );
          if (!controller.signal.aborted) {
            response = await sendRequest();
          }
        }
      }

      if (!response.ok) {
        throw new Error(await getApiError(response, "The assistant couldn’t respond. Please try again."));
      }
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("success" in result) ||
        result.success !== true
      ) {
        throw new Error("The assistant returned an invalid response.");
      }
      if (!regenerate) setPendingAttachments([]);
    } catch (sendError) {
      if (!regenerate && attachments.length) {
        try {
          const savedUserMessage = await getDoc(
            doc(
              getFirebaseFirestore(),
              "users",
              user.uid,
              "chats",
              chat.id,
              "messages",
              userMessageId,
            ),
          );
          if (savedUserMessage.exists()) setPendingAttachments([]);
        } catch (reconcileError) {
          console.error("Couldn’t reconcile sent attachments after a failed request.", reconcileError);
        }
      }
      if (sendError instanceof Error && sendError.name === "AbortError") {
        setNotice("Response stopped.");
      } else {
        setDraft(content);
        setNotice(
          sendError instanceof Error
            ? sendError.message
            : "The assistant couldn’t respond. Please try again.",
        );
      }
    } finally {
      controllerRef.current = null;
      // The request has settled: detach the stream listener (the
      // Firestore messages listener delivers the final saved state).
      setStreamTarget(null);
      setSending(false);
    }
  }

  // Image creation submit (Phase 7). Mirrors sendMessage's guards:
  // verified email required, one request at a time, chat persisted
  // first. The server's reply is authoritative — including the
  // IMAGE_MODEL_UNAVAILABLE message, which is shown verbatim so the
  // user hears plainly that no free image model is available.
  async function createImage(text: string) {
    const prompt = text.trim();
    if (!user || creatingImage || sending) return;
    if (!user.emailVerified) {
      setNotice("Verify your email to create images. Use the banner above to resend the link.");
      return;
    }
    if (!prompt) return;
    if (prompt.length > MESSAGE_MAX_LENGTH) {
      setNotice(`Descriptions must be ${MESSAGE_MAX_LENGTH.toLocaleString()} characters or fewer.`);
      return;
    }

    let chat = chats.find((item) => item.id === activeChatId);
    if (!chat) {
      const createdChat = newChat();
      chat = createdChat;
      setChats((previous) => [createdChat, ...previous].slice(0, HISTORY_LIMIT));
      setActiveChatId(chat.id);
    }
    setCreatingImage(true);
    setNotice("");
    try {
      chat = await ensurePersistedChat(chat);
      const idToken = await user.getIdToken();
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "xyro",
        },
        body: JSON.stringify({
          chatId: chat.id,
          prompt,
          userMessageId: crypto.randomUUID(),
          assistantMessageId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) {
        throw new Error(
          await getApiError(response, "The image couldn’t be created. Please try again."),
        );
      }
      // Success: the user + assistant messages (with the watermarked
      // picture attached) arrive through the Firestore listener.
      setDraft("");
      setCreateMode(false);
      setNotice("Your image is ready — it appears in the conversation above.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The image couldn’t be created. Please try again.",
      );
    } finally {
      setCreatingImage(false);
    }
  }

  async function submitDraft() {
    if (createMode) {
      await createImage(draft);
    } else {
      await sendMessage(draft);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft();
  }

  async function handleVerifyEmail() {
    if (!user) return;
    setVerificationBusy(true);
    setNotice("");
    try {
      await reload(user);
      if (!user.emailVerified) {
        setNotice("Your email isn’t verified yet. Open the link in your inbox, or resend it below.");
        return;
      }
      setAuthState("ready");
      setHistoryLoaded(false);
      setChats([]);
      setActiveChatId(null);
    } catch {
      setNotice("We couldn’t verify your email status. Please try again.");
    } finally {
      setVerificationBusy(false);
    }
  }

  // Resending goes through the session-gated server route
  // (POST /api/auth/resend-verification), never the client SDK: the
  // server enforces the session and the 1-per-60 s limit, and the UI
  // mirrors it with a visible cooldown.
  async function handleResendVerification() {
    if (!user || resendCooldown > 0) return;
    setVerificationBusy(true);
    setNotice("");
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
        throw new Error(
          await getApiError(response, "We couldn’t send the verification email. Please try again."),
        );
      }
      setResendCooldown(60);
      setNotice("A fresh verification link is on its way. Check your inbox and spam folder.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We couldn’t send the verification email. Please try again.",
      );
    } finally {
      setVerificationBusy(false);
    }
  }

  async function confirmSignOut() {
    if (!signOutVariant) return;
    setSigningOut(true);
    controllerRef.current?.abort();
    // performSignOut revokes the server session, tears down Firebase
    // and Firestore locally, and navigates to "/".
    await performSignOut({ allDevices: signOutVariant === "all" });
    setSigningOut(false);
    setSignOutVariant(null);
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(""), 1500);
    } catch {
      setNotice("Couldn’t copy this response. Check your browser’s clipboard permissions.");
    }
  }

  function retryLastResponse() {
    if (!activeChat || sending) return;
    const lastUserMessage = [...activeChat.messages].reverse().find((item) => item.role === "user");
    if (lastUserMessage) void sendMessage(lastUserMessage.content, true);
  }

  function toggleWebSearch() {
    setWebSearchOn((value) => {
      const next = !value;
      try {
        localStorage.setItem("xyro:websearch", next ? "1" : "0");
      } catch {
        // Private mode: the toggle just won't persist.
      }
      return next;
    });
  }

  /** Read a reply aloud with the browser's built-in voice (free, on-device). */
  function speakMessage(message: Message) {
    if (!("speechSynthesis" in window)) {
      setNotice("Read aloud isn’t supported in this browser.");
      return;
    }
    if (speakingId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const plain = message.content
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~|-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);
    if (!plain) return;
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(message.id);
    window.speechSynthesis.speak(utterance);
  }

  /** Voice input via the browser's speech recognition, when available. */
  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setNotice("Voice input isn’t supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognitionCtor() as {
      lang: string;
      interimResults: boolean;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setDraft((value) => (value ? `${value} ${transcript}` : transcript));
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  // Unverified users are NOT gated out: they enter the workspace,
  // see the persistent verify banner, and can read their chats — only
  // sending is blocked (see sendMessage and the composer).
  if (authState !== "ready" && authState !== "unverified") {
    return (
      <div className="chat-gate">
        <FirebasePresence />
        <div className="chat-gate-card">
          <span className="chat-brand-mark" aria-hidden="true">x</span>
          {authState === "loading" && <p role="status">Opening your workspace…</p>}
          {authState === "signed-out" && <p role="status">Taking you to sign in…</p>}
          {authState === "not-configured" && (
            <>
              <h1>Sign-in isn’t configured</h1>
              <p>Set up the Firebase web app settings before opening your chat workspace.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const pinnedChats = visibleChats.filter((chat) => chat.pinned);
  const groupedChats = visibleChats
    .filter((chat) => !chat.pinned)
    .reduce<Record<string, Chat[]>>((groups, chat) => {
      const group = getChatGroup(chat.updatedAt);
      (groups[group] ??= []).push(chat);
      return groups;
    }, {});
  const chatGroups: [string, Chat[]][] = [
    ...(pinnedChats.length ? [["Pinned", pinnedChats] as [string, Chat[]]] : []),
    ...Object.entries(groupedChats),
  ];

  return (
    <div className={`chat-app${sidebarCollapsed ? " chat-app-sidebar-collapsed" : ""}`}>
      <FirebasePresence />
      {sidebarOpen && (
        <button
          className="chat-drawer-backdrop"
          type="button"
          aria-label="Close chat history"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`chat-sidebar${sidebarOpen ? " chat-sidebar-open" : ""}`}>
        <div className="chat-sidebar-top">
          <Link className="chat-wordmark" href="/chat" aria-label="Xyro AI home">
            <span className="chat-brand-mark" aria-hidden="true">x</span>
            <span>xyro<span>ai</span></span>
          </Link>
          <button
            className="chat-icon-button chat-mobile-close"
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="close" />
          </button>
          <button
            className="chat-icon-button chat-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <Icon name="menu" />
          </button>
        </div>
        <button className="chat-new-button" type="button" onClick={startNewChat}>
          <Icon name="plus" size={17} />
          <span>New chat</span>
          <kbd>⌘ ⇧ O</kbd>
        </button>
        <div className="chat-history-heading">
          <span>Your chats</span>
          <button
            className="chat-icon-button"
            type="button"
            aria-label={searchOpen ? "Close search" : "Search chats"}
            title="Search chats (⌘K)"
            onClick={() => {
              setSearchOpen((open) => !open);
              setSearch("");
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          >
            {searchOpen ? <Icon name="close" size={16} /> : <Icon name="search" size={16} />}
          </button>
        </div>
        {searchOpen && (
          <label className="chat-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
            />
          </label>
        )}
        <nav className="chat-history" aria-label="Chat history">
          {chatGroups.map(([group, groupChats]) => (
            <section className="chat-history-group" key={group}>
              <h2>{group}</h2>
              {groupChats.map((chat) => (
                <div
                  className={`chat-history-item${chat.id === activeChatId ? " chat-history-active" : ""}`}
                  key={chat.id}
                >
                  {editingChatId === chat.id ? (
                    <form
                      className="chat-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveChatRename(chat.id);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="Conversation name"
                        maxLength={60}
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingChatId(null);
                            setRenameDraft("");
                          }
                        }}
                      />
                      <button type="submit" aria-label="Save conversation name">
                        <Icon name="send" size={14} />
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => selectChat(chat.id)}>
                      <span>{chat.title}</span>
                    </button>
                  )}
                  {editingChatId !== chat.id && (
                    <div className="chat-history-menu-wrap">
                      <button
                        className="chat-history-menu-button"
                        type="button"
                        aria-label={`More actions for ${chat.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuChatId === chat.id}
                        title="More actions"
                        onClick={() =>
                          setMenuChatId((current) => (current === chat.id ? null : chat.id))
                        }
                      >
                        <Icon name="dots" size={16} />
                      </button>
                      {menuChatId === chat.id && (
                        <div className="chat-history-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuChatId(null);
                              void togglePinChat(chat);
                            }}
                          >
                            <Icon name="spark" size={14} />
                            {chat.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuChatId(null);
                              beginRenameChat(chat);
                            }}
                          >
                            <Icon name="edit" size={14} />
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuChatId(null);
                              exportChat(chat);
                            }}
                          >
                            <Icon name="download" size={14} />
                            Export
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="chat-history-menu-danger"
                            onClick={() => {
                              setMenuChatId(null);
                              void deleteChat(chat.id);
                            }}
                          >
                            <Icon name="trash" size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
          {visibleChats.length === 0 && (
            <p className="chat-history-empty">
              {search
                ? "No chats match your search."
                : historyLoaded
                  ? "Your conversations will appear here."
                  : "Loading your chats…"}
            </p>
          )}
        </nav>
        <div className="chat-sidebar-bottom">
          <div className="chat-user-card">
            {user?.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="chat-avatar chat-avatar-photo" src={user.photoURL} alt="" width={32} height={32} />
            ) : (
              <span className="chat-avatar" aria-hidden="true">
                {(user?.displayName || user?.email || "x").slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="chat-user-email">{user?.displayName || user?.email}</span>
            <button type="button" className="chat-signout" onClick={() => setSignOutVariant("single")}>
              Sign out
            </button>
          </div>
          <button type="button" className="chat-settings-link chat-signout-all" onClick={() => setSignOutVariant("all")}>
            Sign out of all devices
          </button>
          <Link className="chat-settings-link" href="/settings">Account settings <span>↗</span></Link>
        </div>
      </aside>
      <SignOutDialog
        open={signOutVariant !== null}
        variant={signOutVariant ?? "single"}
        busy={signingOut}
        onCancel={() => setSignOutVariant(null)}
        onConfirm={confirmSignOut}
      />

      <main className="chat-main">
        <header className="chat-topbar">
          <button
            className="chat-icon-button chat-mobile-menu"
            type="button"
            aria-label="Open chat history"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <label className="chat-model-picker">
            <span className="chat-model-dot" />
            <select
              aria-label="Choose a free model"
              title="Choose a free model"
              value={selectedModel ?? AUTO_MODEL_OPTION.id}
              onChange={(event) => handleModelChange(event.target.value)}
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <span className="chat-model-tier">Free</span>
            <span className="chat-model-chevron" aria-hidden="true">⌄</span>
          </label>
          <div className="chat-topbar-actions">
            {activeChat && activeMessages.length > 0 && (
              <button
                className="chat-topbar-button"
                type="button"
                onClick={() => exportChat(activeChat)}
                title="Export conversation as Markdown"
              >
                <Icon name="download" size={16} />
                <span>Export</span>
              </button>
            )}
            <button className="chat-topbar-button chat-topbar-new" type="button" onClick={startNewChat}>
              <Icon name="plus" size={16} />
              <span>New chat</span>
            </button>
          </div>
          <Link className="chat-topbar-link" href="/help">Help</Link>
        </header>

        {authState === "unverified" && (
          <div className="verify-banner" role="status">
            <p>
              <strong>Verify your email</strong>
              <span>
                You can browse your chats, but sending is off until you
                verify{" "}{user?.email ?? "your email address"}.
              </span>
            </p>
            <div className="verify-banner-actions">
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={verificationBusy || resendCooldown > 0}
              >
                {resendCooldown > 0
                  ? `Resend email (${resendCooldown}s)`
                  : "Resend verification email"}
              </button>
              <button
                type="button"
                onClick={handleVerifyEmail}
                disabled={verificationBusy}
              >
                {verificationBusy ? "Checking…" : "I’ve verified my email"}
              </button>
            </div>
          </div>
        )}

        <div
          ref={conversationRef}
          className={`chat-conversation${activeMessages.length ? " chat-conversation-has-messages" : ""}`}
          onScroll={(event) => {
            const element = event.currentTarget;
            setShowScrollDown(
              element.scrollHeight - element.scrollTop - element.clientHeight > 240,
            );
          }}
        >
          {activeMessages.length === 0 ? (
            <section className="chat-empty-state">
              <span className="chat-empty-mark"><Icon name="spark" size={25} /></span>
              <p className="chat-empty-eyebrow">Your workspace, ready when you are</p>
              <h1>
                What can I help you with
                {user?.displayName ? (
                  <>, <span className="gradient-text">{user.displayName.split(" ")[0]}</span>?</>
                ) : (
                  " today?"
                )}
              </h1>
              <p className="chat-empty-description">
                Ask a question, work through an idea, or get a first draft. Choose a prompt or start with your own.
              </p>
              {preferences.showSuggestions && (
              <div className="chat-suggestions">
                {[
                  "Explain a tricky concept in simple terms",
                  "Help me plan a project from scratch",
                  "Improve this writing and keep my voice",
                  "Brainstorm a few fresh ideas",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setDraft(suggestion);
                      textareaRef.current?.focus();
                    }}
                  >
                    <span aria-hidden="true">↗</span>
                    {suggestion}
                  </button>
                ))}
              </div>
              )}
            </section>
          ) : (
            <section className="chat-message-list" aria-label="Conversation">
              {activeMessages.map((message) => (
                <article
                  className={`chat-message chat-message-${message.role}${message.status === "generating" ? " chat-message-streaming" : ""}`}
                  key={message.id}
                >
                  <div className="chat-message-body">
                    {message.attachments.length > 0 && (
                      <div className="chat-message-attachments">
                        {message.attachments.map((attachment) => {
                          const accessUrl =
                            attachmentUrls[attachment.id] ?? attachment.accessUrl;
                          return (
                            <a
                              className="chat-message-attachment"
                              key={attachment.id}
                              href={accessUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${attachment.name}`}
                            >
                              {attachment.mimeType.startsWith("image/") && accessUrl ? (
                                <img src={accessUrl} alt={attachment.name} loading="lazy" />
                              ) : (
                                <span className="chat-file-badge" aria-hidden="true">
                                  {attachment.name.split(".").at(-1)?.toUpperCase() ?? "FILE"}
                                </span>
                              )}
                              <span className="chat-attachment-name">{attachment.name}</span>
                              <span className="chat-attachment-size">
                                {formatFileSize(attachment.size)}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {message.role === "user" ? (
                      message.content ? (
                        <div className="chat-message-bubble">{message.content}</div>
                      ) : null
                    ) : (
                      <div className="chat-message-content">
                        {message.content ? (
                          <TypewriterText
                            text={message.content}
                            speed={preferences.typingSpeed}
                            active={message.status === "generating"}
                          />
                        ) : sending ? (
                          <span className="chat-thinking" role="status"><i /><i /><i /> Thinking</span>
                        ) : null}
                      </div>
                    )}
                    {message.role === "assistant" && message.sources && message.sources.length > 0 && (
                      <div className="chat-sources">
                        <span className="chat-sources-label">Sources</span>
                        {message.sources.map((source, index) => (
                          <a
                            key={`${source.url}-${index}`}
                            className="chat-source-chip"
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.url}
                          >
                            <span className="chat-source-index">{index + 1}</span>
                            {(() => {
                              try {
                                return new URL(source.url).hostname.replace(/^www\./, "");
                              } catch {
                                return source.title.slice(0, 40);
                              }
                            })()}
                          </a>
                        ))}
                      </div>
                    )}
                    {message.role === "assistant" && message.content && (
                      <div className="chat-message-actions">
                        <button
                          type="button"
                          aria-label="Copy response"
                          title={copiedMessageId === message.id ? "Copied" : "Copy"}
                          onClick={() => void copyMessage(message)}
                        >
                          <Icon name="copy" size={15} />
                          <span>{copiedMessageId === message.id ? "Copied" : "Copy"}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={speakingId === message.id ? "Stop reading" : "Read aloud"}
                          title={speakingId === message.id ? "Stop" : "Read aloud"}
                          onClick={() => speakMessage(message)}
                        >
                          <span>{speakingId === message.id ? "Stop" : "Read aloud"}</span>
                        </button>
                        {message.id === activeMessages.at(-1)?.id && (
                          <button
                            type="button"
                            onClick={retryLastResponse}
                            disabled={sending}
                          >
                            Regenerate
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>

        <div className="chat-composer-area">
          {showScrollDown && activeMessages.length > 0 && (
            <button
              type="button"
              className="chat-scroll-bottom"
              aria-label="Scroll to the latest message"
              onClick={() => {
                conversationRef.current?.scrollTo({
                  top: conversationRef.current.scrollHeight,
                  behavior: "smooth",
                });
                setShowScrollDown(false);
              }}
            >
              ↓
            </button>
          )}
          {notice && <p className="chat-notice" role="status">{notice}</p>}
          {createMode && (
            <div className="chat-create-mode" role="status">
              <Icon name="spark" size={15} />
              <span>
                <strong>Creating an image.</strong> Describe the picture below —
                it’s made by a free model, watermarked invisibly, and saved to
                this chat. If no free image model is available, we’ll say so.
              </span>
              <button
                type="button"
                aria-label="Exit image creation mode"
                disabled={creatingImage}
                onClick={() => setCreateMode(false)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="chat-pending-attachments" aria-label="Attachments to send">
              {pendingAttachments.map((attachment) => {
                const accessUrl =
                  attachmentUrls[attachment.id] ?? attachment.accessUrl;
                return (
                  <div className="chat-pending-attachment" key={attachment.id}>
                    {attachment.mimeType.startsWith("image/") && accessUrl ? (
                      <img src={accessUrl} alt="" />
                    ) : (
                      <span className="chat-file-badge" aria-hidden="true">
                        {attachment.name.split(".").at(-1)?.toUpperCase() ?? "FILE"}
                      </span>
                    )}
                    <span className="chat-attachment-name">{attachment.name}</span>
                    <span className="chat-attachment-size">
                      {attachment.uploading ? "Uploading…" : formatFileSize(attachment.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      disabled={attachment.uploading || uploadingFiles || sending}
                      onClick={() => void removePendingAttachment(attachment)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <form className="chat-composer" onSubmit={handleSubmit}>
            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              accept={fileAccept}
              multiple
              onChange={handleFilesSelected}
              disabled={sending || uploadingFiles}
              aria-label="Attach images or documents"
            />
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                // Send-key preference (Phase 3): either plain Enter
                // sends (Shift+Enter for a new line), or only
                // Cmd/Ctrl+Enter sends and Enter adds a new line.
                const modifier = event.metaKey || event.ctrlKey;
                const shouldSend = preferences.sendWithEnter
                  ? !event.shiftKey
                  : modifier;
                if (shouldSend) {
                  event.preventDefault();
                  void submitDraft();
                }
              }}
              placeholder={createMode ? "Describe the image you want to create…" : "Ask anything…"}
              aria-label={createMode ? "Describe an image to create" : "Ask anything"}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={1}
              disabled={sending || creatingImage}
            />
            <div className="chat-composer-bottom">
              <span className="chat-composer-hint">
                {draft.length > MESSAGE_MAX_LENGTH - 500
                  ? `${draft.length.toLocaleString()} / ${MESSAGE_MAX_LENGTH.toLocaleString()}`
                  : creatingImage
                    ? "Creating your image…"
                    : uploadingFiles
                      ? "Uploading files…"
                      : createMode
                        ? "Free image models · 10 creations a day"
                        : preferences.sendWithEnter
                          ? "Shift + Enter for a new line"
                          : "Cmd/Ctrl + Enter to send"}
              </span>
              <button
                className={`chat-tool-button${webSearchOn ? " chat-tool-on" : ""}`}
                type="button"
                aria-label="Search the web"
                aria-pressed={webSearchOn}
                title={
                  webSearchOn
                    ? "Web search is on — replies use live web results with sources"
                    : "Search the web for recent information"
                }
                disabled={authState === "unverified" || createMode}
                onClick={toggleWebSearch}
              >
                <Icon name="globe" size={18} />
              </button>
              <button
                className={`chat-tool-button${listening ? " chat-tool-on" : ""}`}
                type="button"
                aria-label={listening ? "Stop voice input" : "Voice input"}
                aria-pressed={listening}
                title={listening ? "Listening… tap to stop" : "Dictate your message"}
                disabled={authState === "unverified" || createMode}
                onClick={toggleListening}
              >
                <Icon name="mic" size={18} />
              </button>
              <div className="chat-attach-wrap">
                <button
                  className="chat-attach-button"
                  type="button"
                  aria-label="Attach files or create an image"
                  aria-haspopup="menu"
                  aria-expanded={attachMenuOpen}
                  title="Attach or create"
                  disabled={
                    authState === "unverified" ||
                    sending ||
                    creatingImage ||
                    uploadingFiles ||
                    pendingAttachments.length >= MAX_FILES_PER_MESSAGE
                  }
                  onClick={() => setAttachMenuOpen((open) => !open)}
                >
                  <Icon name="plus" size={19} />
                </button>
                {attachMenuOpen && (
                  <div className="chat-attach-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        if (pendingAttachments.length) {
                          setNotice("Send or remove the current attachments before creating an image.");
                          return;
                        }
                        setCreateMode(true);
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                    >
                      <Icon name="spark" size={16} />
                      Create an image
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setCreateMode(false);
                        setFileAccept(IMAGE_FILE_TYPES);
                        requestAnimationFrame(() => fileInputRef.current?.click());
                      }}
                    >
                      <Icon name="image" size={16} />
                      Upload image
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setCreateMode(false);
                        setFileAccept(ACCEPTED_FILE_TYPES);
                        requestAnimationFrame(() => fileInputRef.current?.click());
                      }}
                    >
                      <Icon name="file" size={16} />
                      Upload file or document
                    </button>
                    <p>Images, PDF, TXT, Markdown or CSV · 10 MB max per file · Image creation uses free models only</p>
                  </div>
                )}
              </div>
              {sending ? (
                <button
                  className="chat-send-button chat-stop-button"
                  type="button"
                  aria-label="Stop generating"
                  title="Stop generating (Esc)"
                  onClick={() => controllerRef.current?.abort()}
                >
                  <Icon name="stop" size={17} />
                </button>
              ) : (
                <button
                  className="chat-send-button"
                  type="submit"
                  aria-label={createMode ? "Create image" : "Send message"}
                  title={
                    authState === "unverified"
                      ? "Verify your email to send messages"
                      : createMode
                        ? "Create image"
                        : "Send message"
                  }
                  disabled={
                    authState === "unverified" ||
                    creatingImage ||
                    (createMode
                      ? !draft.trim()
                      : !draft.trim() && pendingAttachments.length === 0)
                  }
                >
                  <Icon name={createMode ? "spark" : "send"} size={17} />
                </button>
              )}
            </div>
          </form>
          <p className="chat-disclaimer">
            AI can make mistakes. Prompts are processed by OpenRouter and its model providers.
          </p>
        </div>
      </main>
      <div className="chat-mobile-brand" aria-hidden="true">xyro<span>ai</span></div>
    </div>
  );
}
