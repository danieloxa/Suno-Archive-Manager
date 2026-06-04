// SAM — Isolated-world bridge (Chrome)

'use strict';

function runtimeOk() {
  return !!(chrome.runtime?.id);
}

// MAIN world → background / popup
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.__am) return;
  if (!runtimeOk()) return;

  const { type } = e.data;
  if (type === 'SONGS') {
    chrome.runtime.sendMessage({ type: 'ADD_SONGS', songs: e.data.songs }).catch(() => {});
  } else if (type === 'SCROLL_COMPLETE') {
    chrome.runtime.sendMessage({ type: 'SCROLL_COMPLETE' }).catch(() => {});
  }
});

// Background / popup → MAIN world
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SCROLL' || msg.type === 'STOP_SCROLL') {
    window.postMessage({ __am: true, type: msg.type }, '*');
    sendResponse({ ok: true });
  } else if (msg.type === 'PING') {
    sendResponse({ ok: true });
  }
  return true;
});
