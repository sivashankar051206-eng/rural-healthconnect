/**
 * API client.
 * - Session lives in an HttpOnly cookie (never readable by JS, never in localStorage).
 * - CSRF token is echoed from the readable rhc_csrf cookie on every state-changing request.
 * - Timeouts + network events drive the "Internet connection is weak" banner.
 * - Nothing here decides authorization: the backend enforces it on every call.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type NetState = 'ok' | 'weak' | 'offline';
const netListeners = new Set<(s: NetState) => void>();
let netState: NetState = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'ok';

function setNet(s: NetState) {
  if (s === netState) return;
  netState = s;
  netListeners.forEach((l) => l(s));
}
export function onNetworkChange(l: (s: NetState) => void) {
  netListeners.add(l);
  l(netState);
  return () => netListeners.delete(l);
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setNet('offline'));
  window.addEventListener('online', () => setNet('ok'));
}

export const authEvents = new EventTarget();

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)rhc_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const SLOW_MS = 6000;

async function raw(path: string, opts: Options = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  const slow = setTimeout(() => setNet('weak'), SLOW_MS);
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  try {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: isForm ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    setNet('ok');
    return res;
  } catch {
    setNet(navigator.onLine ? 'weak' : 'offline');
    throw new ApiError(0, 'NETWORK', 'Internet connection is weak.');
  } finally {
    clearTimeout(timeout);
    clearTimeout(slow);
  }
}

async function toError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  if (res.status === 401) authEvents.dispatchEvent(new Event('unauthorized'));
  return new ApiError(
    res.status,
    data?.error?.code ?? 'ERROR',
    data?.error?.message ?? 'Something went wrong. Please try again.',
    data?.error?.details,
  );
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await raw(path, opts);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches a protected file as a Blob (used for reports; never exposes a storage URL). */
export async function requestBlob(path: string): Promise<Blob> {
  const res = await raw(path, { timeoutMs: 60_000 });
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown, headers?: Record<string, string>) => request<T>(p, { method: 'POST', body: body ?? {}, headers }),
  put: <T>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: body ?? {} }),
  patch: <T>(p: string, body?: unknown) => request<T>(p, { method: 'PATCH', body: body ?? {} }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  upload: <T>(p: string, form: FormData) => request<T>(p, { method: 'POST', body: form, timeoutMs: 120_000 }),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
