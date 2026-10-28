'use strict';
const $ = id => document.getElementById(id);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = value => { const n = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const art = track => {
  try { return new URL(track.artwork).protocol === 'https:' ? `<img src="${esc(track.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '♫'; } catch { return '♫'; }
};
let state = { tracks: [], jobs: [] }, toolState = {}, view = 'library', filter = 'all', selected = new Set(), currentId = null, shuffle = false, toastTimer, importing = false;
const audio = $('audio'); audio.volume = 0.75;
const labels = { library: 'Библиотека', favorites: 'Избранное', downloads: 'Загрузки' };
function toast(message, error = false) { $('toast').textContent = String(message).slice(0, 600); $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, error ? 12000 : 4500); }
async function call(channel, ...args) { try { return await window.meld.call(channel, ...args); } catch (error) { toast(error.message, true); throw error; } }
function filtered() {
  const query = $('search').value.trim().toLocaleLowerCase();
  return state.tracks.filter(t => (view !== 'favorites' || t.favorite) && (filter === 'all' || t.provider === filter) && (!query || `${t.title} ${t.artist}`.toLocaleLowerCase().includes(query)));
}
function source(t) { return t.provider === 'spotify' ? 'Spotify' : t.provider === 'soundcloud' ? 'SoundCloud' : 'Локальный файл'; }
function setView(value) {
  view = value; selected.clear();
  $('hero').hidden = value !== 'library'; $('library-tools').hidden = value === 'downloads'; $('download-all').hidden = value === 'downloads';
  $('track-list').hidden = value === 'downloads'; $('job-list').hidden = value !== 'downloads';
  $('breadcrumb').textContent = labels[value]; $('view-title').firstChild.textContent = value === 'library' ? 'Твоя библиотека ' : `${labels[value]} `;
  $('section-eyebrow').textContent = value === 'downloads' ? 'СОХРАНИТЬ И СЛУШАТЬ' : 'СОБРАНО ТОБОЙ';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === value)); render();
}
function setFilter(value) { filter = value; selected.clear(); document.querySelectorAll('.filter').forEach(n => n.classList.toggle('active', n.dataset.filter === value)); render(); }
function render() {
  $('library-count').textContent = state.tracks.length; $('favorites-count').textContent = state.tracks.filter(t => t.favorite).length;
  $('jobs-count').textContent = state.jobs.filter(j => ['queued', 'running'].includes(j.status)).length;
  for (const id of selected) if (!state.tracks.some(t => t.id === id)) selected.delete(id);
  const tracks = filtered();
  $('track-count').textContent = view === 'downloads' ? `${state.jobs.length} задач` : `${tracks.length} треков`;
  $('download-all').textContent = selected.size ? `↓ Скачать (${selected.size})` : '↓ Скачать всё';
  $('download-all').disabled = !tracks.some(t => !t.available);
  const empty = view === 'downloads' ? !state.jobs.length : !tracks.length;
  $('empty-state').hidden = !empty;
  if (empty) {
    $('empty-state').querySelector('h3').textContent = view === 'downloads' ? 'Очередь свободна' : state.tracks.length ? 'Пока ничего не нашлось' : 'Здесь будет твоя музыка';
    $('empty-state').querySelector('p').textContent = view === 'downloads' ? 'Добавь треки в библиотеку и нажми на стрелку загрузки.' : state.tracks.length ? 'Попробуй другой запрос, источник или добавь трек в избранное.' : 'Вставь ссылку на трек или плейлист. Или начни с файлов на компьютере.';
  }
  $('track-list').innerHTML = tracks.length ? `<div class="track-header"><input type="checkbox" id="select-all" aria-label="Выбрать все видимые треки" ${tracks.every(t => selected.has(t.id)) ? 'checked' : ''}><span></span><span>ТРЕК / ИСПОЛНИТЕЛЬ</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span><span></span></div>` + tracks.map(t => {
    const job = state.jobs.find(j => j.trackId === t.id && ['running', 'queued'].includes(j.status));
    return `<div class="track-row ${currentId === t.id ? 'is-playing' : ''}" data-id="${esc(t.id)}"><input class="select-track" type="checkbox" ${selected.has(t.id) ? 'checked' : ''} aria-label="Выбрать ${esc(t.title)}"><button class="cover" data-action="play" title="${t.available ? 'Воспроизвести' : 'Сначала скачайте трек'}">${art(t)}</button><button class="track-name" data-action="play" title="${esc(t.title)}"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></button><span class="provider-label">${source(t)}<small>${t.provider === 'spotify' ? 'аудио: YouTube' : t.available ? 'на устройстве' : 'ещё не скачано'}</small></span><span class="track-duration">${t.duration ? time(t.duration) : '—'}</span><div class="row-actions"><button class="icon-button ${t.favorite ? 'active' : ''}" data-action="favorite" title="Избранное" aria-label="Избранное">${t.favorite ? '♥' : '♡'}</button>${t.available ? '<button class="icon-button downloaded" data-action="reveal" title="Показать файл" aria-label="Показать файл">✓</button>' : `<button class="icon-button" data-action="download" title="Скачать" aria-label="Скачать" ${job ? 'disabled' : ''}>${job ? '◌' : '↓'}</button>`}${t.provider !== 'local' ? '<button class="icon-button" data-action="source" title="Открыть источник" aria-label="Открыть источник">↗</button>' : ''}<button class="icon-button" data-action="remove" title="Убрать из библиотеки, сохранив файл" aria-label="Убрать из библиотеки">×</button></div></div>`;
  }).join('') : '';
  const jobLabels = { queued: 'Ожидает', running: 'Загружается', done: 'Сохранено', failed: 'Не удалось', cancelled: 'Отменено', interrupted: 'Прервано' };
  $('job-list').innerHTML = state.jobs.map(j => {
    const t = state.tracks.find(t => t.id === j.trackId); if (!t) return '';
    return `<div class="job" data-job="${esc(j.id)}"><div class="job-top"><div><div class="job-title">${esc(t.title)}</div><div class="job-artist">${esc(t.artist)} · ${source(t)}${t.provider === 'spotify' ? ' → YouTube' : ''}</div></div><div class="job-actions"><span class="job-status ${j.status === 'failed' ? 'failed' : ''}">${jobLabels[j.status]}${j.status === 'running' && j.progress ? ` · ${j.progress}%` : ''}</span><button class="icon-button" data-job-action="log" title="Показать журнал" aria-label="Показать журнал">≡</button>${['running', 'queued'].includes(j.status) ? '<button class="button secondary" data-job-action="cancel">Отменить</button>' : j.status !== 'done' ? '<button class="button secondary" data-job-action="retry">Повторить</button>' : ''}</div></div>${j.error ? `<div class="job-log">${esc(j.error)}</div>` : ''}${j.status === 'running' ? '<div class="progress-bar"><i></i></div>' : ''}</div>`;
  }).join('');
  // The page CSP deliberately disallows inline styles; set progress via CSSOM.
  document.querySelectorAll('[data-job]').forEach(row => { const j = state.jobs.find(j => j.id === row.dataset.job); const bar = row.querySelector('.progress-bar i'); if (bar) bar.style.width = `${Number(j.progress) || 1}%`; });
  renderNow();
}
function renderNow() {
  const track = state.tracks.find(t => t.id === currentId);
  $('now-title').textContent = track?.title || 'Что послушаем?'; $('now-artist').textContent = track?.artist || 'Выбери трек из библиотеки'; $('now-cover').innerHTML = track ? art(track) : '♫';
  $('now-favorite').textContent = track?.favorite ? '♥' : '♡'; $('now-favorite').classList.toggle('active', !!track?.favorite); $('now-favorite').disabled = !track;
  $('playing-source').textContent = track ? track.provider === 'spotify' ? 'АУДИО: YOUTUBE' : source(track).toLocaleUpperCase() : 'ЛОКАЛЬНЫЙ ПЛЕЕР';
  $('play').textContent = audio.paused ? '▶' : 'Ⅱ'; $('play').setAttribute('aria-label', audio.paused ? 'Воспроизвести' : 'Пауза');
}
async function playTrack(id) {
  const track = state.tracks.find(t => t.id === id);
  if (!track?.available) { toast('Сначала скачай этот трек — стрелка справа от названия.'); return; }
  if (currentId !== id) { currentId = id; audio.src = track.mediaUrl; }
  try { await audio.play(); render(); } catch { toast('Не удалось воспроизвести файл. Проверь формат или загрузи запись заново.', true); }
}
async function togglePlay() {
  if (!currentId) { const first = filtered().find(t => t.available); if (first) await playTrack(first.id); else toast('Добавь локальный файл или скачай трек из библиотеки.'); return; }
  if (audio.paused) { try { await audio.play(); } catch { toast('Не удалось воспроизвести файл.', true); } } else audio.pause(); renderNow();
}
function advance(direction) {
  const tracks = filtered().filter(t => t.available);
  if (!tracks.length) return;
  const index = tracks.findIndex(t => t.id === currentId);
  const candidates = tracks.filter(t => t.id !== currentId);
  const track = shuffle && candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : tracks[(index + direction + tracks.length) % tracks.length];
  playTrack(track.id);
}
function showImport() { $('import-status').textContent = ''; $('import-dialog').showModal(); setTimeout(() => $('source-url').focus(), 30); }
function renderTools() {
  const s = toolState; const progress = s.progress;
  $('tool-status').textContent = s.installing ? `Установка ${progress?.step || 1}/${progress?.total || 6}: ${progress?.name || 'подготовка'} · ${progress?.percent || 0}%` : s.ready ? `Готово: spotDL ${s.versions?.spotdl || ''} · yt-dlp ${s.versions?.ytdlp || ''}` : 'Движки ещё не установлены. Локальные файлы уже можно слушать.';
  $('install-tools').disabled = !!s.installing; $('install-tools').textContent = s.installing ? 'Установка…' : s.ready ? 'Переустановить движки' : 'Установить движки';
}
function renderCredentials(s) { $('credential-status').textContent = s.configured ? 'Ключи сохранены' : 'Ключи не заданы'; }
function handle(promise) { Promise.resolve(promise).catch(() => {}); }
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { if (view === 'downloads') setView('library'); setFilter(button.dataset.filter); }));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); setView('library'); setFilter('all'); });
['hero-import', 'import-button'].forEach(id => $(id).addEventListener('click', showImport));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('settings-button').addEventListener('click', () => { renderTools(); $('settings-dialog').showModal(); });
$('search').addEventListener('input', () => { selected.clear(); render(); });
async function addFiles() { const result = await call('import-files'); if (result.added) { toast(`Добавлено файлов: ${result.added}`); setView('library'); setFilter('all'); } }
['add-files-top', 'empty-local', 'dialog-local'].forEach(id => $(id).addEventListener('click', () => { if (id === 'dialog-local') $('import-dialog').close(); handle(addFiles()); }));
$('import-form').addEventListener('submit', async event => {
  event.preventDefault(); if (importing) return;
  if (!toolState.ready) { $('import-dialog').close(); $('settings-dialog').showModal(); toast('Сначала установи движки. Это нужно сделать один раз.'); return; }
  importing = true; $('submit-import').disabled = true; $('source-url').disabled = true; $('import-status').textContent = 'Читаю список треков. Большой плейлист может занять несколько минут…';
  try { const result = await window.meld.call('import-url', $('source-url').value); $('import-dialog').close(); $('source-url').value = ''; setView('library'); setFilter('all'); toast(`Импортировано: ${result.added} новых треков из ${result.total}. Теперь можно выбрать записи для скачивания.`); }
  catch (error) { $('import-status').textContent = error.message; }
  finally { importing = false; $('submit-import').disabled = false; $('source-url').disabled = false; }
});
$('track-list').addEventListener('change', event => {
  if (event.target.id === 'select-all') { filtered().forEach(t => event.target.checked ? selected.add(t.id) : selected.delete(t.id)); }
  else if (event.target.classList.contains('select-track')) { const id = event.target.closest('[data-id]').dataset.id; event.target.checked ? selected.add(id) : selected.delete(id); }
  render();
});
$('track-list').addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const id = button.closest('[data-id]').dataset.id;
  const action = button.dataset.action;
  if (action === 'play') handle(playTrack(id));
  if (action === 'favorite') handle(call('favorite', id));
  if (action === 'download') handle(call('enqueue', [id]).then(() => toast('Добавлено в очередь загрузок.')));
  if (action === 'reveal') handle(call('reveal', id));
  if (action === 'source') handle(call('open-source', id));
  if (action === 'remove') handle(call('remove', id).then(() => { if (currentId === id) { audio.pause(); audio.removeAttribute('src'); audio.load(); currentId = null; renderNow(); } }));
});
$('download-all').addEventListener('click', () => { const ids = selected.size ? [...selected] : filtered().filter(t => !t.available).map(t => t.id); handle(call('enqueue', ids).then(() => { setView('downloads'); toast('Треки добавлены в очередь.'); })); });
$('job-list').addEventListener('click', event => {
  const button = event.target.closest('[data-job-action]'); if (!button) return;
  const job = state.jobs.find(j => j.id === button.closest('[data-job]').dataset.job); if (!job) return;
  if (button.dataset.jobAction === 'cancel') handle(call('cancel', job.id));
  if (button.dataset.jobAction === 'retry') handle(call('enqueue', [job.trackId]));
  if (button.dataset.jobAction === 'log') { $('log-content').textContent = [job.error, job.log].filter(Boolean).join('\n\n') || 'Подробностей пока нет.'; $('log-dialog').showModal(); }
});
$('install-tools').addEventListener('click', async () => {
  toolState.installing = true; renderTools();
  try { toolState = await call('install-tools'); toast('Движки установлены. Можно импортировать музыку.'); }
  catch { toolState.installing = false; }
  renderTools();
});
$('credentials-form').addEventListener('submit', async event => { event.preventDefault(); try { renderCredentials(await call('save-credentials', { clientId: $('client-id').value.trim(), clientSecret: $('client-secret').value.trim() })); $('client-id').value = ''; $('client-secret').value = ''; toast('Ключи сохранены в защищённом хранилище.'); } catch {} });
$('clear-credentials').addEventListener('click', () => handle(call('clear-credentials').then(renderCredentials)));
$('open-library').addEventListener('click', () => handle(call('open-library')));
$('play').addEventListener('click', () => handle(togglePlay())); $('previous').addEventListener('click', () => { if (audio.currentTime > 3) audio.currentTime = 0; else advance(-1); }); $('next').addEventListener('click', () => advance(1));
$('shuffle').addEventListener('click', () => { shuffle = !shuffle; $('shuffle').classList.toggle('active', shuffle); });
$('repeat').addEventListener('click', () => { audio.loop = !audio.loop; $('repeat').classList.toggle('active', audio.loop); });
$('volume').addEventListener('input', () => audio.volume = Number($('volume').value));
$('seek').addEventListener('input', () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number($('seek').value) / 1000 * audio.duration; });
$('now-favorite').addEventListener('click', () => { if (currentId) handle(call('favorite', currentId)); });
audio.addEventListener('timeupdate', () => { $('elapsed').textContent = time(audio.currentTime); if (audio.duration) $('seek').value = audio.currentTime / audio.duration * 1000; });
audio.addEventListener('loadedmetadata', () => $('duration').textContent = time(audio.duration));
audio.addEventListener('play', renderNow); audio.addEventListener('pause', renderNow); audio.addEventListener('ended', () => advance(1));
audio.addEventListener('error', () => { if (audio.getAttribute('src')) toast('Не удалось прочитать аудио. Проверь файл в папке библиотеки.', true); });
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); $('settings-button').click(); }
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') { event.preventDefault(); $('search').focus(); }
  if (event.code === 'Space' && !event.target.closest('input,textarea,button,dialog')) { event.preventDefault(); handle(togglePlay()); }
});
window.meld.on('state', value => { state = value; render(); });
window.meld.on('tools-state', value => { toolState = value; renderTools(); });
window.meld.on('app-message', message => toast(message));
window.meld.on('activity', ({ line }) => { if (importing && line && !/token|secret/i.test(line)) $('import-status').textContent = `Читаю список: ${line.slice(-200)}`; });
handle((async () => { const data = await call('init'); state = data.state; toolState = data.tools; $('version').textContent = data.version; document.body.classList.toggle('windows', data.platform === 'win32'); renderCredentials(data.credentials); renderTools(); render(); if (state.recoveryWarning) toast(state.recoveryWarning, true); })());
