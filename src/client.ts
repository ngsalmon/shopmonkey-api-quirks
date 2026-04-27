import 'dotenv/config';

const BASE_URL = process.env.SHOPMONKEY_BASE_URL ?? 'https://api.shopmonkey.cloud/v3';
const API_KEY = process.env.SHOPMONKEY_API_KEY;
const DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? '250');

if (!API_KEY) {
  throw new Error('SHOPMONKEY_API_KEY is not set. Copy .env.example to .env and add your API key.');
}

let lastCallAt = 0;

async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS - elapsed));
  lastCallAt = Date.now();
}

export interface ListMeta {
  total?: number;
  hasMore?: boolean;
  skip?: number;
  limit?: number;
  [k: string]: unknown;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
  success?: boolean;
}

export interface RequestRecord {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  status: number;
  durationMs: number;
  responseSummary: {
    dataLength?: number;
    metaTotal?: number;
    metaHasMore?: boolean;
    [k: string]: unknown;
  };
}

const requestLog: RequestRecord[] = [];

export function getRequestLog(): RequestRecord[] {
  return requestLog;
}

export function clearRequestLog(): void {
  requestLog.length = 0;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

export async function call<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  await pace();
  const method = opts.method ?? 'GET';
  const url = new URL(BASE_URL + path);
  const querySnapshot: Record<string, string> = {};
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      const s = String(v);
      url.searchParams.set(k, s);
      querySnapshot[k] = s;
    }
  }
  const start = Date.now();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const durationMs = Date.now() - start;
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  const summary: RequestRecord['responseSummary'] = {};
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.data)) summary.dataLength = (o.data as unknown[]).length;
    const meta = o.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
      if (typeof meta.total === 'number') summary.metaTotal = meta.total;
      if (typeof meta.hasMore === 'boolean') summary.metaHasMore = meta.hasMore;
    }
  }
  requestLog.push({
    method,
    path,
    query: Object.keys(querySnapshot).length ? querySnapshot : undefined,
    body: opts.body,
    status: res.status,
    durationMs,
    responseSummary: summary,
  });
  if (!res.ok) {
    throw new Error(`Shopmonkey API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return parsed as T;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  const intersect = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : intersect.size / union.size;
}
