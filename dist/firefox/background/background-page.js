// SAM — Firefox MV2 Persistent Background Page
// JSZip and ID3Writer are loaded via manifest background scripts array.

'use strict';

let allSongs = [];

function notifyPopup(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

function sanitizeFilename(name) {
  return (name || 'untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function parseTitle(raw) {
  const idx = raw.indexOf(' - ');
  if (idx > 0) return { artist: raw.slice(0, idx).trim(), title: raw.slice(idx + 3).trim() };
  return { artist: null, title: raw };
}

function getExtension(url) {
  const path = (url || '').split('?')[0];
  const m = path.match(/\.(m4a|mp3|wav|ogg)$/i);
  return m ? m[1].toLowerCase() : 'mp3';
}

function detectCoverMime(buffer) {
  const b = new Uint8Array(buffer, 0, 4);
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  return 'image/jpeg';
}

async function assembleZip(songs) {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().split('T')[0];
  const folderName  = `SAM_${dateStr}`;
  const root        = zip.folder(folderName);
  const audioFolder = root.folder('audio');
  const coversFolder = root.folder('covers');

  const metadata = [];
  const total = songs.length;

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    notifyPopup({ type: 'ZIP_PROGRESS', percent: Math.round((i / total) * 90), current: i, total });

    const ext      = getExtension(song.audio_url);
    const safeName = sanitizeFilename(song.title) + '_' + song.id.slice(0, 8);
    const audioFilename = `${safeName}.${ext}`;
    const coverFilename = `${safeName}.jpg`;

    // ── Cover ────────────────────────────────────────────────────────────
    let coverBuffer = null;
    let coverMime   = 'image/jpeg';
    if (song.image_url) {
      try {
        const r = await fetch(song.image_url);
        if (r.ok) {
          coverBuffer = await r.arrayBuffer();
          coverMime   = detectCoverMime(coverBuffer);
          coversFolder.file(coverFilename, coverBuffer);
        }
      } catch (e) {
        console.warn('[AM] Cover fetch failed:', song.id, e.message);
      }
    }

    // ── Audio ────────────────────────────────────────────────────────────
    if (song.audio_url) {
      try {
        const r = await fetch(song.audio_url);
        if (r.ok) {
          let audioBuffer = await r.arrayBuffer();

          if (ext === 'mp3') {
            try {
              const { artist, title } = parseTitle(song.title);
              const resolvedArtist = artist || song.display_name || null;

              const tags = {
                title:       title,
                artist:      resolvedArtist,
                albumArtist: song.display_name || resolvedArtist,
                album:       'SAM - Suno Archive Manager',
                year:        song.created_at ? new Date(song.created_at).getFullYear() : null,
                cover:       coverBuffer || null,
                coverMime,
              };
              if (song.tags)   tags.genre   = song.tags.split(',')[0].trim();
              if (song.prompt) tags.comment = song.prompt.slice(0, 500);

              audioBuffer = ID3Writer.write(audioBuffer, tags);
            } catch (e) {
              console.warn('[AM] ID3 tagging failed:', song.id, e.message);
            }
          }

          audioFolder.file(audioFilename, audioBuffer);
        }
      } catch (e) {
        console.warn('[AM] Audio fetch failed:', song.id, e.message);
      }
    }

    metadata.push({
      id:           song.id,
      title:        song.title,
      display_name: song.display_name || '',
      audio_file:   `audio/${audioFilename}`,
      cover_file:   song.image_url ? `covers/${coverFilename}` : null,
      tags:         song.tags || '',
      prompt:       song.prompt || '',
      created_at:   song.created_at || '',
      audio_url:    song.audio_url,
      image_url:    song.image_url || '',
    });
  }

  root.file('metadata.json', JSON.stringify(metadata, null, 2));

  notifyPopup({ type: 'ZIP_PROGRESS', percent: 95, current: total, total });

  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    notifyPopup({ type: 'ZIP_PROGRESS', percent: 95 + Math.round(meta.percent * 0.05), current: total, total });
  });

  const url = URL.createObjectURL(blob);
  await browser.downloads.download({ url, filename: `SAM_${dateStr}.zip`, saveAs: false });
  notifyPopup({ type: 'ZIP_DOWNLOAD_STARTED' });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ADD_SONGS') {
    const idSet = new Set(allSongs.map(s => s.id));
    for (const s of msg.songs) {
      if (!idSet.has(s.id)) { idSet.add(s.id); allSongs.push(s); }
    }
    notifyPopup({ type: 'SONGS_UPDATED', count: allSongs.length });
    return Promise.resolve({ ok: true });

  } else if (msg.type === 'GET_SONGS') {
    return Promise.resolve({ songs: allSongs });

  } else if (msg.type === 'CLEAR_SONGS') {
    allSongs = [];
    return Promise.resolve({ ok: true });

  } else if (msg.type === 'SCROLL_COMPLETE') {
    notifyPopup({ type: 'SCROLL_COMPLETE' });
    return Promise.resolve({ ok: true });

  } else if (msg.type === 'EXPORT_ZIP') {
    if (allSongs.length === 0) return Promise.resolve({ error: 'No songs to export' });
    assembleZip(allSongs).catch(err => {
      console.error('[AM BG] ZIP error:', err);
      notifyPopup({ type: 'ZIP_ERROR', message: String(err) });
    });
    return Promise.resolve({ ok: true });
  }
});
