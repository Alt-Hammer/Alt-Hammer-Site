// src/pages/api/list/_store.ts
//
// Storage behind the short share links (/r/<id>). Shared by the POST and GET routes.
//
// Ids are content-addressed: the id IS a prefix of the SHA-256 of the payload. That
// makes sharing idempotent — the same list always yields the same link, so re-sharing
// costs no extra storage and a link stays stable across re-shares — and it means a
// collision is detectable by comparing the stored bytes.
//
// Files under src/pages/ whose name starts with "_" are not routed by Astro, so this
// module sits next to the routes it serves without becoming an endpoint itself.

import { getStore } from '@netlify/blobs';

/** Ninety days, as agreed: a share link stops resolving this long after it was made. */
export const TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Roughly 1 KB per list today; this is a sanity bound, not a target. */
export const MAX_PAYLOAD = 64 * 1024;

/** Id lengths tried in order. 10 base64url chars is 60 bits — ample, and short. */
const ID_LENGTHS = [10, 14, 18, 26, 43];

const STORE_NAME = 'list-shares';

/** The share token format produced by public/js/list-share.js. */
const TOKEN_RE = /^v1u?\.[a-z0-9-]*\.[A-Za-z0-9_-]+$/;

export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 &&
         token.length <= MAX_PAYLOAD && TOKEN_RE.test(token);
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url of arbitrary bytes, unpadded — matches the client's alphabet. */
function b64url(bytes: Uint8Array): string {
  let out = '', i = 0, n: number;
  for (; i + 2 < bytes.length; i += 3) {
    n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) { n = bytes[i] << 16; out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]; }
  else if (rem === 2) {
    n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

async function fullHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return b64url(new Uint8Array(digest));
}

export interface StoredMeta { createdAt: number }

/**
 * Store a payload and return its id. Idempotent: an identical payload returns the id it
 * already had, with its ninety days restarted, so re-sharing an unchanged list both
 * keeps the same link and keeps it alive.
 */
export async function put(token: string): Promise<string> {
  const s = store();
  const hash = await fullHash(token);

  for (const len of ID_LENGTHS) {
    const id = hash.slice(0, len);
    const existing = await s.getWithMetadata(id, { type: 'text' });

    if (existing && existing.data === token) {
      // Same list already here — restart the clock and reuse the link.
      await s.set(id, token, { metadata: { createdAt: Date.now() } });
      return id;
    }
    if (existing) continue;                 // a different list holds this id: lengthen

    await s.set(id, token, { metadata: { createdAt: Date.now() } });
    return id;
  }
  // Two different payloads sharing a full SHA-256 prefix is not a real scenario; if it
  // ever happened we would rather fail loudly than serve someone else's list.
  throw new Error('could not allocate a share id');
}

export type GetResult =
  | { status: 'ok'; token: string }
  | { status: 'missing' }
  | { status: 'expired' };

export async function get(id: string): Promise<GetResult> {
  const entry = await store().getWithMetadata(id, { type: 'text' });
  if (!entry || typeof entry.data !== 'string') return { status: 'missing' };

  const createdAt = Number((entry.metadata as unknown as StoredMeta)?.createdAt ?? 0);
  // A record written before metadata existed, or with a damaged timestamp, is treated
  // as current rather than silently unreachable.
  if (createdAt > 0 && Date.now() - createdAt > TTL_MS) return { status: 'expired' };

  return { status: 'ok', token: entry.data };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}
