import type { Metadata } from "next";
import ChatWorkspace from "./chat-workspace";

export const metadata: Metadata = {
  title: "Chat",
  description: "Your Xyro AI chat workspace.",
  robots: { index: false, follow: false },
};

export default function ChatPage() {
  return <ChatWorkspace />;
}
