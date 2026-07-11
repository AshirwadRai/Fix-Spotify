// Recent-searches store, backed by localStorage with live propagation.
//
// Mirrors the likes.js / downloads.js pattern: a single source of truth that
// the search landing page subscribes to via useRecentSearches(), updated from
// App.handleSearch so every executed query is remembered (most-recent first,
// de-duped, capped).

import { useState, useEffect } from 'react';

const KEY = 'recentSearches';
const EVENT = 'recentsearchchange';
const MAX = 12;

export function readRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
  } catch {
    return [];
  }
}

function write(arr) {
  try {
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX)));
  } catch { /* storage full / unavailable — ignore */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Record an executed search query (most-recent first, case-insensitive dedup). */
export function addRecentSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  const cur = readRecentSearches();
  write([q, ...cur.filter(s => s.toLowerCase() !== q.toLowerCase())]);
}

export function removeRecentSearch(query) {
  write(readRecentSearches().filter(s => s !== query));
}

export function clearRecentSearches() {
  write([]);
}

/** React hook: live array of recent search strings. */
export function useRecentSearches() {
  const [list, setList] = useState(readRecentSearches);
  useEffect(() => {
    const handler = () => setList(readRecentSearches());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return list;
}
