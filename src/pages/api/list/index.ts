// src/pages/api/list/index.ts — the short-link store behind /r/<id>.
//
//   POST /api/list           { token }  → { id }
//   GET  /api/list?id=<id>              → { token } | 404 | 410 (expired)
//
// The id travels as a query parameter rather than a path segment on purpose. Netlify
// resolves extensionless paths against the static site before invoking the function,
// and appends ".html" when nothing matches — so a route like /api/list/<id> is handed
// to the endpoint as "/api/list/<id>.html", and its id never validates. A query
// parameter is not subject to that rewriting.
//
// Nothing here interprets the list: the payload is opaque, and the roster page decodes
// it exactly as it decodes a full-length link.

import type { APIRoute } from 'astro';
import { isValidToken, isValidId, put, get, json, MAX_PAYLOAD, TTL_MS } from './_store';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!isValidId(id)) return json({ error: 'not a share id' }, 400);

  let result;
  try {
    result = await get(id);
  } catch (err) {
    console.error('[share] could not read list', err);
    return json({ error: 'could not read the list' }, 503);
  }

  if (result.status === 'missing') return json({ error: 'no such shared list' }, 404);
  if (result.status === 'expired') {
    // 410 rather than 404: this id was real, and saying so lets the roster page explain
    // what happened instead of implying the link was mistyped.
    return json({ error: 'this shared list has expired', ttlDays: Math.round(TTL_MS / 86400000) }, 410);
  }

  // A payload is immutable for as long as it exists — the id is a hash of its content —
  // but the record itself expires, so this is capped well below that 90-day life rather
  // than being marked immutable.
  return json({ token: result.token }, 200, {
    'cache-control': 'public, max-age=3600',
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  const token = (body as { token?: unknown } | null)?.token;

  // Rejecting anything that isn't a share token keeps this from becoming general-purpose
  // storage for whatever anyone cares to POST at it.
  if (!isValidToken(token)) {
    return json({ error: `token must be a share token of at most ${MAX_PAYLOAD} bytes` }, 400);
  }

  try {
    const id = await put(token);
    return json({ id });
  } catch (err) {
    console.error('[share] could not store list', err);
    return json({ error: 'could not store the list' }, 503);
  }
};
