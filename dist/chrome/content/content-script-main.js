// SAM — MAIN world content script (Chrome)
// Patches window.fetch to capture songs, drives auto-scroll.

(function () {
  'use strict';

  if (window.__archiveMasterMain) return;
  window.__archiveMasterMain = true;

  // Capture true original fetch ONCE — never re-capture after patching
  // or re-attaching, otherwise wrapping window.fetch again causes infinite recursion.
  const trueFetch = window.fetch;

  let capturedIds = new Set();

  // ── Helpers ──────────────────────────────────────────────────────────────
  function findSongs(obj) {
    let found = [];
    if (!obj || typeof obj !== 'object') return found;
    if (obj.id && (obj.audio_url || obj.metadata?.audio_url)) return [obj];
    if (Array.isArray(obj)) {
      obj.forEach(i => { found = found.concat(findSongs(i)); });
    } else {
      Object.keys(obj).forEach(k => {
        if (k !== 'metadata' && typeof obj[k] === 'object') {
          found = found.concat(findSongs(obj[k]));
        }
      });
    }
    return found;
  }

  function normalizeSong(raw) {
    return {
      id:           raw.id,
      title:        raw.title || 'Untitled',
      audio_url:    raw.audio_url  || raw.metadata?.audio_url  || '',
      image_url:    raw.image_url  || raw.image_large_url || raw.metadata?.image_url || '',
      tags:         raw.metadata?.tags   || raw.tags   || '',
      prompt:       raw.metadata?.prompt || raw.prompt || '',
      created_at:   raw.created_at || '',
      display_name: raw.display_name || raw.user_display_name ||
                    raw.profiles?.display_name || raw.handle || '',
    };
  }

  function toExt(msg) {
    window.postMessage({ __am: true, ...msg }, '*');
  }

  // Updated whenever new songs arrive — adaptive scroll watches this
  let lastSongArrival = 0;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Fetch interceptor ────────────────────────────────────────────────────
  function attachInterceptor() {
    window.fetch = async function (...args) {
      const [resource] = args;
      const url = resource instanceof Request ? resource.url : String(resource);

      if (/(statsig|segment|stratovibe|sentry|rgstr|pixel)/i.test(url)) {
        return new Response('{}', { status: 200 });
      }

      try {
        const response = await trueFetch.apply(this, args);
        response.clone().json().then(data => {
          const raw = findSongs(data);
          if (!raw.length) return;
          const newSongs = [];
          for (const r of raw) {
            if (r.id && !capturedIds.has(r.id)) {
              capturedIds.add(r.id);
              newSongs.push(normalizeSong(r));
            }
          }
          if (newSongs.length) {
            lastSongArrival = Date.now();
            toExt({ type: 'SONGS', songs: newSongs });
          }
        }).catch(() => {});
        return response;
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }

  // SPA re-attach — always delegates to trueFetch so no recursion risk
  const origPush = history.pushState;
  history.pushState = function (...args) { origPush.apply(this, args); attachInterceptor(); };
  window.addEventListener('popstate', () => attachInterceptor());

  // ── Scroll ────────────────────────────────────────────────────────────────
  // Scroll as fast as possible — the fetch interceptor captures inbound data
  // passively at whatever rate Suno delivers it. We just need to keep
  // triggering the infinite-scroll loader. Done when no new songs have
  // arrived for IDLE_DONE_MS while sitting at the bottom.

  const SCROLL_INTERVAL_MS = 400;
  const IDLE_DONE_MS       = 5000; // no new songs + at bottom = complete

  let scrollInterval = null;

  function startScroll() {
    if (scrollInterval) return;
    lastSongArrival = Date.now();

    scrollInterval = setInterval(() => {
      window.scrollTo(0, document.body.scrollHeight);

      const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 200;
      const idleSince = Date.now() - lastSongArrival;

      if (atBottom && idleSince >= IDLE_DONE_MS) {
        stopScroll();
        toExt({ type: 'SCROLL_COMPLETE' });
      }
    }, SCROLL_INTERVAL_MS);
  }

  function stopScroll() {
    if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
  }

  // ── Commands from bridge ─────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.__am) return;
    if (e.data.type === 'START_SCROLL') startScroll();
    else if (e.data.type === 'STOP_SCROLL') stopScroll();
  });

  attachInterceptor();
})();
