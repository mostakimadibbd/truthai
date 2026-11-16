"use client";

import type { User } from "firebase/auth";

/** Call one of this panel's own API routes with the admin's ID
 * token attached. The routes proxy to the backend server-side;
 * the browser never learns the backend's address. */
export async function panelApi(
  user: User,
  path: string,
  init: { method: string; body?: Record<string, unknown> } = { method: "GET" },
): Promise<Response> {
  const idToken = await user.getIdToken();
  return fetch(path, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}

export async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return payload.error?.message || fallback;
  } catch {
    return fallback;
  }
}
