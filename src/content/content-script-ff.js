// SAM — Firefox Content Script (MV2)
// Firefox content scripts run in isolated scope, so we inject a <script> tag
// to patch window.fetch in the page's MAIN world, then bridge via custom events.

'use strict';

// ── Inject page-world script via <script> tag ─────────────────────────────
const pageScript = `
(function() {
  if (window.__archiveMasterAttached) return;
  window.__archiveMasterAttached = true;

  function sanitizeFilename(name) {
    return (name || 'untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  function findSongs(obj) {
    let found = [];
    if (!obj || typeof obj !== 'object') return found;
    if (obj.id && (obj.audio_url || (obj.metadata && obj.metadata.audio_url))) return [obj];
    if (Array.isArray(obj)) {
      obj.forEach(function(i) { found = found.concat(findSongs(i)); });
    } else {
      Object.keys(obj).forEach(function(k) {
        if (k !== 'metadata' && typeof obj[k] === 'object') {
          found = found.concat(findSongs(obj[k]));
        }
      });
    }
    return found;
  }

  function normalizeSong(raw) {
    var audioUrl = raw.audio_url || (raw.metadata && raw.metadata.audio_url) || '';
    var imageUrl = raw.image_url || raw.image_large_url || (raw.metadata && raw.metadata.image_url) || '';
    return {
      id: raw.id,
      title: raw.title || 'Untitled',
      audio_url: audioUrl,
      image_url: imageUrl,
      tags: (raw.metadata && raw.metadata.tags) || raw.tags || '',
      prompt: (raw.metadata && raw.metadata.prompt) || raw.prompt || '',
      created_at: raw.created_at || '',
    };
  }

  var capturedIds = new Set();

  function attachInterceptor() {
    var originalFetch = window.fetch;
    window.fetch = function() {
      var args = Array.prototype.slice.call(arguments);
      var resource = args[0];
      var url = resource instanceof Request ? resource.url : String(resource);

      if (/(statsig|segment|stratovibe|sentry|rgstr|pixel)/i.test(url)) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }

      return originalFetch.apply(this, args).then(function(response) {
        var clone = response.clone();
        clone.json().then(function(data) {
          var raw = findSongs(data);
          if (raw.length === 0) return;
          var newSongs = [];
          raw.forEach(function(r) {
            if (r.id && !capturedIds.has(r.id)) {
              capturedIds.add(r.id);
              newSongs.push(normalizeSong(r));
            }
          });
          if (newSongs.length > 0) {
            window.dispatchEvent(new CustomEvent('__AM_SONGS__', {
              detail: JSON.stringify(newSongs)
            }));
          }
        }).catch(function() {});
        return response;
      });
    };
  }

  // SPA re-attach
  var originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    attachInterceptor();
  };
  window.addEventListener('popstate', function() { attachInterceptor(); });

  // Listen for scroll commands from content script
  window.addEventListener('__AM_CMD__', function(e) {
    var cmd = e.detail;
    if (cmd === 'START_SCROLL') {
      if (window.__amScrollInterval) clearInterval(window.__amScrollInterval);
      window.__amScrollInterval = setInterval(function() {
        window.scrollTo(0, document.body.scrollHeight);
        var nearBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
        if (nearBottom) {
          window.dispatchEvent(new CustomEvent('__AM_SCROLL_DONE__'));
        }
      }, 2500);
    } else if (cmd === 'STOP_SCROLL') {
      if (window.__amScrollInterval) {
        clearInterval(window.__amScrollInterval);
        window.__amScrollInterval = null;
      }
    }
  });

  attachInterceptor();
})();
`;

const scriptEl = document.createElement('script');
scriptEl.textContent = pageScript;
(document.head || document.documentElement).appendChild(scriptEl);
scriptEl.remove();

// ── Bridge: page events → background ─────────────────────────────────────
window.addEventListener('__AM_SONGS__', (e) => {
  try {
    const songs = JSON.parse(e.detail);
    browser.runtime.sendMessage({ type: 'ADD_SONGS', songs }).catch(() => {});
  } catch (_) {}
});

window.addEventListener('__AM_SCROLL_DONE__', () => {
  browser.runtime.sendMessage({ type: 'SCROLL_COMPLETE' }).catch(() => {});
});

// ── Bridge: background → page ─────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SCROLL' || msg.type === 'STOP_SCROLL') {
    window.dispatchEvent(new CustomEvent('__AM_CMD__', { detail: msg.type }));
    sendResponse({ ok: true });
  } else if (msg.type === 'PING') {
    sendResponse({ ok: true });
  }
  return true;
});
