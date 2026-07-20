import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { cleanText } from '../utils/tracks';
import { api } from '../api';
import { toggleSaved, isSaved } from '../utils/collections';
import { toast } from '../utils/toast';
import { WindowControls } from './WindowControls';

export function Topbar({ onSearch, activeView, onNavigate, resetToken, canGoBack, canGoForward, onBack, onForward }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  // Suppresses the dropdown re-open after a search or selection
  const justSearchedRef = useRef(false);
  // Holds the exact bar query that was last searched — suppresses suggestions
  // for it until the user types something different.
  const lastSearchedQueryRef = useRef('');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search when navigating to search view
  useEffect(() => {
    if (activeView === 'search' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeView]);

  // Clear the box when App resets the search (opening Search fresh via the nav),
  // so the bar matches the landing page instead of keeping the last query.
  useEffect(() => {
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    lastSearchedQueryRef.current = '';
    justSearchedRef.current = false;
  }, [resetToken]);

  // Fetch suggestions dynamically
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    // If user just submitted a search or clicked a suggestion, don't re-show.
    // Two guards: the transient flag AND a comparison against the last searched
    // query value (robust across the async fetch boundary — a stale in-flight
    // request can't re-open the dropdown for a query we already searched).
    if (justSearchedRef.current) {
      justSearchedRef.current = false;
      return;
    }
    if (query === lastSearchedQueryRef.current) {
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.getSuggestions(query, 6);
        // A search may have been triggered (or completed) while this request was
        // in flight — if so, don't pop the dropdown back open.
        if (justSearchedRef.current || query === lastSearchedQueryRef.current) return;
        // Decode HTML entities (&quot; etc.) once at the source so both the
        // dropdown display and the suggestion-click search use clean text.
        setSuggestions((data.suggestions || []).map(s => ({
          ...s,
          title: cleanText(s.title),
          artist: cleanText(s.artist),
        })));
        setShowDropdown(true);
      } catch (err) {
        console.error("Failed to fetch suggestions", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      doSearch(query);
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  // A pasted Spotify playlist/album link is an IMPORT, not a text search —
  // resolve it to playable tracks, save it to the library, and open Library.
  const importSpotify = async (url) => {
    toast('Importing from Spotify…');
    try {
      const res = await api.importSpotify(url);
      if (res?.error || !res?.tracks?.length) {
        toast(res?.error || 'Could not import that Spotify link');
        return;
      }
      if (!isSaved({ url })) {
        toggleSaved({
          type: 'jsplaylist',
          name: res.name,
          image: res.image,
          url,
          subtitle: `${res.matched} songs`,
          tracks: res.tracks,
        });
      }
      toast(`Imported “${res.name}” — ${res.matched} of ${res.total} songs`);
      onNavigate?.('library');
    } catch {
      toast('Could not import that Spotify link');
    }
  };

  // Centralized search trigger — used by Enter, suggestion click, and the button
  const doSearch = (q) => {
    const term = (q ?? query).trim();
    if (!term) return;
    justSearchedRef.current = true;
    lastSearchedQueryRef.current = query; // suppress suggestions for this bar value
    setShowDropdown(false);
    setSuggestions([]);
    inputRef.current?.blur();
    if (/open\.spotify\.com\/(intl-[a-z]+\/)?(playlist|album)\//.test(term) || /^spotify:(playlist|album):/.test(term)) {
      setQuery('');
      importSpotify(term);
      return;
    }
    // A single TRACK link: resolve it to "title artist" and run a normal
    // search — pasting a song link used to text-search the raw URL and return
    // garbage results named after the URL itself.
    if (/open\.spotify\.com\/(intl-[a-z]+\/)?track\//.test(term) || /^spotify:track:/.test(term)) {
      toast('Looking that song up…');
      api.importSpotify(term).then((res) => {
        const t = res?.tracks?.[0];
        const q = t ? `${t.title} ${t.artist}` : res?.name;
        if (q) { setQuery(q); onSearch(q); }
        else toast('Could not read that Spotify link');
      }).catch(() => toast('Could not read that Spotify link'));
      return;
    }
    onSearch(term);
  };

  const selectSuggestion = (sug) => {
    justSearchedRef.current = true;
    lastSearchedQueryRef.current = sug.title; // bar will show the title
    setQuery(sug.title);
    setShowDropdown(false);
    setSuggestions([]);
    inputRef.current?.blur();
    // Search with both title and artist for better results, but only show title in search bar
    onSearch(`${sug.title} ${sug.artist}`);
  };

  // Back/forward are driven by the app-level browser History API (single source
  // of truth) — see App.jsx. The arrows simply trigger window.history navigation.
  const goBack = onBack;
  const goForward = onForward;

  return (
    <div data-tauri-drag-region className="h-16 flex items-center gap-4 px-4 bg-transparent sticky top-0 z-40">
      {/* Navigation Arrows — fixed-width side so the search stays centered */}
      <div className="flex items-center gap-2 w-[140px] shrink-0">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center disabled:opacity-30 hover:bg-black/60 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center disabled:opacity-30 hover:bg-black/60 transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Center: Home button + Search — Spotify's current desktop layout */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
      <button
        onClick={() => onNavigate('home')}
        title="Home"
        className={`w-11 h-11 shrink-0 rounded-full bg-spotify-elevated-base hover:bg-spotify-elevated-highlight flex items-center justify-center transition-all hover:scale-105 ${activeView === 'home' ? 'text-white' : 'text-spotify-text-subdued hover:text-white'}`}
        aria-label="Home"
      >
        <Home className="w-5 h-5" fill={activeView === 'home' ? 'currentColor' : 'none'} />
      </button>
      <div className="w-full max-w-[440px] relative" ref={dropdownRef}>
        <div className="relative group">
          <button
            onClick={() => doSearch(query)}
            disabled={!query.trim()}
            title="Search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-spotify-text-subdued group-focus-within:text-white hover:text-white transition-colors disabled:cursor-default disabled:hover:text-spotify-text-subdued z-10"
          >
            <Search className="w-5 h-5" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              justSearchedRef.current = false;
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (activeView !== 'search') onNavigate('search');
              if (query.length >= 2 && suggestions.length > 0 && !justSearchedRef.current) {
                setShowDropdown(true);
              }
            }}
            placeholder="What do you want to play?"
            className="w-full bg-spotify-elevated-base hover:bg-spotify-elevated-highlight focus:bg-spotify-elevated-highlight border-none rounded-full py-3 pl-10 pr-10 text-sm text-white placeholder-spotify-text-subdued focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
          />
          {query && (
            <button 
              onClick={() => { setQuery(''); setSuggestions([]); setShowDropdown(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-spotify-text-subdued hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Live Suggestions Dropdown */}
        {showDropdown && (query.length >= 2) && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-spotify-elevated-base rounded-xl border border-spotify-elevated-highlight shadow-2xl overflow-hidden z-50">
            {loading ? (
              <div className="p-4 flex items-center justify-center text-spotify-text-subdued">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : suggestions.length > 0 ? (
              <ul className="py-1">
                {suggestions.map((sug, idx) => (
                  <li 
                    key={idx}
                    onClick={() => selectSuggestion(sug)}
                    className="px-4 py-2.5 hover:bg-spotify-elevated-highlight cursor-pointer flex items-center gap-3 transition-colors"
                  >
                    <Search className="w-4 h-4 text-spotify-text-subdued shrink-0" />
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm font-medium text-white truncate">{sug.title}</span>
                      <span className="text-xs text-spotify-text-subdued truncate">{sug.artist}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-center text-sm text-spotify-text-subdued">
                No suggestions found
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Right spacer mirrors the left arrows' width so the search bar sits
          dead-center; the fixed WindowControls overlay this area. */}
      <div className="w-[140px] shrink-0" />

      {/* Window Controls — fixed at absolute top-right of window */}
      <WindowControls />
    </div>
  );
}
