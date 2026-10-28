const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

function audioResponse(file, range, method = 'GET') {
  if (!fs.existsSync(file)) return new Response('Файл не найден', { status: 404 });
  const size = fs.statSync(file).size;
  const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.aac': 'audio/aac' };
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(method === 'HEAD' || !size ? null : Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}
module.exports = { audioResponse };
