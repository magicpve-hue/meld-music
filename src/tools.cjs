const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { run } = require('./core.cjs');
const manifest = require('./tool-manifest.json');

class Tools extends EventEmitter {
  constructor(directory) { super(); this.directory = directory; this.installing = false; this.progress = null; }
  specs() {
    const specs = manifest.platforms[`${process.platform}-${process.arch}`];
    if (!specs) throw new Error('Эта сборка поддерживает macOS Apple Silicon и Windows x64.');
    return specs;
  }
  bin(name) { return path.join(this.directory, this.specs()[name].filename); }
  ready() {
    try {
      const stamp = JSON.parse(fs.readFileSync(path.join(this.directory, 'installed.json'), 'utf8'));
      return stamp.generated === manifest.generated && ['spotdl', 'ytdlp', 'ffmpeg', 'ffprobe', 'deno'].every(n => fs.existsSync(this.bin(n)));
    } catch { return false; }
  }
  env() {
    // All tool caches stay inside Meld's directory, including spotDL's config.
    const home = path.join(this.directory, 'home'); fs.mkdirSync(home, { recursive: true });
    const result = { PATH: this.directory + path.delimiter + process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), DENO_DIR: path.join(home, '.deno') };
    return result;
  }
  status() { return { ready: this.ready(), installing: this.installing, progress: this.progress, versions: Object.fromEntries(Object.entries(this.specs()).map(([k, v]) => [k, v.version])) }; }
  async install() {
    if (this.installing) throw new Error('Установка уже идёт.');
    this.installing = true; fs.mkdirSync(this.directory, { recursive: true });
    const temp = path.join(this.directory, 'install-' + crypto.randomUUID()); fs.mkdirSync(temp);
    const report = value => { this.progress = value; this.emit('progress', this.status()); };
    try {
      const specs = Object.entries(this.specs());
      let index = 0;
      for (const [name, spec] of specs) {
        const file = path.join(temp, name + (spec.archive ? '.zip' : '.bin'));
        report({ name, percent: 0, step: index + 1, total: specs.length });
        const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
        if (!response.ok || !response.body) throw new Error(`Не удалось скачать ${name}: HTTP ${response.status}`);
        const hash = crypto.createHash('sha256'); let received = 0, last = 0;
        const meter = new Transform({ transform(chunk, _encoding, callback) {
          hash.update(chunk); received += chunk.length;
          if (Date.now() - last > 250) { report({ name, percent: Math.min(99, Math.round(received / spec.size * 100)), step: index + 1, total: specs.length }); last = Date.now(); }
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file, { flags: 'wx' }));
        if (hash.digest('hex') !== spec.sha256) throw new Error(`Контрольная сумма ${name} не совпала. Файл не будет запущен.`);
        if (spec.archive) {
          const dest = path.join(temp, 'extracted'); fs.mkdirSync(dest);
          if (process.platform === 'win32') {
            const quote = s => "'" + s.replace(/'/g, "''") + "'";
            await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(dest)}`]);
          } else await run('/usr/bin/ditto', ['-x', '-k', file, dest]);
          await fsp.rename(path.join(dest, spec.filename), path.join(temp, spec.filename));
        } else await fsp.rename(file, path.join(temp, spec.filename));
        if (!name.endsWith('License')) await fsp.chmod(path.join(temp, spec.filename), 0o755);
        index++;
      }
      // Validate executables before marking the installation ready.
      for (const name of ['spotdl', 'ytdlp', 'ffmpeg', 'ffprobe', 'deno']) {
        const spec = this.specs()[name];
        await run(path.join(temp, spec.filename), [name.startsWith('ff') ? '-version' : '--version'], { env: { PATH: temp + path.delimiter + process.env.PATH, ...this.env() }, timeout: 90000 });
      }
      for (const spec of Object.values(this.specs())) {
        const target = path.join(this.directory, spec.filename);
        if (fs.existsSync(target)) await fsp.rm(target);
        await fsp.rename(path.join(temp, spec.filename), target);
      }
      await fsp.writeFile(path.join(this.directory, 'installed.json'), JSON.stringify({ generated: manifest.generated }));
      report({ name: 'Готово', percent: 100, step: specs.length, total: specs.length });
      this.installing = false;
      return this.status();
    } finally { this.installing = false; await fsp.rm(temp, { recursive: true, force: true }); this.emit('progress', this.status()); }
  }
}
module.exports = { Tools };
