'use strict';
// Sichere Brücke zwischen Oberfläche und Hauptprozess.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('schulradar', {
  getState: () => ipcRenderer.invoke('state:get'),
  sync: (source) => ipcRenderer.invoke('sync', source || null),
  setDone: (id, done) => ipcRenderer.invoke('item:done', id, done),
  setDismissed: (id, dismissed) => ipcRenderer.invoke('item:dismiss', id, dismissed),
  restoreDismissed: () => ipcRenderer.invoke('items:restore-dismissed'),
  saveOwnTask: (task) => ipcRenderer.invoke('own:save', task),
  deleteOwnTask: (id) => ipcRenderer.invoke('own:delete', id),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setCredentials: (source, creds) => ipcRenderer.invoke('creds:set', source, creds),
  login: (source) => ipcRenderer.invoke('platform:login', source),
  logout: (source) => ipcRenderer.invoke('platform:logout', source),
  openUrl: (url, external) => ipcRenderer.invoke('open:url', url, Boolean(external)),
  getTimetable: (weekStart) => ipcRenderer.invoke('timetable:get', weekStart),
  teamsGraphConnect: () => ipcRenderer.invoke('teams:graph-connect'),
  exportDiagnostics: (source) => ipcRenderer.invoke('diag:export', source || null),
  saveCalendarFile: (name, text, open) => ipcRenderer.invoke('calendar:save', name, text, Boolean(open)),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  resetData: () => ipcRenderer.invoke('data:reset'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onState: on('state'),
  onToast: on('toast'),
  onFocusItem: on('focus-item'),
  onGraphCode: on('graph-code'),
  onNavigate: on('navigate')
});
