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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import FirebasePresence from "@/components/firebase-presence";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/auth-client";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

type AuthState = "loading" | "not-configured" | "signed-out" | "unverified" | "ready";

const HISTORY_LIMIT = 20;
const MESSAGE_LIMIT = 30;
const MESSAGE_MAX_LENGTH = 12_000;

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
  };
}

function newMessage(role: Message["role"], content = ""): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
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
  name: "menu" | "plus" | "search" | "send" | "stop" | "copy" | "trash" | "close" | "spark";
  size?: number;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
    send: <><path d="m21 3-7.5 18-3.8-7.7L2 9.5 21 3Z" /><path d="M9.7 13.3 14 9" /></>,
    stop: <><rect x="5" y="5" width="14" height="14" rx="3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
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
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const activeMessages = activeChat?.messages ?? [];

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthState("not-configured");
      return;
    }

    return onAuthStateChanged(getFirebaseAuth(), (currentUser) => {
      if (!currentUser) {
        setAuthState("signed-out");
        router.replace("/sign-in");
        return;
      }

      setUser(currentUser);
      if (!currentUser.emailVerified) {
        setAuthState("unverified");
        return;
      }

      setAuthState("ready");
      try {
        const saved = localStorage.getItem(getHistoryKey(currentUser.uid));
        const parsed: unknown = saved ? JSON.parse(saved) : [];
        const history = Array.isArray(parsed) ? parsed.filter(isChat) : [];
        const orderedHistory = history
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, HISTORY_LIMIT);
        setChats(orderedHistory);
        setActiveChatId(orderedHistory[0]?.id ?? null);
      } catch {
        setChats([]);
        setActiveChatId(null);
        setNotice("This browser’s saved chat history couldn’t be read.");
      }
      setHistoryLoaded(true);
    });
  }, [router]);

  useEffect(() => {
    if (!user || !historyLoaded || authState !== "ready") return;
    try {
      localStorage.setItem(
        getHistoryKey(user.uid),
        JSON.stringify(chats.slice(0, HISTORY_LIMIT)),
      );
    } catch {
      setNotice("This browser couldn’t save your chat history. Check available storage.");
    }
  }, [authState, chats, historyLoaded, user]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [draft]);

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
      } else if (event.key === "Escape" && sending) {
        controllerRef.current?.abort();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [sending]);

  const visibleChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    return chats.filter((chat) => !query || chat.title.toLowerCase().includes(query));
  }, [chats, search]);

  const updateChat = useCallback((chatId: string, update: (chat: Chat) => Chat) => {
    setChats((previous) =>
      previous.map((chat) => (chat.id === chatId ? update(chat) : chat))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, HISTORY_LIMIT),
    );
  }, []);

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
    if (activeChatId === chatId) {
      const nextChat = chats.find((chat) => chat.id !== chatId);
      setActiveChatId(nextChat?.id ?? null);
    }
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
      setCopyMessage(message.id);
      window.setTimeout(() => setCopyMessage(""), 1500);
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
    <div className="chat-app">
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
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => setSidebarOpen(false)}
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
                  <button type="button" onClick={() => selectChat(chat.id)}>
                    <span>{chat.title}</span>
                  </button>
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
          <label className="chat-model-picker">
            <span className="chat-model-dot" />
            <select aria-label="AI model" value="openrouter/free" disabled>
              <option value="openrouter/free">Auto · Free models</option>
            </select>
            <span className="chat-model-chevron" aria-hidden="true">⌄</span>
          </label>
          <Link className="chat-topbar-link" href="/help">Help</Link>
        </header>

        <div className={`chat-conversation${activeMessages.length ? " chat-conversation-has-messages" : ""}`}>
          {activeMessages.length === 0 ? (
            <section className="chat-empty-state">
              <span className="chat-empty-mark"><Icon name="spark" size={25} /></span>
              <p className="chat-empty-eyebrow">Your AI workspace</p>
              <h1>What would you like to explore?</h1>
              <p className="chat-empty-description">
                Ask a question, work through an idea, or get a first draft. Start with a prompt below.
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
                          title={copyMessage === message.id ? "Copied" : "Copy"}
                          onClick={() => void copyMessage(message)}
                        >
                          <Icon name="copy" size={15} />
                          <span>{copyMessage === message.id ? "Copied" : "Copy"}</span>
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
