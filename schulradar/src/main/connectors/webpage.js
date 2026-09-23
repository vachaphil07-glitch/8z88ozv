'use strict';
// Hilfsskripte, die in fremden Webseiten laufen (Letto, LMS.at): Knöpfe finden, Anmeldung ausfüllen.
// Sie werden als Quelltext in die Seite geschickt (platform.evalIn) und dürfen deshalb nur
// auf ihr Argument und die Seite selbst zugreifen.

function clickByText(labels) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = labels.map(norm);
  const candidates = Array.from(document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],li,span,div'))
    .filter((el) => el.offsetWidth || el.offsetHeight)
    .filter((el) => wanted.some((w) => norm(el.innerText) === w || norm(el.innerText).startsWith(w)));
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length);
  const el = candidates[0].closest('a,button,[role=button],[role=tab],[role=menuitem]') || candidates[0];
  el.click();
  return true;
}

function fillLogin(cred) {
  const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight));
  const pw = Array.from(document.querySelectorAll('input[type=password]')).find(visible);
  if (!pw) return false;
  const inputs = Array.from(document.querySelectorAll('input')).filter(
    (i) => visible(i) && /^(text|email|)$/i.test(i.getAttribute('type') || '')
  );
  const before = inputs.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  const user = before[before.length - 1] || inputs[0];
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (user) set(user, cred.user);
  set(pw, cred.pass);
  const form = pw.form;
  const btn =
    (form && form.querySelector('button[type=submit],input[type=submit],button:not([type])')) ||
    Array.from(document.querySelectorAll('button,input[type=submit],[role=button]')).find((b) =>
      /anmelden|login|einloggen|sign in/i.test(b.innerText || b.value || '')
    );
  if (btn) btn.click();
  else if (form) form.submit();
  return true;
}

function clickSsoButton() {
  const re = /microsoft|office\s*365|azure|schulkonto|\bsso\b/i;
  const el = Array.from(document.querySelectorAll('a,button,[role=button]')).find(
    (e) => (e.offsetWidth || e.offsetHeight) && re.test(e.innerText || e.title || e.getAttribute('aria-label') || '')
  );
  if (el) {
    el.click();
    return true;
  }
  return false;
}

module.exports = { clickByText, fillLogin, clickSsoButton };
