const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['init', 'import-url', 'import-files', 'enqueue', 'cancel', 'favorite', 'remove', 'install-tools', 'open-library', 'reveal', 'open-source', 'save-credentials', 'clear-credentials']);
contextBridge.exposeInMainWorld('meld', {
  call: async (channel, ...args) => {
    if (!channels.has(channel)) throw new Error('Неизвестная команда.');
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!result.ok) throw new Error(result.error); return result.value;
  },
  on: (channel, fn) => {
    if (!['state', 'tools-state', 'activity', 'app-message'].includes(channel)) return;
    const listener = (_event, payload) => fn(payload); ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
