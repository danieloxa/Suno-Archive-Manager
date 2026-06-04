// SAM — Chrome Offscreen Document
// Assembles the ZIP with ID3-tagged MP3s and embedded cover art.

'use strict';

// ID3Writer and JSZip are loaded via offscreen.html script tags

function sanitizeFilename(name) {
  return (name || 'untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Parse "Artist - Track Name" or return title as-is
function parseTitle(raw) {
  const idx = raw.indexOf(' - ');
  if (idx > 0) {
    return {
      artist: raw.slice(0, idx).trim(),
      title:  raw.slice(idx + 3).trim(),
    };
  }
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
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

async function assembleZip(songs) {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().split('T')[0];
  const folderName = `SAM_${dateStr}`;
  const root        = zip.folder(folderName);
  const audioFolder = root.folder('audio');
  const coversFolder = root.folder('covers');

  const metadata = [];
  const total = songs.length;

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    chrome.runtime.sendMessage({ type: 'ZIP_PROGRESS', percent: Math.round((i / total) * 90), current: i, total });

    const ext      = getExtension(song.audio_url);
    const safeName = sanitizeFilename(song.title) + '_' + song.id.slice(0, 8);
    const audioFilename = `${safeName}.${ext}`;
    const coverFilename = `${safeName}.jpg`;

    // ── Fetch cover ──────────────────────────────────────────────────────
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

    // ── Fetch audio ──────────────────────────────────────────────────────
    if (song.audio_url) {
      try {
        const r = await fetch(song.audio_url);
        if (r.ok) {
          let audioBuffer = await r.arrayBuffer();

          // Embed ID3 tags for MP3 only (M4A uses a different atom format)
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

              if (song.tags) {
                tags.genre = song.tags.split(',')[0].trim();
              }
              if (song.prompt) {
                // Truncate long prompts to keep the tag size sane
                tags.comment = song.prompt.slice(0, 500);
              }

              audioBuffer = ID3Writer.write(audioBuffer, tags);
            } catch (e) {
              console.warn('[AM] ID3 tagging failed:', song.id, e.message);
              // Fall through — still add the untagged audio
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

  chrome.runtime.sendMessage({ type: 'ZIP_PROGRESS', percent: 95, current: total, total });

  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    chrome.runtime.sendMessage({
      type: 'ZIP_PROGRESS',
      percent: 95 + Math.round(meta.percent * 0.05),
      current: total, total,
    });
  });

  const url      = URL.createObjectURL(blob);
  const filename = `SAM_${dateStr}.zip`;
  chrome.runtime.sendMessage({ type: 'ZIP_READY', url, filename });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ASSEMBLE_ZIP') {
    assembleZip(msg.songs).catch(err => {
      console.error('[AM Offscreen] ZIP error:', err);
      chrome.runtime.sendMessage({ type: 'ZIP_ERROR', message: String(err) });
    });
  }
});
