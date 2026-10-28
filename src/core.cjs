const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const AUDIO = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.opus', '.aac']);
async function cleanup(dir) {
  // Windows may hold transcoder output handles briefly after taskkill.
  // A failed cleanup must not lose the completed/failed job state.
  try { await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* retry by OS/user cleanup; original audio is never removed */ }
}
function parseSource(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Введите ссылку Spotify или SoundCloud.');
  let u;
  try { u = new URL(input.trim()); } catch { throw new Error('Нужна полная ссылка, начинающаяся с https://'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Поддерживаются обычные HTTPS-ссылки без паролей и портов.');
  if (u.hostname === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/);
    if (!m) throw new Error('Нужна ссылка на трек, альбом или плейлист Spotify.');
    return { provider: 'spotify', url: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  if (['soundcloud.com', 'www.soundcloud.com'].includes(u.hostname)) {
    if (!/^\/[^/]+\/[^/]+/.test(u.pathname) || u.pathname.length > 500) throw new Error('Нужна ссылка на трек или плейлист SoundCloud.');
    // Preserve private-track secret tokens, but drop tracking parameters.
    const secret = u.searchParams.get('secret_token');
    return { provider: 'soundcloud', url: `https://soundcloud.com${u.pathname}${secret ? '?secret_token=' + encodeURIComponent(secret) : ''}` };
  }
  throw new Error('Поддерживаются ссылки open.spotify.com и soundcloud.com. Короткую ссылку сначала откройте в браузере.');
}

function run(command, args, { env, signal, onLine = () => {}, timeout = 120000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const child = spawn(command, args, { env: { ...process.env, ...env, PYTHONUNBUFFERED: '1', NO_COLOR: '1' }, cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    const secrets = args.flatMap((arg, i) => ['--client-secret', '--auth-token'].includes(arg) ? [args[i + 1]] : []).filter(Boolean);
    const redact = value => secrets.reduce((s, secret) => s.split(secret).join('[скрыто]'), String(value));
    const killTree = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
    };
    const abort = () => killTree();
    signal?.addEventListener('abort', abort, { once: true });
    let out = '', tail = '', pending = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { killTree(); finish(new Error('Источник не ответил вовремя. Попробуйте ещё раз.')); }, timeout);
    child.stdout.on('data', data => { out += data; if (out.length > 32000000) { killTree(); finish(new Error('Ответ источника слишком большой.')); } });
    const log = data => {
      tail = redact(tail + data).slice(-12000);
      pending += data;
      const lines = pending.split(/[\r\n]/); pending = lines.pop();
      lines.forEach(line => onLine(redact(line.replace(/\u001b\[[0-9;]*m/g, '')).slice(-1500)));
    };
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.on('error', err => finish(err));
    child.on('close', code => {
      if (pending) onLine(redact(pending));
      if (code === 0) finish(null, out);
      else finish(new Error(tail.trim().slice(-2500) || `Процесс завершился с кодом ${code}.`));
    });
  });
}

function friendlyError(error) {
  const s = String(error?.message || error);
  if (/abort/i.test(s)) return 'Загрузка отменена.';
  if (/429|rate.limit|too many requests/i.test(s)) return 'Источник временно ограничил запросы. Повторите позже.';
  if (/sign in|bot|captcha/i.test(s)) return 'Источник запросил вход или проверку. Эта загрузка сейчас недоступна.';
  if (/403|forbidden|geo|not available in your country/i.test(s)) return 'Источник ограничил доступ к записи или она недоступна в вашем регионе.';
  if (/401|invalid.client|invalid.grant|access.token/i.test(s)) return 'Spotify отклонил доступ. В настройках можно указать собственные Client ID и Client Secret.';
  if (/no results|couldn.t find|no matching|song not found|no audio/i.test(s)) return 'Подходящая аудиозапись не найдена. Попробуйте прямую ссылку SoundCloud.';
  return s.slice(-1600);
}

// Optional argument prefix lets tests run fixture scripts through Node on every OS.
function runTool(tools, name, args, options) {
  return run(tools.bin(name), [...(tools.prefixArgs?.(name) || []), ...args], options);
}

class Library extends EventEmitter {
  constructor(directory, tools) {
    super(); this.dir = directory; this.tools = tools; this.active = null; this.imports = new Map(); this.pumping = false;
    fs.mkdirSync(path.join(directory, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'jobs'), { recursive: true });
    this.file = path.join(directory, 'library.json');
    this.state = { version: 1, tracks: [], jobs: [], settings: { autoDownload: false } };
    if (fs.existsSync(this.file)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (loaded.version !== 1 || !Array.isArray(loaded.tracks) || !Array.isArray(loaded.jobs)) throw new Error('Неверная версия библиотеки');
        this.state = { ...this.state, ...loaded };
      } catch (error) {
        fs.copyFileSync(this.file, this.file + `.recovery-${Date.now()}`);
        this.recoveryWarning = 'Файл библиотеки повреждён. Сохранена резервная копия; аудиофайлы остались на диске.';
      }
    }
    for (const job of this.state.jobs) if (['running', 'queued'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Приложение закрыто до завершения. Можно повторить загрузку.'; }
    this.save();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2)); fs.renameSync(tmp, this.file);
    this.emit('change', this.snapshot());
  }
  snapshot() {
    return { ...this.state, tracks: this.state.tracks.map(({ file, ...track }) => ({ ...track, available: !!file && fs.existsSync(file), mediaUrl: file ? `meld://audio/${track.id}` : null })), recoveryWarning: this.recoveryWarning };
  }
  track(id) { const track = this.state.tracks.find(t => t.id === id); if (!track) throw new Error('Трек не найден.'); return track; }
  addTracks(tracks) {
    if (this.state.tracks.length + tracks.length > 50000) throw new Error('Лимит библиотеки — 50 000 треков.');
    let added = 0;
    for (const track of tracks) {
      if (this.state.tracks.some(t => t.sourceUrl === track.sourceUrl)) continue;
      this.state.tracks.push({ id: crypto.randomUUID(), addedAt: Date.now(), favorite: false, ...track }); added++;
    }
    this.save(); return added;
  }
  addLocal(files) {
    const tracks = [];
    for (const file of files) {
      if (!AUDIO.has(path.extname(file).toLowerCase()) || !fs.statSync(file).isFile()) continue;
      const id = crypto.randomUUID();
      const target = path.join(this.dir, 'audio', id + path.extname(file).toLowerCase());
      const sourceUrl = 'local:' + path.resolve(file);
      if (this.state.tracks.some(t => t.sourceUrl === sourceUrl)) continue;
      fs.copyFileSync(file, target);
      const name = path.basename(file, path.extname(file));
      const [artist, ...title] = name.split(' - ');
      tracks.push({ id, title: title.length ? title.join(' - ') : name, artist: title.length ? artist : 'Локальная коллекция', provider: 'local', audioSource: 'local', sourceUrl, file: target, duration: 0 });
    }
    return this.addTracks(tracks);
  }
  async importUrl(input, credentials = {}) {
    const { provider, url } = parseSource(input);
    if (!this.tools.ready()) throw new Error('Сначала установите движки в настройках приложения.');
    const key = crypto.randomUUID(); const controller = new AbortController(); this.imports.set(key, controller);
    const dir = path.join(this.dir, 'jobs', key); fs.mkdirSync(dir, { recursive: true });
    const log = line => this.emit('activity', { type: 'import', line });
    try {
      let tracks;
      if (provider === 'spotify') {
        const target = path.join(dir, 'metadata.spotdl');
        await runTool(this.tools, 'spotdl', ['save', url, '--save-file', target, '--threads', '1', ...this.spotifyArgs(credentials)], { env: this.tools.env(), signal: controller.signal, onLine: log, timeout: 180000, cwd: dir });
        const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
        const songs = Array.isArray(raw) ? raw : raw.songs;
        if (!Array.isArray(songs)) throw new Error('Источник вернул неизвестный формат списка песен.');
        tracks = songs.map(s => ({ title: s.name || s.title || 'Без названия', artist: (s.artists || []).map(a => typeof a === 'string' ? a : a.name).join(', ') || s.artist || 'Неизвестный исполнитель', duration: Number(s.duration) || 0, artwork: s.cover_url || null, sourceUrl: parseSource(s.url || `https://open.spotify.com/track/${s.song_id}`).url, provider, audioSource: 'youtube' }));
      } else {
        const raw = await runTool(this.tools, 'ytdlp', ['--ignore-config', '--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings', '--playlist-end', '500', '--', url], { env: this.tools.env(), signal: controller.signal, timeout: 180000, cwd: dir });
        const data = JSON.parse(raw); const entries = data.entries || [data];
        tracks = entries.filter(Boolean).map(s => ({ title: s.title || 'Без названия', artist: s.uploader || s.channel || data.uploader || 'SoundCloud', duration: Number(s.duration) || 0, artwork: s.thumbnail || s.thumbnails?.at(-1)?.url || null, sourceUrl: parseSource(s.webpage_url || s.url || url).url, provider, audioSource: 'soundcloud' }));
      }
      const added = this.addTracks(tracks);
      return { added, total: tracks.length };
    } catch (error) { throw new Error(friendlyError(error)); }
    finally { this.imports.delete(key); await cleanup(dir); }
  }
  spotifyArgs(credentials) {
    return credentials.clientId && credentials.clientSecret ? ['--use-official-api', '--client-id', credentials.clientId, '--client-secret', credentials.clientSecret] : [];
  }
  enqueue(ids) {
    if (!Array.isArray(ids) || ids.length > 1000) throw new Error('За раз можно добавить до 1000 треков.');
    if (!this.tools.ready()) throw new Error('Сначала установите движки.');
    for (const id of new Set(ids)) {
      const t = this.track(id);
      if (t.file && fs.existsSync(t.file) || this.state.jobs.some(j => j.trackId === id && ['queued', 'running'].includes(j.status))) continue;
      this.state.jobs.unshift({ id: crypto.randomUUID(), trackId: id, status: 'queued', progress: 0, createdAt: Date.now(), log: '' });
    }
    this.save(); this.pump(); return this.snapshot();
  }
  async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      let job;
      // New jobs are inserted at the front; execute in FIFO order.
      while ((job = [...this.state.jobs].reverse().find(j => j.status === 'queued'))) {
        const controller = new AbortController(); this.active = { id: job.id, controller };
        const track = this.track(job.trackId); const dir = path.join(this.dir, 'jobs', job.id);
        fs.mkdirSync(dir, { recursive: true }); job.status = 'running'; this.save();
        let lastUpdate = 0;
        const onLine = line => {
          if (job.status !== 'running') return;
          const percentage = line.match(/(\d+(?:\.\d+)?)%/);
          if (percentage) job.progress = Math.min(99, Number(percentage[1]));
          job.log = line.slice(-1000);
          if (Date.now() - lastUpdate > 350) { lastUpdate = Date.now(); this.emit('change', this.snapshot()); }
        };
        try {
          const output = path.join(dir, 'audio.%(ext)s');
          if (track.provider === 'spotify') {
            const creds = this.getCredentials ? this.getCredentials() : {};
            await runTool(this.tools, 'spotdl', ['download', track.sourceUrl, '--output', path.join(dir, 'audio.{output-ext}'), '--format', 'mp3', '--threads', '1', '--ffmpeg', this.tools.bin('ffmpeg'), '--lyrics', ...this.spotifyArgs(creds)], { env: this.tools.env(), signal: controller.signal, onLine, timeout: 600000, cwd: dir });
          } else {
            await runTool(this.tools, 'ytdlp', ['--ignore-config', '--no-playlist', '--no-warnings', '--newline', '--extract-audio', '--audio-format', 'mp3', '--ffmpeg-location', this.tools.directory, '--output', output, '--', track.sourceUrl], { env: this.tools.env(), signal: controller.signal, onLine, timeout: 600000, cwd: dir });
          }
          if (controller.signal.aborted) throw new Error('aborted');
          const file = fs.readdirSync(dir).find(name => AUDIO.has(path.extname(name)) && fs.statSync(path.join(dir, name)).size > 0);
          if (!file) throw new Error('Источник не создал аудиофайл. Откройте журнал загрузки.');
          const probe = JSON.parse(await runTool(this.tools, 'ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', path.join(dir, file)], { env: this.tools.env(), signal: controller.signal, timeout: 30000 }));
          if (!probe.streams?.some(s => s.codec_type === 'audio')) throw new Error('В загруженном файле нет аудиодорожки.');
          if (Number(probe.format?.duration) > 0) track.duration = Number(probe.format.duration);
          const target = path.join(this.dir, 'audio', track.id + path.extname(file));
          fs.renameSync(path.join(dir, file), target); track.file = target;
          job.status = 'done'; job.progress = 100; job.log = 'Сохранено в библиотеку';
        } catch (error) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = friendlyError(error); }
        finally { await cleanup(dir); this.active = null; this.save(); }
      }
    } finally { this.pumping = false; }
  }
  cancel(id) {
    const job = this.state.jobs.find(j => j.id === id); if (!job) throw new Error('Загрузка не найдена.');
    if (job.status === 'queued') job.status = 'cancelled';
    if (this.active?.id === id) this.active.controller.abort();
    this.save();
  }
  favorite(id) { const t = this.track(id); t.favorite = !t.favorite; this.save(); }
  remove(id) {
    if (this.state.jobs.some(j => j.trackId === id && ['running', 'queued'].includes(j.status))) throw new Error('Сначала отмените загрузку этого трека.');
    // Only remove the library entry. Existing audio is never silently deleted.
    this.state.tracks = this.state.tracks.filter(t => t.id !== id);
    this.state.jobs = this.state.jobs.filter(j => j.trackId !== id); this.save();
  }
  shutdown() { this.active?.controller.abort(); for (const c of this.imports.values()) c.abort(); }
}
module.exports = { Library, parseSource, run, AUDIO, friendlyError };
