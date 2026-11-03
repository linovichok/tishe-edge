'use strict';
(() => {
  const landscape = $('.landscape');
  const image = $('#background-image');
  const video = $('#background-video');
  const preview = $('#background-preview-image');
  const fileInput = $('#background-file');
  const error = $('#background-error');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm']);
  let database;
  let cachedAsset;
  let mediaUrls;
  let previewUrl;
  let pending;
  let preparedId = '';
  let removeAsset = false;
  let validating = false;
  let uploadError = '';
  let generation = 0;
  let application = 0;
  let failedId = '';
  let playbackBlocked = false;

  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('tishe-backgrounds', 1);
      let settled = false;
      const fail = () => { if (!settled) { settled = true; reject(new Error('Хранилище фонов недоступно. Попробуй ещё раз.')); } };
      const timeout = setTimeout(fail, 6000);
      request.onupgradeneeded = () => { request.result.createObjectStore('assets', { keyPath: 'id' }); };
      request.onerror = request.onblocked = () => { clearTimeout(timeout); fail(); };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
    }).catch(reason => { database = null; throw reason; });
    return database;
  }
  async function storage(action, value) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const failure = new Error(action === 'get' ? 'Не удалось прочитать свой фон. Выбери файл заново.' : 'Не удалось сохранить файл. Возможно, в хранилище браузера мало места.');
      try {
        const transaction = connection.transaction('assets', action === 'get' ? 'readonly' : 'readwrite');
        const request = transaction.objectStore('assets')[action](value);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(failure);
      } catch { reject(failure); }
    });
  }
  function clearMedia() {
    video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load();
    image.removeAttribute('src');
    if (mediaUrls) { URL.revokeObjectURL(mediaUrls.original); URL.revokeObjectURL(mediaUrls.poster); mediaUrls = null; }
  }
  function urlsFor(asset) {
    if (mediaUrls?.id !== asset.id) {
      clearMedia();
      mediaUrls = { id: asset.id, original: URL.createObjectURL(asset.blob), poster: URL.createObjectURL(asset.poster) };
    }
    return mediaUrls;
  }
  function showPreview(asset) {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    preview.hidden = !asset;
    if (asset) {
      previewUrl = URL.createObjectURL(asset.poster); preview.src = previewUrl;
      $('#background-file-label').textContent = `${asset.name} · ${(asset.blob.size / 1024 / 1024).toFixed(1)} МБ`;
    } else { preview.removeAttribute('src'); $('#background-file-label').textContent = 'Выбери картинку, GIF или видео'; }
  }
  function buttonState() {
    const background = state.background;
    const button = $('#background-pause');
    button.hidden = background.mode === 'landscape' || (background.mode === 'custom' && !cachedAsset?.animated);
    button.disabled = reduced.matches;
    const running = background.motion && !reduced.matches && !playbackBlocked;
    const label = reduced.matches ? 'Анимация выключена системой' : running ? 'Приостановить фон' : 'Воспроизвести фон';
    button.setAttribute('aria-label', label); button.title = label;
    button.replaceChildren(icon(running ? 'pause' : 'play'));
  }
  async function apply() {
    const token = ++application;
    const background = state.background;
    const running = background.motion && !reduced.matches && !document.hidden;
    landscape.dataset.running = String(running);
    landscape.style.setProperty('--background-dim', String(background.dim / 100));
    buttonState();
    if (background.mode !== 'custom' || !background.assetId) {
      landscape.dataset.mode = background.mode === 'aurora' ? 'aurora' : 'landscape';
      $('#custom-background').hidden = true;
      document.body.classList.remove('has-custom-background');
      $('#theme-label').textContent = THEMES[state.theme];
      if (!background.assetId) cachedAsset = null;
      clearMedia(); return;
    }
    try {
      let asset = cachedAsset?.id === background.assetId ? cachedAsset : await storage('get', background.assetId);
      if (token !== application) return;
      if (!asset?.blob || !asset.poster) throw new Error('Свой фон не найден. Выбери файл заново в настройках.');
      cachedAsset = asset;
      const urls = urlsFor(asset);
      landscape.dataset.mode = 'custom';
      document.body.classList.add('has-custom-background');
      $('#custom-background').hidden = false;
      $('#theme-label').textContent = 'Свой фон';
      if (asset.kind === 'video' && running) {
        image.hidden = true; video.hidden = false;
        video.muted = true; video.defaultMuted = true; video.poster = urls.poster;
        if (video.getAttribute('src') !== urls.original) video.src = urls.original;
        video.play().then(() => { playbackBlocked = false; buttonState(); }).catch(() => {
          if (token !== application) return;
          playbackBlocked = true; video.hidden = true; image.hidden = false; image.src = urls.poster;
          buttonState(); notify('Нажми «Воспроизвести фон», чтобы запустить видео.');
        });
      } else {
        video.pause(); video.hidden = true; image.hidden = false;
        const source = asset.kind === 'image' && running ? urls.original : urls.poster;
        if (image.getAttribute('src') !== source) image.src = source;
      }
      buttonState();
    } catch (reason) {
      if (token !== application) return;
      clearMedia(); landscape.dataset.mode = 'landscape'; $('#custom-background').hidden = true;
      document.body.classList.remove('has-custom-background');
      if (failedId !== background.assetId) { failedId = background.assetId; notify(reason.message); }
    }
  }
  function updateDraft() {
    const mode = $('input[name="background-mode"]:checked')?.value;
    $('#background-upload').hidden = mode !== 'custom';
    $('.background-motion-row').hidden = mode === 'landscape';
    $('#background-dim-value').textContent = `${$('#background-dim').value}%`;
    $('#background-motion').disabled = reduced.matches;
    $('#background-motion-note').hidden = !reduced.matches || mode === 'landscape';
    if (reduced.matches) $('#background-motion').checked = false;
  }
  async function openSettings() {
    const current = ++generation;
    pending = null; removeAsset = false; validating = false; uploadError = ''; error.textContent = '';
    fileInput.value = '';
    $(`input[name="background-mode"][value="${state.background.mode}"]`).checked = true;
    $('#background-dim').value = String(state.background.dim);
    $('#background-preview').style.setProperty('--preview-dim', String(state.background.dim / 100));
    $('#background-motion').checked = state.background.motion;
    updateDraft(); showPreview(null);
    if (state.background.assetId) {
      try {
        const asset = cachedAsset?.id === state.background.assetId ? cachedAsset : await storage('get', state.background.assetId);
        if (current === generation) showPreview(asset);
      } catch { if (current === generation) error.textContent = 'Не удалось прочитать свой фон. Можно выбрать файл заново.'; }
    }
  }
  async function inspect(file) {
    const mime = file.type.toLowerCase() || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm' })[file.name.split('.').pop().toLowerCase()] || '';
    if (!types.has(mime)) throw new Error('Выбери JPG, PNG, WebP, GIF, AVIF, MP4 или WebM.');
    const kind = mime.startsWith('video/') ? 'video' : 'image';
    const max = kind === 'video' ? 60 : 20;
    if (!file.size || file.size > max * 1024 * 1024) throw new Error(`Выбери ${kind === 'video' ? 'видео' : 'изображение'} размером до ${max} МБ.`);
    const objectUrl = URL.createObjectURL(file);
    const media = document.createElement(kind === 'video' ? 'video' : 'img');
    if (kind === 'video') { media.muted = true; media.playsInline = true; media.preload = 'auto'; }
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Файл долго открывается. Попробуй другой формат или меньший размер.')); }, 10000);
        const cleanup = () => { clearTimeout(timeout); media.onload = media.onloadeddata = media.onerror = null; };
        const loaded = () => { cleanup(); resolve(); };
        media.onload = loaded; media.onloadeddata = loaded;
        media.onerror = () => { cleanup(); reject(new Error('Не удалось открыть файл. Возможно, формат или кодек не поддерживается браузером.')); };
        media.src = objectUrl;
      });
      const width = media.videoWidth || media.naturalWidth;
      const height = media.videoHeight || media.naturalHeight;
      if (!width || !height || width * height > 40000000) throw new Error('Выбери фон с разрешением до 40 мегапикселей.');
      const scale = Math.min(1, 1920 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height);
      const poster = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .85));
      if (!poster) throw new Error('Не удалось подготовить предпросмотр файла.');
      const header = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
      let animated = kind === 'video' || mime === 'image/gif';
      if (mime === 'image/png' && header.length > 8) {
        const view = new DataView(header.buffer);
        for (let position = 8; position + 12 <= header.length;) {
          const chunk = String.fromCharCode(...header.slice(position + 4, position + 8));
          if (chunk === 'acTL') { animated = true; break; }
          if (chunk === 'IDAT') break;
          position += view.getUint32(position) + 12;
        }
      }
      if (mime === 'image/webp' && String.fromCharCode(...header.slice(12, 16)) === 'VP8X') animated = Boolean(header[20] & 2);
      if (mime === 'image/avif') animated = String.fromCharCode(...header.slice(0, 256)).includes('avis');
      return { id: crypto.randomUUID(), name: file.name.slice(0, 180), mime, kind, animated, blob: new Blob([file], { type: mime }), poster };
    } finally {
      if (kind === 'video') { media.pause(); media.removeAttribute('src'); media.load(); }
      else media.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    }
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    const current = ++generation;
    validating = true; pending = null; uploadError = ''; error.textContent = '';
    $('#background-file-label').textContent = 'Готовим предпросмотр…';
    try {
      const asset = await inspect(file);
      if (current !== generation) return;
      pending = asset; removeAsset = false;
      $('input[name="background-mode"][value="custom"]').checked = true;
      showPreview(asset); updateDraft();
    } catch (reason) {
      if (current !== generation) return;
      uploadError = reason.message; error.textContent = uploadError;
      showPreview(null);
    } finally { if (current === generation) validating = false; }
  });
  $('#background-remove').addEventListener('click', () => {
    generation++; pending = null; removeAsset = true; validating = false; uploadError = ''; error.textContent = ''; fileInput.value = '';
    $('input[name="background-mode"][value="landscape"]').checked = true;
    showPreview(null); updateDraft();
  });
  document.querySelectorAll('input[name="background-mode"]').forEach(radio => radio.addEventListener('change', updateDraft));
  $('#background-dim').addEventListener('input', () => {
    $('#background-dim-value').textContent = `${$('#background-dim').value}%`;
    $('#background-preview').style.setProperty('--preview-dim', String(Number($('#background-dim').value) / 100));
  });
  $('#background-pause').addEventListener('click', () => {
    const previous = state.background.motion;
    state.background.motion = playbackBlocked || !previous; playbackBlocked = false;
    if (!save()) { state.background.motion = previous; return; }
    apply();
  });
  $('#settings-dialog').addEventListener('close', () => {
    generation++; pending = null; validating = false;
    showPreview(null); fileInput.value = '';
  });
  document.addEventListener('visibilitychange', apply);
  reduced.addEventListener('change', () => { if ($('#settings-dialog').open) updateDraft(); apply(); });
  window.addEventListener('pagehide', () => { application++; clearMedia(); });
  window.addEventListener('pageshow', apply);
  window.tisheBackground = {
    apply, openSettings,
    async prepare() {
      const mode = $('input[name="background-mode"]:checked').value;
      if (mode === 'custom' && validating) throw new Error('Дождись проверки файла.');
      if (mode === 'custom' && uploadError) throw new Error(uploadError);
      let assetId = removeAsset ? '' : state.background.assetId;
      if (pending && mode === 'custom') {
        await storage('put', pending); assetId = pending.id; preparedId = assetId;
      }
      if (mode === 'custom' && (!assetId || !(await storage('get', assetId)))) throw new Error('Сначала выбери картинку, GIF или видео.');
      return { mode, assetId, dim: Number($('#background-dim').value), motion: reduced.matches ? state.background.motion : $('#background-motion').checked };
    },
    async rollback() {
      if (preparedId) { await storage('delete', preparedId).catch(() => {}); preparedId = ''; }
    },
    async finish(oldId) {
      preparedId = '';
      if (oldId && oldId !== state.background.assetId) await storage('delete', oldId).catch(() => {});
    }
  };
  apply();
})();
