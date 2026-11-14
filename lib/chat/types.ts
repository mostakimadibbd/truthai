export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  accessUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  status?: "generating" | "complete" | "stopped" | "failed";
};

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
  searchText: string;
  messages: ChatMessage[];
};
