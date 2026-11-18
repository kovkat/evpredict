// Звернення до серверної частини з перевіркою типу відповіді:
// якщо API недоступний і сервер повернув HTML, користувач бачить зрозуміле повідомлення.
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export async function apiFetch<T>(path: string, init?: Omit<RequestInit, "body"> & { json?: unknown }): Promise<T> {
  const hasJson = init?.json !== undefined;
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api${path}`, {
      ...init,
      credentials: "include",
      method: init?.method ?? (hasJson ? "POST" : "GET"),
      headers: { ...(hasJson ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      body: hasJson ? JSON.stringify(init!.json) : undefined,
    });
  } catch {
    throw new ApiError("Сервер EVPredict недоступний. Перевірте з'єднання і спробуйте ще раз.");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ApiError("Сервер EVPredict тимчасово недоступний.", response.status);
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(typeof payload?.error === "string" ? payload.error : "Запит не виконано.", response.status);
  }
  return payload as T;
}
