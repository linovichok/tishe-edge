'use strict';
(() => {
  const input = $('#query');
  const panel = $('#search-results');
  const list = $('#search-options');
  const status = $('#search-status');
  const area = $('.search-area');
  const providers = {
    google: { name: 'Google', url: 'https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&q=' },
    yandex: { name: 'Яндекс', url: 'https://suggest.yandex.net/suggest-ff.cgi?uil=ru&part=' },
    bing: { name: 'Bing', url: 'https://api.bing.com/osjson.aspx?market=ru-RU&query=' },
    duck: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/ac/?type=list&q=' }
  };
  let timer;
  let controller;
  let revision = 0;
  let rows = [];
  let selected = -1;
  let composing = false;
  const cache = new Map();

  function cancel() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    list.removeAttribute('aria-busy');
    revision++;
  }
  function hide() {
    cancel();
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    list.removeAttribute('aria-busy');
    selected = -1;
  }
  function matches(query) {
    const needle = query.toLocaleLowerCase('ru');
    return state.links.filter(link => `${link.name} ${link.url}`.toLocaleLowerCase('ru').includes(needle)).slice(0, 3)
      .map(link => ({ text: link.name, url: link.url, local: true }));
  }
  function title(text, query) {
    const span = document.createElement('span'); span.className = 'option-title';
    const start = text.toLocaleLowerCase('ru').indexOf(query.toLocaleLowerCase('ru'));
    if (start < 0) { span.textContent = text; return span; }
    const mark = document.createElement('mark'); mark.textContent = text.slice(start, start + query.length);
    span.append(document.createTextNode(text.slice(0, start)), mark, document.createTextNode(text.slice(start + query.length)));
    return span;
  }
  function render(query, suggestions, message = '') {
    rows = [...matches(query), ...suggestions.map(text => ({ text, local: false }))].slice(0, 8);
    selected = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren();
    rows.forEach((row, index) => {
      const item = document.createElement('li');
      item.id = `search-option-${index}`; item.className = 'search-option';
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false');
      item.dataset.index = String(index);
      item.append(icon(row.local ? 'arrow' : 'search'));
      const copy = document.createElement('span'); copy.className = 'option-copy'; copy.append(title(row.text, query));
      if (row.local) { const detail = document.createElement('span'); detail.className = 'option-detail'; detail.textContent = new URL(row.url).hostname; copy.append(detail); }
      const kind = document.createElement('span'); kind.className = 'option-kind'; kind.textContent = row.local ? 'Твой сайт' : providers[state.engine].name;
      item.append(copy, kind); list.append(item);
    });
    $('#results-label').textContent = state.onlineSuggestions ? `Подсказки · ${providers[state.engine].name}` : 'Твои сайты';
    status.textContent = message;
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function activate(index) {
    selected = index;
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', list.children[index].id);
      list.children[index].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function open(row) {
    const url = row.local ? row.url : ENGINES[state.engine] + encodeURIComponent(row.text);
    hide(); location.assign(url);
  }
  function normalize(data) {
    const values = Array.isArray(data?.[1]) ? data[1] : Array.isArray(data) ? data.map(item => item?.phrase) : [];
    const seen = new Set();
    return values.filter(value => {
      if (typeof value !== 'string' || !value.trim() || value.length > 300) return false;
      const key = value.trim().toLocaleLowerCase('ru');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 8).map(value => value.trim());
  }
  function current(id, query, engine) {
    return id === revision && document.activeElement === input && query === input.value.trim() && engine === state.engine && !composing;
  }
  async function request(query, engine, id) {
    if (!current(id, query, engine)) return;
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 4000);
    list.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(providers[engine].url + encodeURIComponent(query), {
        signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
      if (!response.ok) throw new Error('Provider unavailable');
      const suggestions = normalize(await response.json());
      if (!current(id, query, engine)) return;
      cache.set(`${engine}:${query}`, { at: Date.now(), suggestions });
      if (cache.size > 40) cache.delete(cache.keys().next().value);
      render(query, suggestions, suggestions.length ? '' : 'Подсказок нет. Нажми Enter, чтобы найти свой запрос.');
    } catch {
      if (current(id, query, engine)) render(query, [], 'Онлайн-подсказки недоступны. Можно открыть свой сайт или нажать Enter для поиска.');
    } finally {
      clearTimeout(timeout);
      if (controller === abort) controller = null;
      if (id === revision) list.removeAttribute('aria-busy');
    }
  }
  function update() {
    cancel();
    const query = input.value.trim();
    if (!query || composing || document.activeElement !== input) { hide(); return; }
    if (!state.onlineSuggestions) { render(query, [], 'Онлайн-подсказки выключены. Enter — искать в интернете.'); return; }
    if (query.length < 2) { render(query, [], 'Введи ещё один символ для онлайн-подсказок.'); return; }
    const engine = state.engine;
    const remembered = cache.get(`${engine}:${query}`);
    if (remembered && Date.now() - remembered.at < 60000) { render(query, remembered.suggestions); return; }
    render(query, [], 'Ищем подсказки…');
    const id = revision;
    timer = setTimeout(() => request(query, engine, id), 250);
  }

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('compositionstart', () => { composing = true; hide(); });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'Escape') { if (!panel.hidden) { event.preventDefault(); event.stopPropagation(); hide(); } return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (panel.hidden) update();
    if (!rows.length || panel.hidden) return;
    event.preventDefault();
    activate(event.key === 'ArrowDown' ? (selected + 1) % rows.length : (selected < 0 ? rows.length - 1 : (selected - 1 + rows.length) % rows.length));
  });
  list.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
  list.addEventListener('click', event => {
    const item = event.target.closest('.search-option');
    if (item && rows[Number(item.dataset.index)]) open(rows[Number(item.dataset.index)]);
  });
  input.addEventListener('blur', () => { hide(); });
  $('#engine').addEventListener('change', update);
  document.addEventListener('pointerdown', event => { if (!area.contains(event.target)) hide(); });
  window.tisheSearch = {
    refresh: update,
    submit() {
      if (composing) return true;
      if (!panel.hidden && selected >= 0 && rows[selected]) { open(rows[selected]); return true; }
      hide(); return false;
    }
  };
})();
