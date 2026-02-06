type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

function joinUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  token: string | null
): Promise<T> {
  const url = joinUrl(API_URL, path);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Json) : null;

  if (!res.ok) {
    const msg = typeof json === 'object' && json && 'error' in json ? String((json as any).error) : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }

  return json as T;
}

export function apiGet<T>(path: string, token: string | null): Promise<T> {
  return request<T>(path, { method: 'GET' }, token);
}

export function apiPost<T>(
  path: string,
  body: Record<string, unknown>,
  token: string | null
): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    token
  );
}
