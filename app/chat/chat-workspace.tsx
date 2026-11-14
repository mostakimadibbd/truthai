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

const HISTORY_LIMIT = 20;
const MESSAGE_LIMIT = 30;
const MESSAGE_MAX_LENGTH = 12_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
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
    | "download";
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
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const attachmentUrlLoadingRef = useRef(new Set<string>());
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
    let active = true;
    let unsubscribeChats: (() => void) | undefined;

    async function loadChats() {
      try {
        const historyKey = getHistoryKey(user.uid);
        const saved = localStorage.getItem(historyKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          const legacyChats = Array.isArray(parsed) ? parsed.filter(isChat) : [];
          if (legacyChats.length) {
            const idToken = await user.getIdToken();
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
          collection(getFirebaseFirestore(), "users", user.uid, "chats"),
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
            setChats(loadedChats);
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
          if (active) {
            setAttachmentUrls((previous) => ({
              ...previous,
              [attachment.id]: result.accessUrl,
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

  function startNewChat() {
    if (sending) return;
    const chat = newChat();
    setChats((previous) => [chat, ...previous].slice(0, HISTORY_LIMIT));
    setActiveChatId(chat.id);
    setDraft("");
    setNotice("");
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectChat(chatId: string) {
    if (sending) controllerRef.current?.abort();
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setNotice("");
  }

  function deleteChat(chatId: string) {
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

  function saveChatRename(chatId: string) {
    const title = renameDraft.trim().slice(0, 60);
    if (title) updateChat(chatId, (chat) => ({ ...chat, title }));
    setEditingChatId(null);
    setRenameDraft("");
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
    if (!user || !content || sending) return;
    if (content.length > MESSAGE_MAX_LENGTH) {
      setNotice(`Messages must be ${MESSAGE_MAX_LENGTH.toLocaleString()} characters or fewer.`);
      return;
    }

    let chat = chats.find((item) => item.id === activeChatId);
    if (!chat) {
      chat = newChat();
      setActiveChatId(chat.id);
    }

    const conversation = [...chat.messages];
    if (regenerate && conversation.at(-1)?.role === "assistant") conversation.pop();
    const message = regenerate ? null : newMessage("user", content);
    const assistantMessage = newMessage("assistant");
    const nextMessages = [
      ...conversation,
      ...(message ? [message] : []),
      assistantMessage,
    ].slice(-MESSAGE_LIMIT);
    const title =
      chat.title === "New chat" && message
        ? content.slice(0, 60).replace(/\s+\S*$/, "").trim() || content.slice(0, 60)
        : chat.title;
    const initialChat: Chat = {
      ...chat,
      title,
      updatedAt: Date.now(),
      messages: nextMessages,
    };

    setChats((previous) => [
      initialChat,
      ...previous.filter((item) => item.id !== initialChat.id),
    ].slice(0, HISTORY_LIMIT));
    setActiveChatId(initialChat.id);
    setDraft("");
    setNotice("");
    setSending(true);

    const requestMessages = [
      ...conversation,
      ...(message ? [message] : []),
    ]
      .slice(-MESSAGE_LIMIT)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    let requestLength = requestMessages.reduce((total, item) => total + item.content.length, 0);
    while (requestLength > 36_000 && requestMessages.length > 1) {
      requestLength -= requestMessages.shift()?.content.length ?? 0;
    }
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: requestMessages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const errorMessage =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "object" &&
          result.error !== null &&
          "message" in result.error &&
          typeof result.error.message === "string"
            ? result.error.message
            : "The assistant couldn’t respond. Please try again.";
        throw new Error(errorMessage);
      }
      if (!response.body) throw new Error("The assistant returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      let streamDone = false;

      function handleEventLine(line: string) {
        if (!line.startsWith("data:")) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          if (payload === "[DONE]") streamDone = true;
          return;
        }
        try {
          const event: unknown = JSON.parse(payload);
          if (typeof event !== "object" || event === null) return;
          if (
            "error" in event &&
            typeof event.error === "object" &&
            event.error !== null &&
            "message" in event.error &&
            typeof event.error.message === "string"
          ) {
            streamError = "The model stream stopped unexpectedly. Please try again.";
            return;
          }
          if (!("choices" in event) || !Array.isArray(event.choices)) return;
          const delta = event.choices[0];
          if (
            typeof delta !== "object" ||
            delta === null ||
            !("delta" in delta) ||
            typeof delta.delta !== "object" ||
            delta.delta === null ||
            !("content" in delta.delta) ||
            typeof delta.delta.content !== "string"
          ) {
            return;
          }
          const textDelta = delta.delta.content;
          if (!textDelta) return;
          updateChat(initialChat.id, (current) => ({
            ...current,
            updatedAt: Date.now(),
            messages: current.messages.map((item) =>
              item.id === assistantMessage.id
                ? { ...item, content: item.content + textDelta }
                : item,
            ),
          }));
        } catch {
          streamError = "The assistant returned a response we couldn’t read.";
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleEventLine(line.trimEnd());
        if (done) break;
      }
      if (buffer) handleEventLine(buffer.trimEnd());
      if (streamError) throw new Error(streamError);
      if (!streamDone && !controller.signal.aborted) {
        updateChat(initialChat.id, (current) => ({
          ...current,
          messages: current.messages.map((item) =>
            item.id === assistantMessage.id && !item.content
              ? { ...item, content: "The response ended before any text arrived. Please try again." }
              : item,
          ),
        }));
      }
    } catch (sendError) {
      if (sendError instanceof Error && sendError.name === "AbortError") {
        setNotice("Response stopped.");
      } else {
        const messageText =
          sendError instanceof Error
            ? sendError.message
            : "The assistant couldn’t respond. Please try again.";
        updateChat(initialChat.id, (current) => {
          const hasResponse = current.messages.some(
            (item) => item.id === assistantMessage.id && item.content,
          );
          return {
            ...current,
            messages: hasResponse
              ? current.messages
              : current.messages.filter((item) => item.id !== assistantMessage.id),
          };
        });
        setNotice(messageText);
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
      const saved = localStorage.getItem(getHistoryKey(user.uid));
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      const history = Array.isArray(parsed) ? parsed.filter(isChat) : [];
      setChats(history.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, HISTORY_LIMIT));
      setActiveChatId(history[0]?.id ?? null);
      setHistoryLoaded(true);
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
              {search ? "No chats match your search." : "Your conversations will appear here."}
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
          <form className="chat-composer" onSubmit={handleSubmit}>
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
                  : "Shift + Enter for a new line"}
              </span>
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
                  disabled={!draft.trim()}
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
