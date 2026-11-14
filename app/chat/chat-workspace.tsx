"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signOut,
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
import FirebasePresence from "@/components/firebase-presence";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";
import {
  getFirebaseFirestore,
  getFirebaseRealtimeDatabase,
} from "@/lib/firebase/client";

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
};

type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  searchText?: string;
  lastMessagePreview?: string;
  persisted?: boolean;
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
  if (age < day * 2) return "Yesterday";
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
    | "attach";
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

export default function ChatWorkspace() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
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

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthState("not-configured");
      return;
    }

    return onAuthStateChanged(getFirebaseAuth(), (currentUser) => {
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
    if (!user || authState !== "ready") return;
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
              };
            });
            setChats((previous) => {
              const previousById = new Map(previous.map((chat) => [chat.id, chat]));
              return loadedChats.map((chat) => ({
                ...chat,
                messages: previousById.get(chat.id)?.messages ?? [],
              }));
            });
            setActiveChatId((current) =>
              current && loadedChats.some((chat) => chat.id === current)
                ? current
                : loadedChats[0]?.id ?? null,
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
    if (!user || !activeChatId || authState !== "ready") return;
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
            };
          });
          updateChat(activeChatId, (chat) => ({ ...chat, messages }));
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

  useEffect(() => {
    if (!user || !activeChatId || authState !== "ready") return;
    try {
      const streamRef = ref(
        getFirebaseRealtimeDatabase(),
        `chatStreams/${user.uid}/${activeChatId}`,
      );
      return onValue(
        streamRef,
        (snapshot) => {
          const stream = snapshot.val();
          if (
            typeof stream !== "object" ||
            stream === null ||
            typeof stream.messageId !== "string" ||
            typeof stream.text !== "string" ||
            stream.status !== "generating"
          ) {
            return;
          }
          updateChat(activeChatId, (chat) => ({
            ...chat,
            messages: chat.messages.map((message) =>
              message.id === stream.messageId
                ? { ...message, content: stream.text, status: "generating" }
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
  }, [activeChatId, authState, updateChat, user]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [draft]);

  useEffect(() => () => controllerRef.current?.abort(), []);

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
          headers: { Authorization: `Bearer ${idToken}` },
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
      const nextChat = chats.find((chat) => chat.id !== chatId);
      setActiveChatId(nextChat?.id ?? null);
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
                headers: { Authorization: `Bearer ${cleanupToken}` },
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
        headers: { Authorization: `Bearer ${idToken}` },
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
      const idToken = await user.getIdToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId: chat.id,
          responseId,
          userMessageId,
          assistantMessageId,
          content: messageContent,
          attachmentIds: attachments.map((attachment) => attachment.id),
          regenerate,
        }),
        signal: controller.signal,
      });

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
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(draft);
  }

  async function handleVerifyEmail() {
    if (!user) return;
    setVerificationBusy(true);
    setNotice("");
    try {
      await reload(user);
      if (!user.emailVerified) {
        await sendEmailVerification(user);
        setNotice("Your email isn’t verified yet. We sent a fresh verification link.");
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

  async function handleSignOut() {
    controllerRef.current?.abort();
    await signOut(getFirebaseAuth());
    router.replace("/sign-in");
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

  if (authState !== "ready") {
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
          {authState === "unverified" && (
            <>
              <h1>Verify your email to chat</h1>
              <p>Chat access is available after you verify the email address on your account.</p>
              {notice && <p className="chat-gate-notice" role="status">{notice}</p>}
              <button
                className="chat-primary-button"
                type="button"
                onClick={handleVerifyEmail}
                disabled={verificationBusy}
              >
                {verificationBusy ? "Checking…" : "I’ve verified my email"}
              </button>
              <Link className="chat-gate-link" href="/sign-in">Back to sign in</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  const groupedChats = visibleChats.reduce<Record<string, Chat[]>>((groups, chat) => {
    const group = getChatGroup(chat.updatedAt);
    (groups[group] ??= []).push(chat);
    return groups;
  }, {});

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
          <Link className="chat-wordmark" href="/" aria-label="Xyro AI home">
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
          {Object.entries(groupedChats).map(([group, groupChats]) => (
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
                    <button
                      className="chat-history-rename"
                      type="button"
                      aria-label={`Rename ${chat.title}`}
                      title="Rename chat"
                      onClick={() => beginRenameChat(chat)}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  )}
                  <button
                    className="chat-history-delete"
                    type="button"
                    aria-label={`Delete ${chat.title}`}
                    title="Delete chat"
                    onClick={() => deleteChat(chat.id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
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
            <span className="chat-avatar" aria-hidden="true">
              {(user?.displayName || user?.email || "x").slice(0, 1).toUpperCase()}
            </span>
            <span className="chat-user-email">{user?.displayName || user?.email}</span>
            <button type="button" className="chat-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
          <Link className="chat-settings-link" href="/settings">Account settings <span>↗</span></Link>
        </div>
      </aside>

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
          <div className="chat-model-picker" aria-label="OpenRouter free models">
            <span className="chat-model-dot" />
            <span>OpenRouter</span>
            <span className="chat-model-tier">Free models</span>
          </div>
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

        <div
          ref={conversationRef}
          className={`chat-conversation${activeMessages.length ? " chat-conversation-has-messages" : ""}`}
        >
          {activeMessages.length === 0 ? (
            <section className="chat-empty-state">
              <span className="chat-empty-mark"><Icon name="spark" size={25} /></span>
              <p className="chat-empty-eyebrow">Your workspace, ready when you are</p>
              <h1>What can I help you with{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : " today"}?</h1>
              <p className="chat-empty-description">
                Ask a question, work through an idea, or get a first draft. Choose a prompt or start with your own.
              </p>
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
            </section>
          ) : (
            <section className="chat-message-list" aria-label="Conversation">
              {activeMessages.map((message) => (
                <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                  {message.role === "assistant" ? (
                    <span className="chat-assistant-avatar" aria-hidden="true">
                      <Icon name="spark" size={17} />
                    </span>
                  ) : (
                    <span className="chat-avatar chat-message-user-avatar" aria-hidden="true">
                      {(user?.displayName || user?.email || "x").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="chat-message-body">
                    <span className="chat-message-author">
                      {message.role === "assistant" ? "Xyro AI" : "You"}
                    </span>
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
                    <div className="chat-message-content">
                      {message.content || (sending && message.role === "assistant" ? (
                        <span className="chat-thinking" role="status"><i /><i /><i /> Thinking</span>
                      ) : null)}
                    </div>
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
          {notice && <p className="chat-notice" role="status">{notice}</p>}
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
              accept={ACCEPTED_FILE_TYPES}
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
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendMessage(draft);
                }
              }}
              placeholder="Message Xyro AI…"
              aria-label="Message Xyro AI"
              maxLength={MESSAGE_MAX_LENGTH}
              rows={1}
              disabled={sending}
            />
            <div className="chat-composer-bottom">
              <span className="chat-composer-hint">
                {draft.length > MESSAGE_MAX_LENGTH - 500
                  ? `${draft.length.toLocaleString()} / ${MESSAGE_MAX_LENGTH.toLocaleString()}`
                  : uploadingFiles
                    ? "Uploading files…"
                    : "Shift + Enter for a new line"}
              </span>
              <button
                className="chat-attach-button"
                type="button"
                aria-label="Attach images or documents"
                title="Attach images or documents (10 MB max per file)"
                disabled={
                  sending ||
                  uploadingFiles ||
                  pendingAttachments.length >= MAX_FILES_PER_MESSAGE
                }
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="attach" size={18} />
              </button>
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
                  aria-label="Send message"
                  title="Send message"
                  disabled={
                    !draft.trim() &&
                    pendingAttachments.length === 0
                  }
                >
                  <Icon name="send" size={17} />
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
