/**
 * list-share.js — encodes a Countermarch army list into a shareable link.
 *
 * No server and no storage: the whole list travels in the URL fragment. The payload
 * is only what the player CHOSE (see LB.exportState) — never resolved points, stats
 * or wargear, all of which the receiving page recomputes from the faction data it
 * loads anyway. That keeps the link proportional to the decisions in the list rather
 * than to the size of the rules.
 *
 * Wire format:  v1.<faction-slug>.<base64url>
 *               v1u.<faction-slug>.<base64url>   (uncompressed fallback)
 *
 * The faction slug rides in cleartext so a reader can start fetching that faction's
 * JSON before it has decompressed anything. `v1` covers the key dictionary below;
 * bump it only for a breaking change to that mapping.
 *
 * Exposes window.AH_SHARE. Depends on nothing.
 */
(function () {
  'use strict';

  var G = (typeof globalThis !== 'undefined') ? globalThis : window;
  var VERSION = 'v1';

  // Fixed key dictionary. Deflate already collapses repetition, but shortening the
  // structural keys shrinks the pre-compression JSON that the long tail of unique
  // clause ids and option refs sits inside.
  var TOP = { listName: 'n', faction: 'f', targetPoints: 'p',
              detachmentTraitsSelected: 'd', detachmentTraitChoices: 'D',
              selectedUnits: 'u' };
  var UNIT = { unitName: 'N', modelCounts: 'c', tier: 't', isWarlord: 'w', squadronHost: 'h',
               sel: 's', keyChar: 'k', gifts: 'g', relic: 'r', nested: 'e',
               instanceCount: 'i', subRelic: 'b', dup: 'x' };
  var TOP_R = _invert(TOP), UNIT_R = _invert(UNIT);
  function _invert(m) { var o = {}; Object.keys(m).forEach(function (k) { o[m[k]] = k; }); return o; }
  function _rename(obj, map) {
    var o = {};
    Object.keys(obj || {}).forEach(function (k) { if (map[k] !== undefined) o[map[k]] = obj[k]; });
    return o;
  }

  function pack(state) {
    var t = _rename(state, TOP);
    t[TOP.selectedUnits] = (state.selectedUnits || []).map(function (u) { return _rename(u, UNIT); });
    return t;
  }
  function unpack(packed) {
    var s = _rename(packed, TOP_R);
    s.selectedUnits = (packed[TOP.selectedUnits] || []).map(function (u) { return _rename(u, UNIT_R); });
    return s;
  }

  // ── base64url (no padding, URL-safe, no btoa/Buffer dependency) ──────────────
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_R = null;
  function b64encode(bytes) {
    var out = '', i = 0, n;
    for (; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) { n = bytes[i] << 16; out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]; }
    else if (rem === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
    }
    return out;
  }
  function b64decode(str) {
    if (!B64_R) { B64_R = {}; for (var k = 0; k < 64; k++) B64_R[B64[k]] = k; }
    var bytes = [], i = 0, n, len = str.length;
    for (; i + 3 < len; i += 4) {
      n = (B64_R[str[i]] << 18) | (B64_R[str[i + 1]] << 12) | (B64_R[str[i + 2]] << 6) | B64_R[str[i + 3]];
      bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
    var rem = len - i;
    if (rem === 2) { n = (B64_R[str[i]] << 18) | (B64_R[str[i + 1]] << 12); bytes.push((n >> 16) & 255); }
    else if (rem === 3) {
      n = (B64_R[str[i]] << 18) | (B64_R[str[i + 1]] << 12) | (B64_R[str[i + 2]] << 6);
      bytes.push((n >> 16) & 255, (n >> 8) & 255);
    }
    return new Uint8Array(bytes);
  }

  // ── deflate-raw via the platform's own streams (no library) ──────────────────
  function _hasCompression() {
    return typeof G.CompressionStream !== 'undefined' && typeof G.Response !== 'undefined' &&
           typeof G.Blob !== 'undefined';
  }
  function _deflate(str) {
    if (!_hasCompression()) return Promise.resolve(null);
    try {
      var stream = new G.Blob([new G.TextEncoder().encode(str)]).stream()
        .pipeThrough(new G.CompressionStream('deflate-raw'));
      return new G.Response(stream).arrayBuffer()
        .then(function (b) { return new Uint8Array(b); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function _inflate(bytes) {
    try {
      var stream = new G.Blob([bytes]).stream()
        .pipeThrough(new G.DecompressionStream('deflate-raw'));
      return new G.Response(stream).arrayBuffer()
        .then(function (b) { return new G.TextDecoder().decode(b); });
    } catch (e) { return Promise.reject(e); }
  }
  function _utf8ToBytes(str) { return new G.TextEncoder().encode(str); }
  function _bytesToUtf8(bytes) { return new G.TextDecoder().decode(bytes); }

  // ── public API ───────────────────────────────────────────────────────────────

  /** state (from LB.exportState) → Promise<string> share token. */
  function encode(state) {
    var json = JSON.stringify(pack(state));
    var faction = state.faction || '';
    return _deflate(json).then(function (bytes) {
      if (bytes) return VERSION + '.' + faction + '.' + b64encode(bytes);
      return VERSION + 'u.' + faction + '.' + b64encode(_utf8ToBytes(json));
    });
  }

  /** share token → Promise<state>. Rejects on anything malformed. */
  function decode(token) {
    var parts = String(token || '').split('.');
    if (parts.length < 3) return Promise.reject(new Error('not a list link'));
    var ver = parts[0], payload = parts.slice(2).join('.');
    var bytes;
    try { bytes = b64decode(payload); }
    catch (e) { return Promise.reject(new Error('link is damaged')); }

    var text;
    if (ver === VERSION) text = _inflate(bytes);
    else if (ver === VERSION + 'u') text = Promise.resolve(_bytesToUtf8(bytes));
    else return Promise.reject(new Error('link was made by a newer version of the list builder'));

    return text.then(function (json) {
      var obj;
      try { obj = JSON.parse(json); }
      catch (e) { throw new Error('link is damaged'); }
      return unpack(obj);
    }, function () { throw new Error('link is damaged'); });
  }

  /** The faction slug, readable without decompressing (so its data can load first). */
  function factionOf(token) {
    var parts = String(token || '').split('.');
    return parts.length >= 3 ? parts[1] : null;
  }

  /** Absolute URL for a page, carrying the list in the fragment. */
  function buildUrl(path, state) {
    return encode(state).then(function (token) {
      var base = G.location ? (G.location.origin + path) : path;
      return base + '#d=' + token;
    });
  }

  /** The share token in the current URL, or null. Fragment first, then query. */
  function readToken() {
    if (!G.location) return null;
    var m = /[#&]d=([^&]+)/.exec(G.location.hash || '');
    if (m) return decodeURIComponent(m[1]);
    m = /[?&]d=([^&]+)/.exec(G.location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ── Short links ──────────────────────────────────────────────────────────────
  // A full-length link is self-contained but far too long to paste anywhere social,
  // so the payload can instead be parked server-side under a short content-addressed
  // id (see src/pages/api/list/). The long form keeps working forever: shortening is
  // a lookup in front of the same payload, not a different encoding.

  var API = '/api/list';
  var SHORT_PREFIX = '/r/';

  /** state → Promise<"/r/<id>">. Rejects if the service cannot be reached. */
  function shorten(state) {
    return encode(state).then(function (token) {
      return G.fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token }),
      }).then(function (r) {
        if (!r.ok) throw new Error('could not shorten the link');
        return r.json();
      }).then(function (j) {
        if (!j || !j.id) throw new Error('could not shorten the link');
        return SHORT_PREFIX + j.id;
      });
    });
  }

  /** short id → Promise<token>. Rejects with .expired set when the list has aged out. */
  function expand(id) {
    return G.fetch(API + '?id=' + encodeURIComponent(id)).then(function (r) {
      if (r.ok) return r.json();
      var err = new Error(r.status === 410
        ? 'This shared list has expired.'
        : 'This shared list could not be found.');
      err.expired = r.status === 410;
      err.missing = r.status === 404;
      throw err;
    }).then(function (j) {
      if (!j || !j.token) throw new Error('This shared list could not be read.');
      return j.token;
    });
  }

  /** The short id in the current URL path, or null. */
  function readShortId() {
    if (!G.location) return null;
    var m = /^\/r\/([A-Za-z0-9_-]+)\/?$/.exec(G.location.pathname || '');
    return m ? m[1] : null;
  }

  /**
   * The best link available for a list: short if the service answers, otherwise the
   * full-length one. Never rejects — sharing should not fail because a lookup did.
   * Resolves { url, short }, so the caller can say which kind the user just got.
   */
  function buildShareUrl(path, state) {
    var origin = G.location ? G.location.origin : '';
    return shorten(state).then(function (short) {
      return { url: origin + short, short: true };
    }, function () {
      return buildUrl(path, state).then(function (url) { return { url: url, short: false }; });
    });
  }

  G.AH_SHARE = {
    encode: encode, decode: decode, factionOf: factionOf,
    buildUrl: buildUrl, readToken: readToken,
    shorten: shorten, expand: expand, readShortId: readShortId, buildShareUrl: buildShareUrl,
    pack: pack, unpack: unpack, compressionAvailable: _hasCompression,
  };
})();
