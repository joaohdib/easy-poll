export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorPayload { error?: unknown }

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { cache: 'no-store', ...options, headers });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const message = isErrorPayload(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível concluir a solicitação.';
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return value !== null && typeof value === 'object';
}
