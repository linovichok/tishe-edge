'use strict';
const $ = (selector) => document.querySelector(selector);
const KEY = 'tishe.v1';
const THEMES = { north: 'Северное сияние', dusk: 'Тихие сумерки', dawn: 'Первый свет' };
const ENGINES = { google: 'https://www.google.com/search?q=', yandex: 'https://yandex.ru/search/?text=', bing: 'https://www.bing.com/search?q=', duck: 'https://duckduckgo.com/?q=' };
const DEFAULTS = { name: '', theme: 'north', engine: 'google', showClock: true, onlineSuggestions: true, zen: false, focus: '', links: [
  { name: 'YouTube', url: 'https://www.youtube.com/', mark: '▶', tone: 'red' },
  { name: 'Музыка', url: 'https://music.yandex.ru/', mark: '♪', tone: 'yellow' },
  { name: 'Telegram', url: 'https://web.telegram.org/', mark: '↗', tone: 'blue' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/', mark: '✳' },
  { name: 'GitHub', url: 'https://github.com/', mark: 'G' }
] };
function safeUrl(raw) {
  const text = String(raw).trim();
  if (!text || /\s/.test(text)) throw new Error('Укажи адрес сайта без пробелов.');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Используй обычный адрес сайта: https://example.com');
  return url.href;
}
function load() {
  let value;
  try { value = JSON.parse(localStorage.getItem(KEY)); } catch { /* Defaults also work when storage is unavailable. */ }
  if (!value || typeof value !== 'object') return structuredClone(DEFAULTS);
  const clean = structuredClone(DEFAULTS);
  clean.name = typeof value.name === 'string' ? value.name.slice(0, 32) : '';
  clean.focus = typeof value.focus === 'string' ? value.focus.slice(0, 160) : '';
  if (Object.hasOwn(THEMES, value.theme)) clean.theme = value.theme;
  if (Object.hasOwn(ENGINES, value.engine)) clean.engine = value.engine;
  if (typeof value.showClock === 'boolean') clean.showClock = value.showClock;
  if (typeof value.onlineSuggestions === 'boolean') clean.onlineSuggestions = value.onlineSuggestions;
  if (typeof value.zen === 'boolean') clean.zen = value.zen;
  if (Array.isArray(value.links)) clean.links = value.links.slice(0, 17).flatMap(link => {
    try {
      if (!link || typeof link.name !== 'string' || !link.name.trim()) return [];
      return [{ name: link.name.slice(0, 24), url: safeUrl(link.url), mark: typeof link.mark === 'string' ? link.mark.slice(0, 2) : link.name[0].toUpperCase(), tone: ['red','yellow','blue'].includes(link.tone) ? link.tone : '' }];
    } catch { return []; }
  });
  return clean;
}
let state = load();
let toastTimer;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch { notify('Не удалось сохранить. Проверь доступность хранилища браузера.'); return false; }
}
function tick() {
  const now = new Date();
  $('#clock').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  $('#date').textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  $('#greeting').textContent = `${greeting}${state.name.trim() ? `, ${state.name.trim()}` : ''}.`;
}
function apply() {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle('zen', state.zen);
  $('#zen').setAttribute('aria-pressed', String(state.zen));
  $('#clock').hidden = !state.showClock;
  $('#engine').value = state.engine;
  $('#theme-label').textContent = THEMES[state.theme];
  if (document.activeElement !== $('#focus')) $('#focus').value = state.focus;
  tick();
  window.tisheSearch?.refresh();
}
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use); return svg;
}
function renderLinks() {
  const container = $('#shortcuts');
  container.replaceChildren();
  state.links.forEach((link, index) => {
    const wrap = document.createElement('div'); wrap.className = 'shortcut-wrap';
    const anchor = document.createElement('a'); anchor.className = 'shortcut'; anchor.href = link.url; anchor.dataset.tone = link.tone || '';
    const mark = document.createElement('span'); mark.className = 'shortcut-icon'; mark.textContent = link.mark || link.name[0].toUpperCase(); mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'shortcut-label'; label.textContent = link.name;
    anchor.append(mark, label);
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit-link'; edit.setAttribute('aria-label', `Изменить ${link.name}`); edit.title = `Изменить ${link.name}`; edit.append(icon('edit')); edit.addEventListener('click', () => openLink(index));
    wrap.append(anchor, edit); container.append(wrap);
  });
  const add = document.createElement('button'); add.type = 'button'; add.className = 'shortcut add-shortcut';
  const mark = document.createElement('span'); mark.className = 'shortcut-icon'; mark.append(icon('plus'));
  const label = document.createElement('span'); label.textContent = 'Добавить'; add.append(mark, label);
  add.disabled = state.links.length >= 17; add.title = add.disabled ? 'Можно сохранить до 17 ссылок' : 'Добавить сайт';
  add.addEventListener('click', () => openLink(null)); container.append(add);
}
let editingIndex = null;
function openLink(index) {
  editingIndex = index;
  const link = index === null ? null : state.links[index];
  $('#link-title').textContent = link ? 'Любимое место' : 'Новое любимое место';
  $('#link-name').value = link?.name || '';
  $('#link-url').value = link?.url || '';
  $('#link-error').textContent = '';
  $('#link-delete').hidden = index === null;
  $('#link-dialog').showModal();
}
$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  if (window.tisheSearch?.submit()) return;
  const query = $('#query').value.trim();
  if (query) location.assign(ENGINES[state.engine] + encodeURIComponent(query));
  else $('#query').focus();
});
$('#engine').addEventListener('change', () => { state.engine = $('#engine').value; save(); });
$('#zen').addEventListener('click', () => { state.zen = !state.zen; apply(); save(); });
$('#theme-next').addEventListener('click', () => {
  const themes = Object.keys(THEMES); state.theme = themes[(themes.indexOf(state.theme) + 1) % themes.length]; apply(); save();
});
$('#settings-open').addEventListener('click', () => {
  $('#name').value = state.name; $('#show-clock').checked = state.showClock;
  $('#online-suggestions').checked = state.onlineSuggestions;
  $(`input[name="theme"][value="${state.theme}"]`).checked = true;
  $('#settings-dialog').showModal();
});
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault(); state.name = $('#name').value.trim(); state.showClock = $('#show-clock').checked;
  state.onlineSuggestions = $('#online-suggestions').checked;
  state.theme = $('input[name="theme"]:checked').value;
  apply(); if (save()) { $('#settings-dialog').close(); notify('Теперь здесь ещё уютнее. Настройки сохранены.'); }
});
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#link-form').addEventListener('submit', event => {
  event.preventDefault();
  let url; const name = $('#link-name').value.trim();
  if (!name) { $('#link-error').textContent = 'Добавь название сайта.'; return; }
  try { url = safeUrl($('#link-url').value); } catch { $('#link-error').textContent = 'Проверь адрес. Например: https://example.com'; return; }
  const previous = editingIndex === null ? null : state.links[editingIndex];
  const link = { name, url, mark: previous?.mark && previous.name === name ? previous.mark : Array.from(name)[0].toUpperCase(), tone: previous?.tone || '' };
  if (editingIndex === null) { if (state.links.length >= 17) return; state.links.push(link); }
  else state.links[editingIndex] = link;
  renderLinks(); if (save()) $('#link-dialog').close();
});
$('#link-delete').addEventListener('click', () => {
  if (editingIndex === null) return;
  state.links.splice(editingIndex, 1); renderLinks(); if (save()) $('#link-dialog').close();
});
$('#focus').addEventListener('input', () => {
  state.focus = $('#focus').value;
  $('#focus-status').textContent = save() ? 'Сохранено на этом устройстве' : 'Не удалось сохранить заметку';
});
window.addEventListener('storage', event => {
  if (event.key === KEY || event.key === null) { state = load(); apply(); renderLinks(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
apply(); renderLinks(); setInterval(tick, 1000);
