/*
 * Odesoftami QA Monitor — local screenshot store (v3.1.0)
 *
 * Screenshots are opt-in, never uploaded, and live in IndexedDB so they do
 * not consume chrome.storage.local quota. Metadata is indexed by session.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'odesoftami-qa';
  const DB_VERSION = 1;
  const STORE = 'screenshots';
  const MAX_ENTRIES = 20;
  const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
  const MAX_ITEM_BYTES = 2.5 * 1024 * 1024;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this context.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open screenshot storage.'));
      request.onblocked = () => reject(new Error('Screenshot storage is blocked by another tab.'));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  function transaction(mode, action) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Screenshot storage transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('Screenshot storage transaction was aborted.'));
      try {
        result = action(tx.objectStore(STORE), tx);
      } catch (error) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(error);
      }
    }));
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  async function listEntries() {
    return transaction('readonly', (store) => requestToPromise(store.getAll()));
  }

  async function prune() {
    const entries = await listEntries();
    entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    let total = entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
    const remove = [];
    while (entries.length - remove.length > MAX_ENTRIES || total > MAX_TOTAL_BYTES) {
      const oldest = entries[remove.length];
      if (!oldest) break;
      total -= Number(oldest.bytes) || 0;
      remove.push(oldest.id);
    }
    for (const id of remove) {
      await deleteById(id);
    }
    return remove.length;
  }

  async function put(record) {
    if (!record || typeof record.dataUrl !== 'string' || !record.dataUrl.startsWith('data:image/')) {
      throw new Error('Invalid screenshot data.');
    }
    const bytes = Math.ceil(record.dataUrl.length * 0.75);
    if (bytes > MAX_ITEM_BYTES) throw new Error('Screenshot is too large to store.');
    await prune();
    const entry = {
      id: record.id || 'shot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      sessionId: String(record.sessionId || ''),
      eventId: record.eventId || null,
      timestamp: record.timestamp || new Date().toISOString(),
      url: String(record.url || '').slice(0, 2048),
      dataUrl: record.dataUrl,
      bytes
    };
    await transaction('readwrite', (store) => store.put(entry));
    return { ...entry, dataUrl: undefined, bytes };
  }

  async function listBySession(sessionId) {
    const all = await listEntries();
    return all
      .filter((entry) => entry.sessionId === String(sessionId))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .map((entry) => ({
        id: entry.id,
        sessionId: entry.sessionId,
        eventId: entry.eventId,
        timestamp: entry.timestamp,
        url: entry.url,
        bytes: entry.bytes
      }));
  }

  async function getById(id) {
    return transaction('readonly', (store) => requestToPromise(store.get(id)));
  }

  async function deleteById(id) {
    return transaction('readwrite', (store) => requestToPromise(store.delete(id)));
  }

  async function deleteBySession(sessionId) {
    const entries = await listBySession(sessionId);
    for (const entry of entries) await deleteById(entry.id);
    return entries.length;
  }

  async function clearAll() {
    return transaction('readwrite', (store) => requestToPromise(store.clear()));
  }

  async function usage() {
    const entries = await listEntries();
    return {
      count: entries.length,
      bytes: entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0),
      maxEntries: MAX_ENTRIES,
      maxBytes: MAX_TOTAL_BYTES
    };
  }

  root.OdesScreenshots = {
    put, listBySession, getById, deleteById, deleteBySession, clearAll, usage,
    MAX_ENTRIES, MAX_TOTAL_BYTES, MAX_ITEM_BYTES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OdesScreenshots;
})(typeof self !== 'undefined' ? self : globalThis);
