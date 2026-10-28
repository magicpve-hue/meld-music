const path = require('node:path');
const fs = require('node:fs');
const { Library } = require('../src/core.cjs');
const { Tools } = require('../src/tools.cjs');
const dir = path.resolve(process.argv[2]);
const lib = new Library(dir, new Tools(path.join(dir, 'tools')));
const report = [];
lib.on('activity', ({ line }) => { if (!/token|secret/i.test(line)) console.log(line.slice(-300)); });
(async () => {
  for (const url of ['https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', 'https://soundcloud.com/forss/flickermood']) {
    const start = Date.now();
    try { const result = await lib.importUrl(url); report.push({ url, ok: true, result, seconds: (Date.now() - start) / 1000 }); }
    catch (error) { report.push({ url, ok: false, error: error.message, seconds: (Date.now() - start) / 1000 }); }
    console.log(JSON.stringify(report.at(-1)));
    fs.writeFileSync(path.join(dir, 'live-check.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
