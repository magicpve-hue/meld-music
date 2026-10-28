const { app, BrowserWindow, ipcMain, dialog, protocol, shell, safeStorage, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Library } = require('./core.cjs');
const { Tools } = require('./tools.cjs');
const { audioResponse } = require('./media.cjs');

app.setName('Meld');
if (process.env.MELD_DATA_DIR) app.setPath('userData', path.resolve(process.env.MELD_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'meld', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
let win, library, tools, savedCredentials = {};
const ui = pathToFileURL(path.join(__dirname, 'index.html')).href;
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
function credentials() { return savedCredentials; }
function credentialsStatus() { return { configured: Boolean(savedCredentials.clientId) }; }
function ipc(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.senderFrame?.url !== ui || event.sender !== win?.webContents) throw new Error('Недоверенный источник запроса.');
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) {
      let message = String(error.message || error);
      const secret = credentials().clientSecret; if (secret) message = message.split(secret).join('[скрыто]');
      return { ok: false, error: message };
    }
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1320, height: 880, minWidth: 940, minHeight: 640, backgroundColor: '#101413', title: 'Meld', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== ui) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.on('close', event => { if (tools.installing) { event.preventDefault(); send('app-message', 'Дождитесь завершения установки движков.'); } });
  win.loadURL(ui);
  if (!app.isPackaged && process.env.MELD_SMOKE) win.webContents.once('did-finish-load', () => require('../scripts/smoke-runner.cjs')({ app, win, library, tools }));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const credentialFile = path.join(app.getPath('userData'), 'credentials.bin');
    if (fs.existsSync(credentialFile)) {
      try { savedCredentials = JSON.parse((await safeStorage.decryptStringAsync(fs.readFileSync(credentialFile))).result); }
      catch { savedCredentials = {}; }
    }
    tools = new Tools(path.join(app.getPath('userData'), 'tools'));
    library = new Library(app.getPath('userData'), tools); library.getCredentials = credentials;
    library.on('change', state => send('state', state));
    library.on('activity', state => send('activity', state));
    tools.on('progress', state => send('tools-state', state));
    protocol.handle('meld', request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'audio' || !/^\/[a-f0-9-]{36}$/.test(url.pathname) || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 400 });
        const track = library.track(url.pathname.slice(1));
        if (!track.file) return new Response(null, { status: 404 });
        return audioResponse(track.file, request.headers.get('range'), request.method);
      } catch { return new Response(null, { status: 404 }); }
    });
    ipc('init', () => ({ state: library.snapshot(), tools: tools.status(), credentials: credentialsStatus(), platform: process.platform, version: app.getVersion() }));
    ipc('import-url', value => library.importUrl(value, credentials()));
    ipc('import-files', async () => {
      const result = await dialog.showOpenDialog(win, { title: 'Добавить музыку', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Музыка', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'opus', 'aac'] }] });
      return { added: result.canceled ? 0 : library.addLocal(result.filePaths) };
    });
    ipc('enqueue', ids => library.enqueue(ids));
    ipc('cancel', id => library.cancel(id));
    ipc('favorite', id => library.favorite(id));
    ipc('remove', id => library.remove(id));
    ipc('install-tools', () => { if (library.active || library.imports.size) throw new Error('Дождитесь завершения импорта и загрузок.'); return tools.install(); });
    ipc('open-library', () => shell.openPath(path.join(app.getPath('userData'), 'audio')));
    ipc('reveal', id => { const track = library.track(id); if (!track.file) throw new Error('Файл ещё не загружен.'); shell.showItemInFolder(track.file); });
    ipc('open-source', id => {
      const track = library.track(id);
      if (!/^https:\/\/(open\.spotify\.com|soundcloud\.com)\//.test(track.sourceUrl)) throw new Error('У локального файла нет внешней ссылки.');
      return shell.openExternal(track.sourceUrl);
    });
    ipc('save-credentials', async value => {
      if (!value || typeof value.clientId !== 'string' || typeof value.clientSecret !== 'string' || !/^[A-Za-z0-9]{16,128}$/.test(value.clientId) || !/^[A-Za-z0-9_-]{16,256}$/.test(value.clientSecret)) throw new Error('Проверьте Client ID и Client Secret.');
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Системное защищённое хранилище недоступно. Ключи не сохранены.');
      fs.writeFileSync(path.join(app.getPath('userData'), 'credentials.bin'), await safeStorage.encryptStringAsync(JSON.stringify(value)), { mode: 0o600 }); savedCredentials = value; return credentialsStatus();
    });
    ipc('clear-credentials', () => { fs.rmSync(path.join(app.getPath('userData'), 'credentials.bin'), { force: true }); savedCredentials = {}; return credentialsStatus(); });
    const menu = [{ label: 'Meld', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }, { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }, { label: 'Вид', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu)); createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('before-quit', event => {
    if (tools?.installing) { event.preventDefault(); send('app-message', 'Дождитесь завершения установки движков.'); return; }
    library?.shutdown();
  });
  app.on('window-all-closed', () => app.quit());
}
