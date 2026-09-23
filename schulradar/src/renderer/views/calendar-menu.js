// „Kalender“-Knopf mit Auswahlmenü (Google, Outlook, Yahoo, .ics, Handy-Kalender)
import { h, icon } from '../dom.js';
import { calendarEvent, googleUrl, outlookUrl, yahooUrl, icsFileName } from '../calendar.js';

let openMenu = null;

function closeMenu() {
  if (!openMenu) return false;
  openMenu.el.remove();
  document.removeEventListener('pointerdown', openMenu.onOutside, true);
  window.removeEventListener('resize', closeMenu);
  document.removeEventListener('scroll', closeMenu, true);
  document.removeEventListener('keydown', openMenu.onKey, true);
  openMenu = null;
  return true;
}

function badge(text, color) {
  return h('span', { class: 'cal-badge', style: { '--b': color } }, text);
}

function options(ctx, ev) {
  const phone = ctx.state.platform === 'android';
  const web = (url) => () => ctx.api.openUrl(url, true);
  const list = [];
  if (phone && ctx.api.addToDeviceCalendar) {
    list.push({
      label: 'Kalender-App am Handy',
      hint: 'z. B. Google Kalender – direkt eintragen',
      mark: h('span', { class: 'cal-badge is-icon' }, icon('calendar')),
      run: () => ctx.api.addToDeviceCalendar(ev)
    });
  }
  list.push(
    { label: 'Google Kalender', mark: badge('G', '#4285F4'), run: web(googleUrl(ev)) },
    { label: 'Outlook (Schulkonto)', hint: 'Microsoft 365', mark: badge('O', '#0F6CBD'), run: web(outlookUrl(ev, { office: true })) },
    { label: 'Yahoo Kalender', mark: badge('Y!', '#6001D2'), run: web(yahooUrl(ev)) },
    {
      label: 'Kalender (.ics)',
      hint: phone ? 'Datei teilen oder öffnen' : 'Datei speichern und öffnen',
      mark: badge('ics', '#2B8A3E'),
      run: () => ctx.actions.saveCalendar([ev], icsFileName(ev), { open: true })
    }
  );
  return list;
}

function place(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 10 + hgt <= window.innerHeight - 8;
  menu.style.left = `${left}px`;
  const top = below ? r.bottom + 10 : r.top - hgt - 10;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - hgt - 8, top))}px`;
  menu.classList.toggle('is-above', !below);
  menu.style.setProperty('--arrow', `${Math.max(16, Math.min(w - 16, r.left + r.width / 2 - left))}px`);
}

function showMenu(ctx, item, anchor) {
  closeMenu();
  const ev = calendarEvent(item);
  if (!ev) return;
  const el = h(
    'div',
    { class: 'cal-menu', role: 'menu' },
    h('div', { class: 'cal-menu-title' }, 'Kalenderexport'),
    options(ctx, ev).map((o) =>
      h(
        'button',
        {
          class: 'cal-option',
          role: 'menuitem',
          onclick: () => {
            closeMenu();
            Promise.resolve(o.run()).catch((err) => ctx.toast(`Kalender: ${err.message || err}`, 'error'));
          }
        },
        o.mark,
        h('span', { class: 'cal-option-text' }, h('span', {}, o.label), o.hint ? h('small', {}, o.hint) : null)
      )
    )
  );
  document.body.append(el);
  place(el, anchor);
  const onOutside = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  };
  openMenu = { el, anchor, onOutside, onKey };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  // Scrollen im Hintergrund schließt das Menü (nicht aber Scrollen im Menü selbst)
  setTimeout(() => openMenu && openMenu.el === el && document.addEventListener('scroll', closeMenu, true), 50);
  el.querySelector('.cal-option')?.focus();
}

/** Knopf „Kalender“ für die Detailansicht eines Eintrags */
export function calendarButton(item, ctx) {
  if (!item.due) return null;
  const btn = h(
    'button',
    {
      class: 'btn btn-ghost',
      title: 'In Google Kalender, Outlook oder eine Kalender-App übernehmen',
      'aria-haspopup': 'menu',
      onclick: (e) => {
        e.stopPropagation();
        if (openMenu && openMenu.anchor === btn) closeMenu();
        else showMenu(ctx, item, btn);
      }
    },
    icon('calendar'),
    'Kalender'
  );
  return btn;
}

/** Nach dem Neuzeichnen: Menü schließen, wenn sein Knopf nicht mehr da ist */
export function closeCalendarMenuIfDetached() {
  if (openMenu && !openMenu.anchor.isConnected) closeMenu();
}

export { closeMenu as closeCalendarMenu };
