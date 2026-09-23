'use strict';
// Ablauf eines Anmeldefensters (gemeinsam für PC und Handy):
// prüft regelmäßig, ob die Anmeldung fertig ist (connector.onLoginPage), und liest bei Bedarf
// schon im sichtbaren Fenster mit (connector.onLoginWindow, z. B. Teams-„Zuweisungen“).

function startLoginFlow({ connector, ctx, win, onMessage, close, interval = 2500 }) {
  let finished = false;
  let checking = false;
  let stopped = false;
  let detach = null;

  const check = async () => {
    if (stopped || finished || checking || win.isDestroyed() || !connector.onLoginPage) return;
    checking = true;
    try {
      const res = await connector.onLoginPage(ctx, win);
      if (res && res.message) onMessage(res.message);
      if (res && res.done) {
        finished = true;
        setTimeout(() => !win.isDestroyed() && close(), 900);
      }
    } catch (_) {
      /* weiter warten */
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(check, interval);
  if (connector.onLoginWindow) {
    Promise.resolve(connector.onLoginWindow(ctx, win, onMessage))
      .then((fn) => {
        if (stopped && fn) fn();
        else detach = fn;
      })
      .catch(() => {});
  }

  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
      if (detach) detach();
    }
  };
}

module.exports = { startLoginFlow };
