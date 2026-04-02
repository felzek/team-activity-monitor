import { useSessionStore } from "@/store/sessionStore";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly payload?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const csrfToken = useSessionStore.getState().csrfToken;
  const method = (options.method ?? "GET").toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (isMutation && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
