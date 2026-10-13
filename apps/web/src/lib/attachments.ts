"use client";
import { API_URL, getToken } from "./api";

/**
 * AP2 chat attachments — the client uploads the raw file; the
 * server extracts text (documents) or describes it (images) and
 * returns exactly the text the assistant will see. That payload
 * rides with the next send and is stored on the user message.
 */
export interface ChatAttachment {
  name: string;
  kind: "file" | "image";
  text: string;
  truncated: boolean;
}

export const ATTACHMENT_ACCEPT = ".txt,.md,.csv,.pdf,.docx,.jpg,.jpeg,.png,.webp";

export async function uploadChatAttachment(orgId: string, file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/organizations/${orgId}/ai/chat/attachments`, {
    method: "POST",
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    // Surface the server's honest message (unsupported type,
    // vision unavailable, scanned PDF…) verbatim.
    let message = `আপলোড ব্যর্থ হয়েছে (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = String(body.message);
    } catch { /* keep the fallback */ }
    throw new Error(message);
  }
  return (await res.json()) as ChatAttachment;
}
