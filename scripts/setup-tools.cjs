const path = require('node:path');
const { Tools } = require('../src/tools.cjs');
if (!process.argv[2]) throw new Error('Pass the installation directory');
const tools = new Tools(path.resolve(process.argv[2]));
let last = '';
tools.on('progress', state => { const p = state.progress; if (p && (p.name !== last || p.percent === 100)) { console.log(`${p.step}/${p.total} ${p.name}: ${p.percent}%`); last = p.name; } });
tools.install().then(state => console.log(JSON.stringify(state))).catch(error => { console.error(error); process.exitCode = 1; });
