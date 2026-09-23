// Ersatz für Capacitor & das Android-Plugin, um die Handy-Oberfläche im normalen Browser
// anzusehen (node build.mjs --preview). Daten landen im localStorage, Plattform-Abrufe gehen nicht.
const noop = async () => ({});
const listener = () => Promise.resolve({ remove: noop });
const key = (name) => `vorschau:${name}`;
let nextId = 1;

const plugins = {
  SchulradarNative: {
    fileRead: async ({ name }) => ({ text: localStorage.getItem(key(name)) }),
    fileWrite: async ({ name, text }) => localStorage.setItem(key(name), text),
    fileDelete: async ({ name }) => localStorage.removeItem(key(name)),
    secretsRead: async () => ({ json: localStorage.getItem(key('secrets')) || '{}' }),
    secretsWrite: async ({ json }) => localStorage.setItem(key('secrets'), json),
    http: async () => {
      throw new Error('In der Browser-Vorschau nicht verfügbar');
    },
    webOpen: async () => ({ id: String(nextId++) }),
    webLoad: noop,
    webEval: async () => ({ result: 'null' }),
    webUrl: async () => ({ url: '' }),
    webCapture: noop,
    webCaptured: async () => ({ items: [] }),
    webClose: noop,
    setCookie: noop,
    clearOrigins: noop,
    clearAllData: async () => localStorage.clear(),
    openExternal: async ({ url }) => window.open(url, '_blank'),
    addListener: listener
  },
  SystemBars: { setStyle: noop }
};

export function registerPlugin(name) {
  return plugins[name] || new Proxy({}, { get: () => noop });
}

export const App = {
  getInfo: async () => ({ version: 'Vorschau' }),
  addListener: listener,
  minimizeApp: noop,
  exitApp: noop
};

export const LocalNotifications = {
  createChannel: noop,
  addListener: listener,
  checkPermissions: async () => ({ display: 'granted' }),
  requestPermissions: async () => ({ display: 'granted' }),
  getPending: async () => ({ notifications: [] }),
  cancel: noop,
  schedule: async (opts) => {
    window.__geplant = opts.notifications;
    return { notifications: opts.notifications.map((n) => ({ id: n.id })) };
  }
};

export const Share = { share: noop };
export const Filesystem = { writeFile: async ({ path }) => ({ uri: path }) };
export const Directory = { Cache: 'CACHE' };
export const Encoding = { UTF8: 'utf8' };
