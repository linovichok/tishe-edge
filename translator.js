'use strict';
(() => {
  const languages = { en: ['Английский', 'EN'], ru: ['Русский', 'RU'], de: ['Немецкий', 'DE'], fr: ['Французский', 'FR'], es: ['Испанский', 'ES'], it: ['Итальянский', 'IT'], pt: ['Португальский', 'PT'], tr: ['Турецкий', 'TR'], uk: ['Украинский', 'UK'], 'zh-CN': ['Китайский', 'ZH'], ja: ['Японский', 'JA'], ko: ['Корейский', 'KO'] };
  const key = 'tishe.translator.v1';
  const card = $('#translator-card');
  const input = $('#translator-input');
  const output = $('#translator-output');
  const from = $('#translator-from');
  const to = $('#translator-to');
  const status = $('#translator-status');
  const encoder = new TextEncoder();
  const memory = new Map();
  let controller;
  let revision = 0;
  let busy = false;
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Default languages are usable without storage. */ }
  for (const select of [from, to]) {
    for (const [code, [name]] of Object.entries(languages)) {
      const option = document.createElement('option'); option.value = code; option.textContent = name; select.append(option);
    }
  }
  from.value = Object.hasOwn(languages, preferences.from) ? preferences.from : 'en';
  to.value = Object.hasOwn(languages, preferences.to) ? preferences.to : 'ru';
  card.open = preferences.open === true;
  function remember() {
    try { localStorage.setItem(key, JSON.stringify({ from: from.value, to: to.value, open: card.open })); } catch { /* Translation text is never persisted. */ }
    $('#translator-pair').textContent = `${languages[from.value][1]} → ${languages[to.value][1]}`;
  }
  function message(text = '', isError = false) { status.textContent = text; status.dataset.error = String(isError); }
  function setBusy(value) {
    busy = value;
    $('#translator-submit').disabled = value;
    $('#translator-submit').textContent = value ? 'Переводим…' : 'Перевести';
    $('#translator-cancel').hidden = !value;
    $('#translator-form').setAttribute('aria-busy', String(value));
  }
  function cancel(text = '') {
    revision++; controller?.abort(); controller = null; setBusy(false); message(text);
  }
  function invalidate() {
    cancel(); output.value = ''; $('#translator-result').hidden = true;
    $('#translator-count').textContent = `${input.value.length} / 1000`;
  }
  function show(text) { output.value = text; $('#translator-result').hidden = false; }
  function decodeEntities(text) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    });
  }
  // MyMemory allows up to 500 UTF-8 bytes per request, not 500 characters.
  function chunks(text) {
    const result = [];
    let start = 0;
    while (start < text.length) {
      let end = start, size = 0, boundary = -1;
      while (end < text.length) {
        const character = String.fromCodePoint(text.codePointAt(end));
        const bytes = encoder.encode(character).length;
        if (size + bytes > 500) break;
        size += bytes; end += character.length;
        if (/\s/u.test(character)) boundary = end;
      }
      if (end < text.length && boundary > start + (end - start) / 2) end = boundary;
      const part = text.slice(start, end);
      const leading = part.match(/^\s*/u)[0];
      const trailing = part.trim() ? part.match(/\s*$/u)[0] : '';
      result.push({ text: part.trim(), prefix: leading, suffix: trailing });
      start = end;
    }
    return result;
  }
  async function translate(text, source, target, signal, id) {
    const parts = chunks(text);
    const translated = [];
    for (let index = 0; index < parts.length; index++) {
      if (signal.aborted || id !== revision) throw new DOMException('Cancelled', 'AbortError');
      const part = parts[index];
      if (!part.text) { translated.push(part.prefix); continue; }
      message(parts.length > 1 ? `Переводим… ${index + 1} / ${parts.length}` : 'Переводим…');
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', part.text); url.searchParams.set('langpair', `${source}|${target}`);
      const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (response.status === 429) throw new Error('Лимит сервиса исчерпан. Попробуй перевести позже.');
      if (!response.ok) throw new Error('Сервис перевода сейчас недоступен. Попробуй позже.');
      let data;
      try { data = await response.json(); } catch { throw new Error('Переводчик вернул непонятный ответ. Попробуй ещё раз.'); }
      if (!data || typeof data !== 'object') throw new Error('Не удалось получить перевод. Попробуй ещё раз.');
      if (data.quotaFinished === true || Number(data.responseStatus) === 429 || (Number(data.responseStatus) === 403 && /limit|quota|available free|used all/i.test(String(data.responseDetails)))) throw new Error('Лимит сервиса исчерпан. Попробуй перевести позже.');
      if (Number(data.responseStatus) !== 200 || typeof data.responseData?.translatedText !== 'string' || !data.responseData.translatedText.trim()) throw new Error('Не удалось перевести эту пару языков. Попробуй другой язык или текст.');
      translated.push(part.prefix + decodeEntities(data.responseData.translatedText).trim() + part.suffix);
    }
    return translated.join('');
  }
  $('#translator-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const text = input.value.trim();
    invalidate();
    if (!text) { message('Напиши текст для перевода.'); input.focus(); return; }
    if (input.value.length > 1000) { message('Сократи текст до 1000 символов.', true); return; }
    const source = from.value, target = to.value;
    if (source === target) { show(text); message('Языки совпадают — показан исходный текст.'); return; }
    const cacheKey = `${source}|${target}|${text}`;
    if (memory.has(cacheKey)) { show(memory.get(cacheKey)); message('Готово.'); return; }
    controller = new AbortController(); const request = controller;
    const id = revision;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, 30000);
    setBusy(true);
    try {
      const translated = await translate(text, source, target, request.signal, id);
      if (id !== revision) return;
      memory.set(cacheKey, translated); if (memory.size > 10) memory.delete(memory.keys().next().value);
      show(translated); message('Готово.');
    } catch (reason) {
      if (id !== revision) return;
      message(timedOut ? 'Перевод занял слишком много времени. Попробуй ещё раз.' : reason instanceof TypeError ? 'Не удалось соединиться с переводчиком. Проверь интернет и попробуй снова.' : reason.message || 'Не удалось получить перевод.', true);
    } finally { clearTimeout(timer); if (id === revision) { controller = null; setBusy(false); } }
  });
  input.addEventListener('input', invalidate);
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('#translator-form').requestSubmit(); }
  });
  for (const select of [from, to]) select.addEventListener('change', () => { invalidate(); remember(); });
  $('#translator-swap').addEventListener('click', () => {
    const previous = from.value; from.value = to.value; to.value = previous;
    if (!$('#translator-result').hidden && output.value.length <= 1000) input.value = output.value;
    invalidate(); remember();
  });
  $('#translator-clear').addEventListener('click', () => { input.value = ''; invalidate(); input.focus(); });
  $('#translator-cancel').addEventListener('click', () => cancel('Перевод отменён.'));
  $('#translator-copy').addEventListener('click', async () => {
    if (!output.value) return;
    try { await navigator.clipboard.writeText(output.value); message('Перевод скопирован.'); }
    catch { output.focus(); output.select(); message('Выделили перевод. Скопируй его через Ctrl+C или ⌘C.'); }
  });
  card.addEventListener('toggle', () => { if (!card.open && busy) cancel('Перевод отменён.'); remember(); });
  window.addEventListener('pagehide', () => cancel());
  remember();
})();
