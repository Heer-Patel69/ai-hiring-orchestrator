import { supabase } from "@/integrations/supabase/client";

export function backendUrl(path: string): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "");
  const baseUrl = configured || "https://ai-hiring-orchestrator-1.onrender.com";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function backendAuthHeaders(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;

  // Refresh if token is missing or expiring within 60 seconds
  if (!token || (data.session?.expires_at && data.session.expires_at * 1000 - Date.now() < 60000)) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token || token;
  }

  if (!token) throw new Error("You must be signed in to use this service");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-request-id": crypto.randomUUID(),
  };
}

export async function invokeBackend<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(backendUrl(path), {
    method: "POST",
    headers: await backendAuthHeaders(),
    signal,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Backend request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}
