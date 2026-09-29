import { supabase } from "@/integrations/supabase/client";

export function backendUrl(path: string): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "");
  const baseUrl = configured || "https://ai-hiring-orchestrator-1.onrender.com";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function backendAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
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
