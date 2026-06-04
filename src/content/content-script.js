// Archive Master — Content Script
// Runs in MAIN world to patch window.fetch on suno.com

(function () {
  'use strict';

  let capturedIds = new Set();
  let scrollInterval = null;
  let interceptorAttached = false;

  // ── Sanitize filename (ported from reference downloadUtils.ts) ──────────────
  function sanitizeFilename(name) {
    return (name || 'untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  // ── Recursive song finder (ported exactly from reference InputSection.tsx) ──
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

  // ── Map raw API song object to our canonical shape ─────────────────────────
  function normalizeSong(raw) {
    const audioUrl = raw.audio_url || raw.metadata?.audio_url || '';
    const imageUrl = raw.image_url || raw.image_large_url || raw.metadata?.image_url || '';
    const tags = raw.metadata?.tags || raw.tags || '';
    const prompt = raw.metadata?.prompt || raw.prompt || '';
    return {
      id: raw.id,
      title: raw.title || 'Untitled',
      audio_url: audioUrl,
      image_url: imageUrl,
      tags,
      prompt,
      created_at: raw.created_at || '',
    };
  }

  // ── Attach fetch interceptor ───────────────────────────────────────────────
  function attachInterceptor() {
    if (interceptorAttached) return;
    interceptorAttached = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const [resource] = args;
      const url = resource instanceof Request ? resource.url : String(resource);

      // Block analytics noise
      if (/(statsig|segment|stratovibe|sentry|rgstr|pixel)/i.test(url)) {
        return new Response('{}', { status: 200 });
      }

      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();

        clone.json().then(data => {
          const raw = findSongs(data);
          if (raw.length === 0) return;

          const newSongs = [];
          for (const r of raw) {
            if (r.id && !capturedIds.has(r.id)) {
              capturedIds.add(r.id);
              newSongs.push(normalizeSong(r));
            }
          }
          if (newSongs.length > 0) {
            chrome.runtime.sendMessage({ type: 'ADD_SONGS', songs: newSongs });
          }
        }).catch(() => {});

        return response;
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }

  // ── Re-attach on SPA navigation ────────────────────────────────────────────
  function reattachInterceptor() {
    interceptorAttached = false;
    attachInterceptor();
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    reattachInterceptor();
  };
  window.addEventListener('popstate', reattachInterceptor);

  // ── Scroll detection ───────────────────────────────────────────────────────
  function checkScrollBottom() {
    const nearBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
    if (nearBottom) {
      chrome.runtime.sendMessage({ type: 'SCROLL_COMPLETE' });
    }
  }

  // ── Message listener from popup/background ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_SCROLL') {
      if (scrollInterval) clearInterval(scrollInterval);
      scrollInterval = setInterval(() => {
        window.scrollTo(0, document.body.scrollHeight);
        checkScrollBottom();
      }, 2500);
      sendResponse({ ok: true });
    } else if (msg.type === 'STOP_SCROLL') {
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'PING') {
      sendResponse({ ok: true });
    }
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  attachInterceptor();
})();
