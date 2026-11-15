import type { User } from "firebase/auth";

export class OpdRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function opdRequest<T>(user: User, apiUrl: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new OpdRequestError(response.status, body?.error ?? `The request failed (HTTP ${response.status}).`);
  }
  return response.json();
}
