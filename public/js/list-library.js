/**
 * list-library.js — named army lists saved in localStorage.
 *
 * Deliberately separate from the builder's own persistence. sessionStorage holds the
 * live working draft and is per browser tab, so two tabs can build two different
 * lists at once; this library is the shared, durable shelf those drafts are saved to
 * and loaded from. Loading a saved list replaces the draft in the current tab only.
 *
 * Entries store the same compressed token a share link carries (see list-share.js),
 * so a saved list costs about a kilobyte rather than tens of them — localStorage is
 * a ~5 MB budget shared with everything else on the origin.
 *
 * Exposes window.AH_LIBRARY. Depends on list-share.js.
 */
(function () {
  'use strict';

  var KEY = 'ah-lb-library';
  var MAX_ENTRIES = 100;

  function _read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function _write(entries) {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      return { ok: true };
    } catch (e) {
      // QuotaExceededError, or storage disabled entirely (private mode, blocked cookies)
      var full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      return { ok: false, error: full
        ? 'No room left in this browser’s storage. Delete a saved list and try again.'
        : 'This browser is not allowing local storage, so lists cannot be saved here.' };
    }
  }
  function _id() {
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** Saved lists, most recently saved first. Metadata only — call load() for the state. */
  function list() {
    return _read().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })
      .map(function (e) {
        return { id: e.id, name: e.name, faction: e.faction, factionTitle: e.factionTitle,
                 points: e.points, targetPoints: e.targetPoints, units: e.units, savedAt: e.savedAt };
      });
  }

  function get(id) {
    var all = _read();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /**
   * Save the current list. Pass an existing id to overwrite it (Save), or omit it to
   * create a new entry (Save As). Returns a Promise of { ok, id, error }.
   */
  function save(meta, state, id) {
    return AH_SHARE.encode(state).then(function (blob) {
      var all = _read();
      var entry = {
        id: id || _id(),
        name: meta.name || 'Untitled List',
        faction: meta.faction, factionTitle: meta.factionTitle,
        points: meta.points, targetPoints: meta.targetPoints, units: meta.units,
        savedAt: Date.now(), blob: blob,
      };
      var at = -1;
      for (var i = 0; i < all.length; i++) if (all[i].id === entry.id) { at = i; break; }
      if (at >= 0) all[at] = entry; else all.push(entry);
      if (all.length > MAX_ENTRIES) {
        all.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        all = all.slice(0, MAX_ENTRIES);
      }
      var res = _write(all);
      return res.ok ? { ok: true, id: entry.id } : { ok: false, error: res.error };
    });
  }

  /** Promise of the decoded state for a saved list, or null if it is unreadable. */
  function load(id) {
    var e = get(id);
    if (!e || !e.blob) return Promise.resolve(null);
    return AH_SHARE.decode(e.blob).catch(function () { return null; });
  }

  function rename(id, name) {
    var all = _read();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { all[i].name = String(name || '').slice(0, 120) || 'Untitled List'; break; }
    }
    return _write(all);
  }

  function remove(id) {
    return _write(_read().filter(function (e) { return e.id !== id; }));
  }

  /** Is localStorage usable at all? (Private browsing / blocked storage.) */
  function available() {
    try {
      localStorage.setItem(KEY + ':probe', '1');
      localStorage.removeItem(KEY + ':probe');
      return true;
    } catch (e) { return false; }
  }

  window.AH_LIBRARY = {
    list: list, get: get, save: save, load: load,
    rename: rename, remove: remove, available: available,
  };
})();
