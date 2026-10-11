// All URLs are relative ("api/…", no leading slash) so they work behind Home Assistant Ingress.
export interface ApiResult<T> { status: number; body: T }

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const r = await fetch('api/' + path, init);
  let body: unknown = null;
  try { body = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: body as T };
}
export const get = <T,>(path: string) => call<T>(path);
export const send = <T,>(method: 'POST' | 'PUT', path: string, body?: unknown) =>
  call<T>(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
