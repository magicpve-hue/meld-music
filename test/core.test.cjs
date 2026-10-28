const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library, parseSource, run } = require('../src/core.cjs');
const { audioResponse } = require('../src/media.cjs');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meld-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const spotify = 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b';
const soundcloud = 'https://soundcloud.com/test/fixture';
function fixtureTools(dir) {
  const bin = path.join(dir, 'tool');
  fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const a=process.argv.slice(2);if(a.includes('-show_entries')){console.log(JSON.stringify({streams:[{codec_type:'audio'}],format:{duration:'5'}}));}else if(a.includes('--dump-single-json')){console.log(JSON.stringify({title:'SC fixture',uploader:'Fixture',webpage_url:'${soundcloud}',duration:5}));}else if(a[0]==='save'){fs.writeFileSync(a[a.indexOf('--save-file')+1],JSON.stringify([{name:'Spotify fixture',artists:['Fixture'],duration:5,url:'${spotify}'}]));}else if(process.env.MELD_TEST_HANG==='1'){setTimeout(()=>{},60000);}else if(process.env.MELD_TEST_FAIL==='1'){console.error('fixture failure');process.exit(1);}else{const p=a[a.indexOf('--output')+1].replace('{output-ext}','mp3').replace('%(ext)s','mp3');fs.writeFileSync(p,Buffer.alloc(100));}\n`, { mode: 0o755 });
  return { directory: dir, ready: () => true, bin: () => process.execPath, prefixArgs: () => [bin], env: () => ({}) };
}
function until(library, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (predicate(library.state)) return resolve();
    const timer = setTimeout(() => { library.off('change', listener); reject(new Error('Timed out waiting for job state')); }, timeout);
    const listener = () => { if (predicate(library.state)) { clearTimeout(timer); library.off('change', listener); resolve(); } };
    library.on('change', listener);
  });
}
test('URL validation rejects unrelated hosts, credentials, ports and unsupported Spotify resources', () => {
  for (const url of ['file:///etc/passwd', 'http://soundcloud.com/a/b', 'https://open.spotify.com.evil.test/track/a', 'https://x:y@soundcloud.com/a/b', 'https://soundcloud.com:81/a/b', 'https://open.spotify.com/artist/0VjIjW4GlUZAMYd2vXMi3b', '--client-secret=oops']) assert.throws(() => parseSource(url));
  assert.equal(parseSource('https://open.spotify.com/intl-ru/track/0VjIjW4GlUZAMYd2vXMi3b?si=tracking').url, spotify);
  assert.equal(parseSource(soundcloud + '?secret_token=s-private&tracking=drop').url, soundcloud + '?secret_token=s-private');
});
test('subprocess receives shell metacharacters literally', async () => {
  const value = '; echo SHOULD_NOT_EXECUTE $(whoami) `whoami`';
  const result = await run(process.execPath, ['-e', 'console.log(process.argv[1])', '--', value]);
  assert.equal(result.trim(), value);
});
test('subprocess redacts client secret in error logs', async () => {
  const lines = [];
  await assert.rejects(run(process.execPath, ['-e', 'console.error(process.argv[2]);process.exit(1)', '--', '--client-secret', 'private-fixture'], { onLine: l => lines.push(l) }), error => !error.message.includes('private-fixture'));
  assert.ok(lines.every(l => !l.includes('private-fixture')));
});
test('byte ranges support seeking, suffix ranges and invalid requests', async t => {
  const file = path.join(temp(t), 'test.mp3'); fs.writeFileSync(file, '0123456789');
  let r = audioResponse(file, 'bytes=3-5'); assert.equal(r.status, 206); assert.equal(await r.text(), '345'); assert.equal(r.headers.get('content-range'), 'bytes 3-5/10');
  assert.equal(await audioResponse(file, 'bytes=-3').text(), '789');
  assert.equal(await audioResponse(file, 'bytes=8-').text(), '89');
  assert.equal(audioResponse(file, 'bytes=99-').status, 416);
  assert.equal(audioResponse(file, 'bytes=6-2').status, 416);
  assert.equal(audioResponse(file, 'bytes=-').status, 416);
  assert.equal(audioResponse(file, null, 'HEAD').body, null);
});
test('local import copies files, deduplicates, persists favorites and preserves audio on removal', t => {
  const dir = temp(t), input = path.join(dir, 'Artist - Song.wav'); fs.writeFileSync(input, 'audio fixture');
  const library = new Library(path.join(dir, 'data'), fixtureTools(dir));
  assert.equal(library.addLocal([input]), 1); assert.equal(library.addLocal([input]), 0);
  const track = library.state.tracks[0]; assert.equal(track.artist, 'Artist'); assert.equal(track.title, 'Song'); assert.notEqual(track.file, input);
  library.favorite(track.id);
  const reopened = new Library(path.join(dir, 'data'), fixtureTools(dir)); assert.equal(reopened.snapshot().tracks[0].favorite, true);
  assert.equal(reopened.snapshot().tracks[0].file, undefined);
  reopened.remove(track.id); assert.ok(fs.existsSync(track.file));
});
test('Spotify and SoundCloud imports normalize metadata and do not download until requested', async t => {
  const dir = temp(t), lib = new Library(path.join(dir, 'data'), fixtureTools(dir));
  assert.equal((await lib.importUrl(spotify)).added, 1); assert.equal((await lib.importUrl(soundcloud)).added, 1);
  assert.deepEqual(lib.state.tracks.map(t => t.audioSource), ['youtube', 'soundcloud']);
  assert.equal(lib.state.jobs.length, 0); assert.ok(lib.snapshot().tracks.every(t => !t.available));
  assert.equal((await lib.importUrl(spotify)).added, 0);
});
test('download queue completes, persists audio and ignores duplicate requests', async t => {
  const dir = temp(t), lib = new Library(path.join(dir, 'data'), fixtureTools(dir));
  await lib.importUrl(spotify); await lib.importUrl(soundcloud);
  const ids = lib.state.tracks.map(t => t.id); lib.enqueue([...ids, ...ids]);
  await until(lib, s => s.jobs.length === 2 && s.jobs.every(j => j.status === 'done'));
  assert.ok(lib.snapshot().tracks.every(t => t.available)); assert.equal(fs.readdirSync(path.join(dir, 'data/jobs')).length, 0);
  lib.enqueue(ids); assert.equal(lib.state.jobs.length, 2);
});
test('failed download can be retried without losing the track', async t => {
  const dir = temp(t), tools = fixtureTools(dir), lib = new Library(path.join(dir, 'data'), tools);
  tools.env = () => ({ MELD_TEST_FAIL: '1' }); await lib.importUrl(spotify); const id = lib.state.tracks[0].id;
  lib.enqueue([id]); await until(lib, s => s.jobs.some(j => j.status === 'failed'));
  tools.env = () => ({}); lib.enqueue([id]); await until(lib, s => s.jobs.some(j => j.status === 'done'));
  assert.equal(lib.state.tracks.length, 1);
});
test('cancel stops active job; queued cancellation does not start a subprocess', async t => {
  const dir = temp(t), tools = fixtureTools(dir), lib = new Library(path.join(dir, 'data'), tools);
  tools.env = () => ({ MELD_TEST_HANG: '1' }); await lib.importUrl(spotify); await lib.importUrl(soundcloud);
  const ids = lib.state.tracks.map(t => t.id); lib.enqueue(ids);
  const running = lib.state.jobs.find(j => j.status === 'running'); const queued = lib.state.jobs.find(j => j.status === 'queued');
  lib.cancel(queued.id); lib.cancel(running.id);
  await until(lib, s => s.jobs.every(j => j.status === 'cancelled'));
  assert.ok(lib.snapshot().tracks.every(t => !t.available));
});
test('restart marks unfinished jobs interrupted, with no silent automatic downloads', t => {
  const dir = temp(t), tools = fixtureTools(dir), data = path.join(dir, 'data'); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ version: 1, tracks: [], jobs: [{ id: 'unfinished', status: 'running' }] }));
  const lib = new Library(data, tools); assert.equal(lib.state.jobs[0].status, 'interrupted'); assert.equal(lib.active, null);
});
test('corrupt state is backed up instead of destroying existing data', t => {
  const dir = temp(t), data = path.join(dir, 'data'); fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'library.json'), '{broken');
  const lib = new Library(data, fixtureTools(dir)); assert.ok(lib.recoveryWarning); assert.ok(fs.readdirSync(data).some(name => name.startsWith('library.json.recovery-')));
});
