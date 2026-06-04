// Minimal ID3v2.3 tag writer — no dependencies
// Supports: TIT2, TPE1, TPE2, TALB, TCON, TDRC, COMM, APIC

window.ID3Writer = (function () {
  'use strict';

  const enc = new TextEncoder();

  function toSyncsafe(n) {
    const b = new Uint8Array(4);
    for (let i = 3; i >= 0; i--) { b[i] = n & 0x7f; n >>>= 7; }
    return b;
  }

  function uint32BE(n) {
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  function textFrame(id, text) {
    const textBytes = enc.encode(text);
    const data = new Uint8Array(1 + textBytes.length);
    data[0] = 0x03; // UTF-8 encoding
    data.set(textBytes, 1);
    return makeFrame(id, data);
  }

  function commFrame(text, lang) {
    const langBytes = enc.encode((lang || 'eng').slice(0, 3).padEnd(3, '\0'));
    const textBytes = enc.encode(text);
    const data = new Uint8Array(1 + 3 + 1 + textBytes.length);
    let o = 0;
    data[o++] = 0x03;          // UTF-8
    data.set(langBytes, o); o += 3;
    data[o++] = 0x00;          // empty description (null-terminated)
    data.set(textBytes, o);
    return makeFrame('COMM', data);
  }

  function apicFrame(imageBuffer, mimeType) {
    const mime = enc.encode(mimeType || 'image/jpeg');
    const img  = new Uint8Array(imageBuffer);
    const data = new Uint8Array(1 + mime.length + 1 + 1 + 1 + img.length);
    let o = 0;
    data[o++] = 0x00;        // ISO-8859-1 (mime/desc must be Latin-1)
    data.set(mime, o); o += mime.length;
    data[o++] = 0x00;        // null-terminate mime
    data[o++] = 0x03;        // picture type: cover (front)
    data[o++] = 0x00;        // empty description (null-terminated)
    data.set(img, o);
    return makeFrame('APIC', data);
  }

  function makeFrame(id, data) {
    const idBytes = enc.encode(id);
    const frame   = new Uint8Array(10 + data.length);
    frame.set(idBytes);                          // 4-byte frame ID
    frame.set(uint32BE(data.length), 4);         // 4-byte size
    frame[8] = 0x00; frame[9] = 0x00;           // 2-byte flags
    frame.set(data, 10);
    return frame;
  }

  function stripExistingId3(audio) {
    if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
      const size = ((audio[6] & 0x7f) << 21) | ((audio[7] & 0x7f) << 14) |
                   ((audio[8] & 0x7f) << 7)  |  (audio[9] & 0x7f);
      const start = 10 + size + ((audio[5] & 0x10) ? 10 : 0); // skip footer if present
      return audio.subarray(start);
    }
    return audio;
  }

  /**
   * Embed ID3v2.3 tags into an MP3 ArrayBuffer.
   * @param {ArrayBuffer} audioBuffer
   * @param {object} tags
   *   title, artist, albumArtist, album, genre, year, comment,
   *   cover (ArrayBuffer), coverMime (string, default 'image/jpeg')
   * @returns {ArrayBuffer} tagged MP3
   */
  function write(audioBuffer, tags) {
    const frames = [];

    if (tags.title)       frames.push(textFrame('TIT2', tags.title));
    if (tags.artist)      frames.push(textFrame('TPE1', tags.artist));
    if (tags.albumArtist) frames.push(textFrame('TPE2', tags.albumArtist));
    if (tags.album)       frames.push(textFrame('TALB', tags.album));
    if (tags.genre)       frames.push(textFrame('TCON', tags.genre));
    if (tags.year)        frames.push(textFrame('TDRC', String(tags.year)));
    if (tags.comment)     frames.push(commFrame(tags.comment));
    if (tags.cover)       frames.push(apicFrame(tags.cover, tags.coverMime));

    const framesSize = frames.reduce((n, f) => n + f.length, 0);

    // Build ID3 header
    const header = new Uint8Array(10);
    header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // "ID3"
    header[3] = 0x03; header[4] = 0x00;                    // version 2.3.0
    header[5] = 0x00;                                       // no flags
    header.set(toSyncsafe(framesSize), 6);

    // Strip any pre-existing ID3 tag from the audio
    const audio = stripExistingId3(new Uint8Array(audioBuffer));

    // Combine: new header + frames + audio
    const out = new Uint8Array(10 + framesSize + audio.length);
    let o = 0;
    out.set(header, o);  o += 10;
    for (const f of frames) { out.set(f, o); o += f.length; }
    out.set(audio, o);

    return out.buffer;
  }

  return { write };
})();
