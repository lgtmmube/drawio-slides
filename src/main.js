import './style.css';
import { EditorBridge } from './editor-bridge.js';
import { exportPresentation } from './pptx-export.js';
import { mountExportPreview } from './export-preview.js';
import { icon } from './icons.js';
import { blankXML, loadDemo } from './sample.js';
import { readDraft, writeDraft } from './storage.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { ready: false, loading: false, exporting: false, dirty: false, name: '無題.drawio', handle: null, deckId: null, selectedId: null, mode: 'image', revision: 0, thumbRevision: 0, thumbnails: new Map(), placement: false, sidebarSignature: '', draftTimer: null, thumbTimer: null };
let bridge;
let recoveryDraft;
let thumbnailBusy = false;
let toastTimer;
let exportPreview;
const layoutKey = 'drawio-slides:layout';
const layout = { headerCollapsed: false, sidebarCollapsed: false };
try {
  const saved = JSON.parse(localStorage.getItem(layoutKey));
  layout.headerCollapsed = saved?.headerCollapsed === true;
  layout.sidebarCollapsed = saved?.sidebarCollapsed === true;
} catch { /* Layout preferences are optional when storage is unavailable. */ }

$('#app').innerHTML = `
  <header id="app-header" class="app-header">
    <span class="brand">${icon('slides', 21)}<span>スライド</span></span>
    <div class="file-identity"><span id="file-name">無題.drawio</span><span id="file-status" class="file-status">準備中</span></div>
    <nav class="file-actions" aria-label="ファイル操作">
      <button class="button button-dark" id="new-file" title="新規" aria-label="新規">${icon('document', 16)}<span>新規</span></button>
      <button class="button button-dark" id="open-file" title="開く" aria-label="開く">${icon('folder', 16)}<span>開く</span></button>
      <button class="button button-dark" id="save-file" title="保存" aria-label="保存">${icon('save', 16)}<span>保存</span></button>
    </nav>
    <button class="icon-button" id="help" title="ヘルプ" aria-label="ヘルプ">${icon('help', 18)}</button>
    <button class="button button-primary" id="open-export">${icon('export', 16)}<span>PowerPoint出力</span></button>
    <button class="icon-button" id="collapse-header" title="上部バーを折りたたむ" aria-label="上部バーを折りたたむ" aria-controls="app-header" aria-expanded="true">${icon('up', 16)}</button>
  </header>
  <button class="chrome-handle header-handle" id="expand-header" title="上部バーを表示" aria-label="上部バーを表示" aria-controls="app-header" aria-expanded="false" hidden>${icon('down', 16)}</button>
  <main class="workspace">
    <section class="editor-pane" aria-label="draw.io 作図キャンバス">
      <iframe id="drawio-editor" title="draw.io 作図エディター" allow="clipboard-read; clipboard-write" src="/editor/index.html?embed=1&proto=json&spin=1&noSaveBtn=1&saveAndExit=0&noExitBtn=1&libraries=1&lang=ja&offline=1&local=1&stealth=1&ui=kennedy&dark=0&pv=0"></iframe>
      <div id="editor-loading" class="editor-loading"><div class="spinner"></div><span>読み込み中…</span></div>
      <div id="placement-banner" class="placement-banner" hidden>${icon('frame', 18)}<span>スライド枠を置く場所をクリック</span><button id="cancel-placement">キャンセル <kbd>Esc</kbd></button></div>
      <div id="export-blocker" class="export-blocker" hidden></div>
    </section>
    <aside id="slide-sidebar" class="slide-sidebar" aria-label="スライド一覧">
      <div class="sidebar-heading"><h1>スライド</h1><span id="slide-count" class="count-badge">0</span><button class="icon-button" id="collapse-sidebar" title="スライド一覧を折りたたむ" aria-label="スライド一覧を折りたたむ" aria-controls="slide-sidebar" aria-expanded="true">${icon('right', 16)}</button></div>
      <div class="deck-row"><label class="sr-only" for="deck-select">発表セット</label><select id="deck-select"></select><button class="icon-button" id="deck-settings" title="発表セットの設定" aria-label="発表セットの設定">${icon('settings')}</button><button class="icon-button" id="new-deck" title="発表セットを追加" aria-label="発表セットを追加">${icon('plus')}</button></div>
      <div class="sidebar-tools"><button class="text-button" id="register-frame" title="選択した長方形をスライド枠として使う">${icon('frame', 16)}選択枠を登録</button><span id="ratio-badge">16:9</span></div>
      <div id="slide-list" class="slide-list"></div>
      <div class="sidebar-bottom"><button class="button button-add" id="add-frame">${icon('plus', 16)}スライドを追加</button></div>
    </aside>
    <button class="chrome-handle sidebar-handle" id="expand-sidebar" title="スライド一覧を表示" aria-label="スライド一覧を表示" aria-controls="slide-sidebar" aria-expanded="false" hidden>${icon('left', 16)}</button>
  </main>
  <footer class="statusbar"><span id="status-message"></span><span id="page-name"></span></footer>
  <dialog id="main-dialog" class="main-dialog"><div id="dialog-content"></div></dialog>
  <input id="file-input" type="file" accept=".drawio,.xml" hidden />
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;

function applyLayout() {
  $('#app-header').hidden = layout.headerCollapsed;
  $('#expand-header').hidden = !layout.headerCollapsed;
  $('#slide-sidebar').hidden = layout.sidebarCollapsed;
  $('#expand-sidebar').hidden = !layout.sidebarCollapsed;
  for (const id of ['collapse-header', 'expand-header']) $(`#${id}`).setAttribute('aria-expanded', String(!layout.headerCollapsed));
  for (const id of ['collapse-sidebar', 'expand-sidebar']) $(`#${id}`).setAttribute('aria-expanded', String(!layout.sidebarCollapsed));
  if (!layout.sidebarCollapsed) scheduleThumbnails();
}
function setCollapsed(panel, collapsed) {
  layout[`${panel}Collapsed`] = collapsed;
  applyLayout();
  try { localStorage.setItem(layoutKey, JSON.stringify(layout)); } catch { /* The current layout still works without persistence. */ }
  $(`#${collapsed ? 'expand' : 'collapse'}-${panel}`).focus({ preventScroll: true });
}

function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8500 : 4200);
}
function errorMessage(error) {
  return error?.message || String(error);
}
function updateFileStatus() {
  $('#file-name').textContent = state.name;
  $('#file-name').title = state.name;
  $('#file-status').textContent = state.loading ? '読み込み中' : state.dirty ? '変更あり' : '保存済み';
  $('#file-status').classList.toggle('unsaved', state.dirty);
  document.title = `${state.dirty ? '● ' : ''}${state.name} — draw.io Slides`;
  ['open-export', 'open-file', 'new-file', 'save-file', 'add-frame', 'register-frame', 'deck-settings', 'new-deck'].forEach(id => { $(`#${id}`).disabled = !state.ready || state.loading || state.exporting; });
}
function getDeck() {
  const decks = bridge?.getDecks() || [];
  const deck = decks.find(d => d.id === state.deckId) || decks[0];
  if (deck) state.deckId = deck.id;
  return deck;
}
function getFrames() {
  return (bridge?.getFrames() || []).filter(frame => frame.deckId === getDeck()?.id).sort((a, b) => a.order - b.order);
}
function setStatus(message) { $('#status-message').textContent = message; }

async function persistDraft() {
  if (!state.ready || state.loading || state.exporting) return;
  if (bridge.graph?.isEditing()) {
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(persistDraft, 1800);
    return;
  }
  try {
    const revision = state.revision;
    const xml = await bridge.getXML();
    await writeDraft({ name: state.name, xml, deckId: state.deckId });
    if (revision === state.revision) setStatus(`一時保存 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (error) {
    setStatus('一時保存できませんでした。「保存」でファイルを保存してください。');
    console.warn('Draft persistence failed', error);
  }
}
function onDiagramChange() {
  if (!state.ready || state.loading || state.exporting) return;
  state.dirty = true;
  state.revision++;
  state.thumbRevision++;
  updateFileStatus();
  renderSidebar();
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(persistDraft, 1800);
  scheduleThumbnails();
}

function renderSidebar() {
  if (!state.ready || state.loading) return;
  const decks = bridge.getDecks();
  const deck = getDeck();
  const frames = getFrames();
  if (!frames.some(f => f.id === state.selectedId)) state.selectedId = frames[0]?.id || null;
  const deckSignature = JSON.stringify(decks.map(d => [d.id, d.name]));
  if ($('#deck-select').dataset.signature !== deckSignature) {
    $('#deck-select').innerHTML = decks.map(d => `<option value="${escape(d.id)}">${escape(d.name)}</option>`).join('');
    $('#deck-select').dataset.signature = deckSignature;
  }
  $('#deck-select').value = deck?.id || '';
  $('#slide-count').textContent = frames.length;
  $('#ratio-badge').textContent = deck?.ratio || '16:9';
  const pageInfo = bridge.getPageInfo?.();
  if (pageInfo) $('#page-name').textContent = pageInfo.name || pageInfo.pageName || 'キャンバス';
  const signature = JSON.stringify([frames.map(f => [f.id, f.title, f.enabled, f.locked, f.order, f.width, f.height]), state.selectedId, deck?.id]);
  if (signature === state.sidebarSignature) return;
  state.sidebarSignature = signature;
  const list = $('#slide-list');
  const scroll = list.scrollTop;
  list.innerHTML = frames.length ? frames.map((frame, index) => {
    const thumb = state.thumbnails.get(frame.id);
    return `<article class="slide-card ${frame.id === state.selectedId ? 'selected' : ''} ${!frame.enabled ? 'excluded' : ''}" data-frame="${escape(frame.id)}" draggable="true" tabindex="0" aria-label="スライド ${index + 1} ${escape(frame.title)}">
      <div class="slide-card-top"><span class="slide-number">${String(index + 1).padStart(2, '0')}</span><label class="include-label"><input type="checkbox" data-action="include" ${frame.enabled ? 'checked' : ''} aria-label="${escape(frame.title)}を出力に含める" />出力</label><span class="grip">${icon('grip', 15)}</span></div>
      <button class="slide-thumbnail" data-action="focus" aria-label="${escape(frame.title)}へ移動" style="aspect-ratio:${frame.width}/${frame.height}">${thumb ? `<img src="${thumb.data}" alt="${escape(frame.title)}のプレビュー" />` : `<span class="thumbnail-placeholder">${icon('frame', 28)}</span>`}</button>
      <div class="slide-title-row"><input class="slide-title-input" value="${escape(frame.title)}" aria-label="スライド ${index + 1} のタイトル" maxlength="120" data-action="title" /></div>
      <div class="slide-card-actions"><span class="frame-dimensions">${Math.round(frame.width)} × ${Math.round(frame.height)}</span><div><button class="icon-button mini" data-action="up" title="前へ移動" aria-label="前へ移動" ${index === 0 ? 'disabled' : ''}>${icon('up', 16)}</button><button class="icon-button mini" data-action="down" title="後ろへ移動" aria-label="後ろへ移動" ${index === frames.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button><button class="icon-button mini ${frame.locked ? 'is-locked' : ''}" data-action="lock" title="${frame.locked ? '枠のロックを解除' : '枠をロック'}" aria-label="${frame.locked ? '枠のロックを解除' : '枠をロック'}">${icon(frame.locked ? 'lock' : 'unlock', 15)}</button><button class="icon-button mini danger-hover" data-action="delete" title="枠だけを削除" aria-label="枠だけを削除">${icon('trash', 15)}</button></div></div>
    </article>`;
  }).join('') : `<div class="empty-slides"><p>スライドがありません</p></div>`;
  list.scrollTop = scroll;
  scheduleThumbnails();
}

function scheduleThumbnails() {
  clearTimeout(state.thumbTimer);
  state.thumbTimer = setTimeout(refreshThumbnails, 650);
}
async function refreshThumbnails() {
  if (thumbnailBusy || exportPreview || state.exporting || state.loading || !state.ready || layout.sidebarCollapsed) return;
  thumbnailBusy = true;
  const revision = state.thumbRevision;
  const deck = getDeck();
  const listRect = $('#slide-list').getBoundingClientRect();
  try {
    for (const card of $('#slide-list').querySelectorAll('.slide-card')) {
      if (exportPreview || state.exporting || state.loading || layout.sidebarCollapsed || revision !== state.thumbRevision) break;
      const rect = card.getBoundingClientRect();
      if (rect.bottom < listRect.top || rect.top > listRect.bottom) continue;
      const id = card.dataset.frame;
      if (state.thumbnails.get(id)?.revision === revision) continue;
      try {
        const data = await bridge.renderFrame(id, { width: 420, background: deck.background });
        if (state.loading || revision !== state.thumbRevision) break;
        state.thumbnails.set(id, { data, revision });
        const thumbnail = card.querySelector('.slide-thumbnail');
        if (card.isConnected) {
          const img = new Image(); img.src = data; img.alt = `${card.querySelector('.slide-title-input').value}のプレビュー`;
          thumbnail.replaceChildren(img);
        }
      } catch (error) { console.warn('Thumbnail unavailable', id, error); }
    }
  } finally {
    thumbnailBusy = false;
    if (revision !== state.thumbRevision) scheduleThumbnails();
  }
}

function disposeExportPreview() {
  exportPreview?.dispose();
  exportPreview = null;
}
function openDialog(html, className = '') {
  disposeExportPreview();
  const dialog = $('#main-dialog');
  if (dialog.open) dialog.close();
  dialog.className = `main-dialog ${className}`;
  $('#dialog-content').innerHTML = html;
  dialog.showModal();
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
}
const closeButton = () => `<button class="icon-button dialog-close" data-close aria-label="閉じる">${icon('close', 21)}</button>`;

function showWelcome() {
  openDialog(`<div class="welcome-content">${closeButton()}<h2>図を開く</h2>
    ${recoveryDraft ? `<button class="recovery-button" id="recover-draft">${icon('history', 21)}<span><strong>前回の作業を再開</strong><small>${escape(recoveryDraft.name)} · ${new Date(recoveryDraft.updatedAt).toLocaleString('ja-JP')}</small></span>${icon('arrow')}</button>` : ''}
    <div class="welcome-actions"><button class="button button-primary" id="welcome-open">${icon('folder', 16)}ファイルを開く</button><button class="button button-outline" id="welcome-new">新規作成</button></div><button class="text-button welcome-demo" id="welcome-demo">サンプルを開く</button></div>`, 'welcome-dialog');
  $('#welcome-open').onclick = () => { $('#main-dialog').close(); openFile(); };
  $('#welcome-new').onclick = () => { $('#main-dialog').close(); beginPlacement(); };
  $('#welcome-demo').onclick = () => { $('#main-dialog').close(); createDemo(); };
  if ($('#recover-draft')) $('#recover-draft').onclick = async () => {
    $('#main-dialog').close();
    await loadDocument(recoveryDraft.xml, recoveryDraft.name, null, true);
    state.deckId = recoveryDraft.deckId;
    state.sidebarSignature = ''; renderSidebar();
    notify('前回の作業を復元しました');
  };
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  return new Promise(resolve => {
    openDialog(`${closeButton()}<div class="dialog-heading"><h2>別のファイルへ切り替えますか？</h2><p>今の変更を残すには、先にファイルへ保存してください。</p></div><div class="dialog-actions"><button class="button button-outline" id="switch-cancel">戻る</button><button class="button button-outline" id="switch-without">保存せず切り替え</button><button class="button button-primary" id="switch-save">保存して切り替え</button></div>`);
    const dialog = $('#main-dialog');
    let finished = false;
    const finish = value => { if (finished) return; finished = true; dialog.close(); resolve(value); };
    dialog.addEventListener('close', () => { if (!finished) { finished = true; resolve(false); } }, { once: true });
    $('#switch-cancel').onclick = () => finish(false);
    $('#switch-without').onclick = () => finish(true);
    $('#switch-save').onclick = async () => { const saved = await saveFile(); if (saved) finish(true); };
  });
}
async function loadDocument(xml, name, handle = null, dirty = false) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || !['mxfile', 'mxGraphModel'].includes(document.documentElement.nodeName)) throw new Error('有効な .drawio またはXMLファイルを選んでください。');
  cancelPlacement();
  clearTimeout(state.draftTimer);
  state.loading = true; updateFileStatus();
  try {
    await bridge.loadXML(xml, name);
    state.name = name.endsWith('.drawio') ? name : name.replace(/\.xml$/i, '') + '.drawio';
    state.handle = handle; state.deckId = null; state.selectedId = null; state.dirty = dirty;
    state.revision++; state.thumbRevision++; state.thumbnails.clear(); state.sidebarSignature = '';
  } finally { state.loading = false; updateFileStatus(); renderSidebar(); }
  await persistDraft();
}
async function openFile() {
  if (!state.ready || state.exporting || !(await confirmDiscard())) return;
  try {
    if ('showOpenFilePicker' in window) {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'draw.ioファイル', accept: { 'application/xml': ['.drawio', '.xml'] } }], multiple: false });
      const file = await handle.getFile();
      await loadDocument(await file.text(), file.name, handle);
    } else $('#file-input').click();
  } catch (error) { if (error.name !== 'AbortError') notify(errorMessage(error), true); }
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function saveFile() {
  if (!state.ready || state.loading || state.exporting) return false;
  try {
    const revision = state.revision;
    const xml = await bridge.getXML();
    if ('showSaveFilePicker' in window) {
      const handle = state.handle || await window.showSaveFilePicker({ suggestedName: state.name, types: [{ description: 'draw.ioファイル', accept: { 'application/xml': ['.drawio'] } }] });
      const writable = await handle.createWritable();
      await writable.write(xml); await writable.close(); state.handle = handle; state.name = handle.name;
    } else downloadBlob(new Blob([xml], { type: 'application/xml;charset=utf-8' }), state.name);
    if (revision === state.revision) state.dirty = false;
    updateFileStatus(); await persistDraft(); notify('保存しました'); return true;
  } catch (error) { if (error.name !== 'AbortError') notify(errorMessage(error), true); return false; }
}
async function newFile() {
  if (!state.ready || !(await confirmDiscard())) return;
  try { await loadDocument(blankXML, '無題.drawio'); beginPlacement(); } catch (error) { notify(errorMessage(error), true); }
}
async function createDemo() {
  if (!state.ready || !(await confirmDiscard())) return;
  state.loading = true; clearTimeout(state.draftTimer); updateFileStatus();
  try {
    const first = await loadDemo(bridge);
    state.name = '研究スライド・サンプル.drawio'; state.handle = null; state.deckId = null;
    state.selectedId = first.id; state.thumbnails.clear(); state.thumbRevision++; state.sidebarSignature = '';
    state.dirty = true;
  } catch (error) { notify(errorMessage(error), true); }
  finally { state.loading = false; updateFileStatus(); renderSidebar(); persistDraft(); }
}

function beginPlacement() {
  if (!state.ready || state.exporting) return;
  try {
    state.placement = true; $('#placement-banner').hidden = false;
    bridge.startFramePlacement({ deckId: getDeck().id }, frame => {
      cancelPlacement(); state.selectedId = frame.id; state.sidebarSignature = ''; onDiagramChange();
    });
  } catch (error) { cancelPlacement(); notify(errorMessage(error), true); }
}
function cancelPlacement() {
  state.placement = false; $('#placement-banner').hidden = true; bridge?.cancelPlacement();
}
function showDeckDialog(isNew = false) {
  const deck = getDeck();
  const hasFrames = getFrames().length > 0;
  openDialog(`${closeButton()}<div class="dialog-heading"><h2>${isNew ? '発表セットを追加' : '発表セットの設定'}</h2></div><form id="deck-form"><div class="form-fields"><label>発表名<input id="deck-name-input" required maxlength="80" value="${escape(isNew ? '' : deck.name)}" placeholder="例：学会発表" autofocus /></label><div class="form-columns"><label>スライドの縦横比<select id="deck-ratio-input" ${!isNew && hasFrames ? 'disabled' : ''}><option value="16:9">16:9（ワイド）</option><option value="4:3">4:3（標準）</option></select></label><label>背景色<input id="deck-color-input" type="color" value="${escape(isNew ? '#ffffff' : deck.background || '#ffffff')}" /></label></div>${!isNew && hasFrames ? '<p class="field-note">比率の変更には新しい発表セットを作成してください。</p>' : ''}</div><div class="dialog-actions"><button type="button" class="button button-outline" data-cancel>戻る</button><button class="button button-primary" type="submit">${isNew ? '作成' : '保存'}</button></div></form>`);
  $('#deck-ratio-input').value = isNew ? '16:9' : deck.ratio;
  $('[data-cancel]').onclick = () => $('#main-dialog').close();
  $('#deck-form').onsubmit = event => {
    event.preventDefault();
    try {
      const patch = { name: $('#deck-name-input').value.trim() || '発表', ratio: $('#deck-ratio-input').value, background: $('#deck-color-input').value };
      if (isNew) state.deckId = bridge.addDeck(patch).id; else bridge.updateDeck(deck.id, patch);
      state.sidebarSignature = ''; state.selectedId = null; $('#main-dialog').close(); onDiagramChange();
    } catch (error) { notify(errorMessage(error), true); }
  };
}

function showHelp() {
  openDialog(`${closeButton()}<div class="dialog-heading"><h2>ヘルプ</h2></div><div class="help-content"><ol><li><strong>いつものファイルを開く</strong><p>.drawioファイルを開き、普段と同じように作図します。</p></li><li><strong>スライドの範囲に枠を置く</strong><p>「スライドを追加」を押し、キャンバスをクリック。既存の長方形は、選択して「選択枠を登録」で使えます。</p></li><li><strong>右の一覧で発表順を決める</strong><p>ドラッグ、または上下ボタンで並べ替えます。「出力」を外すと、下書きとして残せます。</p></li><li><strong>出力モードを選ぶ</strong><p><b>画像</b>：draw.ioの描画を画像にして、配置や改行を保ちます。<br><b>編集可能</b>：対応する文字・図形・線を個別に編集できます。特殊素材は画像になり、フォントや改行等に違いが生じる場合があります。</p></li></ol><div class="help-note"><p>枠を動かしても中の図は動きません。枠を削除しても図は残ります。</p><p>作業内容はこのブラウザに一時保存されます。通常のdraw.ioでも使うときは「保存」でファイルに保存してください。</p><p>PowerPointでの修正はdraw.ioに戻りません。出力し直すと、新しいPowerPointファイルになります。</p></div></div><div class="dialog-actions"><button class="button button-outline" id="load-demo">サンプルを開く</button><button class="button button-primary" id="help-done">閉じる</button></div>`, 'help-dialog');
  $('#help-done').onclick = () => $('#main-dialog').close();
  $('#load-demo').onclick = () => { $('#main-dialog').close(); createDemo(); };
}

async function showExportDialog() {
  if (!state.ready || state.exporting) return;
  bridge.graph.stopEditing(false);
  const deck = getDeck();
  const frames = getFrames().filter(frame => frame.enabled);
  if (!frames.length) { notify('出力するスライド枠を追加し、「出力」にチェックを入れてください。'); return; }
  cancelPlacement();
  openDialog(`${closeButton()}<div class="dialog-heading"><h2>PowerPoint出力</h2><p>${escape(deck.name)} · ${frames.length}枚 · ${escape(deck.ratio)}</p></div>
    <div class="export-layout"><div class="export-options"><div class="mode-options" role="radiogroup" aria-label="出力モード">
      <label class="mode-option ${state.mode === 'image' ? 'chosen' : ''}"><input type="radio" name="export-mode" value="image" ${state.mode === 'image' ? 'checked' : ''} /><span class="mode-icon">${icon('image', 24)}</span><span><strong>画像モード</strong><p>見た目を保持。スライド全体を1枚の画像にします。</p></span></label>
      <label class="mode-option ${state.mode === 'editable' ? 'chosen' : ''}"><input type="radio" name="export-mode" value="editable" ${state.mode === 'editable' ? 'checked' : ''} /><span class="mode-icon">${icon('edit', 24)}</span><span><strong>編集可能モード</strong><p>文字・図形・矢印を個別に編集。特殊素材は画像になります。</p></span></label></div>
      <p id="mode-note" class="mode-note"></p><label class="resolution-field" id="resolution-field">画像の解像度<select id="image-resolution"><option value="3840">高画質 · 横3840px</option><option value="1920">標準 · 横1920px</option></select></label>
      <label class="filename-field">ファイル名<input id="export-filename" value="${escape(deck.name)}" maxlength="120" /><span>.pptx</span></label></div>
    <section id="export-preview" class="export-preview" aria-label="作図プレビュー"></section></div>
    <div id="export-progress" class="export-progress" hidden><div class="progress-label"><span id="export-progress-text">出力の準備中…</span><span id="export-progress-count"></span></div><progress id="export-progress-bar" max="${frames.length}" value="0"></progress></div>
    <div class="dialog-actions"><button class="button button-outline" id="export-cancel">戻る</button><button class="button button-primary" id="export-confirm">${icon('export')} ${frames.length}枚を書き出す</button></div>`, 'export-dialog');
  function modeChanged() {
    state.mode = $('input[name="export-mode"]:checked').value;
    for (const option of document.querySelectorAll('.mode-option')) option.classList.toggle('chosen', option.querySelector('input').checked);
    $('#resolution-field').hidden = state.mode !== 'image';
    $('#mode-note').textContent = state.mode === 'image' ? '' : '見た目の完全一致を保証しません。フォント・改行などに差が出る場合があります。';
    $('#mode-note').classList.toggle('editable-note', state.mode === 'editable');
    $('#mode-note').hidden = state.mode === 'image';
  }
  document.querySelectorAll('input[name="export-mode"]').forEach(input => input.onchange = modeChanged);
  modeChanged();
  $('#export-cancel').onclick = () => $('#main-dialog').close();
  $('#export-confirm').onclick = () => performExport(frames, deck);
  exportPreview = mountExportPreview({ container: $('#export-preview'), bridge, frames, deck });
}

async function performExport(frames, deck) {
  const filename = ($('#export-filename').value.trim() || deck.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.pptx$/i, '') + (state.mode === 'image' ? '_画像.pptx' : '_編集可能.pptx');
  const imageWidth = Number($('#image-resolution').value);
  const controller = new AbortController();
  disposeExportPreview();
  state.exporting = true; updateFileStatus(); $('#export-blocker').hidden = false;
  $('#export-confirm').disabled = true; $('#export-progress').hidden = false;
  document.querySelectorAll('.export-options input,.export-options select').forEach(input => input.disabled = true);
  $('#export-cancel').textContent = '出力を中止'; $('#export-cancel').onclick = () => controller.abort();
  $('[data-close]').disabled = true;
  const dialog = $('#main-dialog');
  const preventClose = event => { event.preventDefault(); controller.abort(); };
  dialog.addEventListener('cancel', preventClose);
  try {
    const result = await exportPresentation({ bridge, frames, deck, mode: state.mode, imageWidth, filename, signal: controller.signal,
      onProgress: (...args) => {
        let info = args[0];
        if (typeof info === 'number') info = { current: info, total: args[1], message: args[2] };
        const current = info?.current ?? info?.completed ?? info?.index ?? 0;
        if ($('#export-progress-text')) $('#export-progress-text').textContent = info?.message || `${current}枚目を作成しています…`;
        if ($('#export-progress-count')) $('#export-progress-count').textContent = `${current} / ${frames.length}`;
        if ($('#export-progress-bar')) $('#export-progress-bar').value = current;
      },
    });
    if (controller.signal.aborted) throw new DOMException('出力を中止しました', 'AbortError');
    downloadBlob(result.blob, filename);
    showExportResult(result, filename, frames.length);
  } catch (error) {
    dialog.close();
    notify(error.name === 'AbortError' ? '出力を中止しました。作図内容はそのままです。' : `出力できませんでした：${errorMessage(error)}`, error.name !== 'AbortError');
  } finally {
    state.exporting = false; $('#export-blocker').hidden = true; dialog.removeEventListener('cancel', preventClose); updateFileStatus(); scheduleThumbnails(); persistDraft();
  }
}
function showExportResult(result, filename, count) {
  const warnings = result.warnings || [];
  const stats = result.stats || {};
  openDialog(`${closeButton()}<div class="export-success-mark">${icon('check', 30)}</div><div class="dialog-heading centered"><h2>${count}枚のスライドを書き出しました</h2><p>${escape(filename)}</p></div><div class="export-summary"><span>${state.mode === 'image' ? '画像モード' : '編集可能モード'}</span><span>${escape(getDeck().ratio)}</span>${stats.fallbacks ? `<span>${stats.fallbacks}要素を画像化</span>` : ''}</div>${warnings.length ? `<details class="export-warnings" open><summary>変換についての確認事項（${warnings.length}件）</summary><ul>${warnings.slice(0, 100).map(warning => `<li>${escape(typeof warning === 'string' ? warning : warning.message)}</li>`).join('')}</ul>${warnings.length > 100 ? '<p>その他の確認事項があります。出力後のスライドをご確認ください。</p>' : ''}</details>` : ''}<div class="dialog-actions"><button class="button button-outline" id="export-again">別のモードでも出力</button><button class="button button-primary" id="export-done">作図に戻る</button></div>`, 'result-dialog');
  $('#export-done').onclick = () => $('#main-dialog').close();
  $('#export-again').onclick = () => { state.mode = state.mode === 'image' ? 'editable' : 'image'; showExportDialog(); };
}

$('#open-file').onclick = openFile;
$('#main-dialog').addEventListener('close', () => {
  if (!$('#main-dialog').open) {
    disposeExportPreview();
    scheduleThumbnails();
  }
});
$('#save-file').onclick = saveFile;
$('#new-file').onclick = newFile;
$('#collapse-header').onclick = () => setCollapsed('header', true);
$('#expand-header').onclick = () => setCollapsed('header', false);
$('#collapse-sidebar').onclick = () => setCollapsed('sidebar', true);
$('#expand-sidebar').onclick = () => setCollapsed('sidebar', false);
$('#help').onclick = showHelp;
$('#open-export').onclick = showExportDialog;
$('#add-frame').onclick = beginPlacement;
$('#cancel-placement').onclick = cancelPlacement;
$('#deck-settings').onclick = () => showDeckDialog(false);
$('#new-deck').onclick = () => showDeckDialog(true);
$('#deck-select').onchange = () => { state.deckId = $('#deck-select').value; state.selectedId = null; state.sidebarSignature = ''; renderSidebar(); const frame = getFrames()[0]; if (frame) bridge.focusFrame(frame.id); };
$('#register-frame').onclick = () => {
  try { const result = bridge.registerSelection(getDeck().id); state.selectedId = result?.id || result?.[0]?.id; state.sidebarSignature = ''; onDiagramChange();  }
  catch (error) { notify(errorMessage(error), true); }
};
$('#file-input').onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try { await loadDocument(await file.text(), file.name); } catch (error) { notify(errorMessage(error), true); }
  event.target.value = '';
};

$('#slide-list').addEventListener('click', event => {
  const card = event.target.closest('[data-frame]'); if (!card) return;
  const id = card.dataset.frame;
  const frame = getFrames().find(f => f.id === id); if (!frame) return;
  const action = event.target.closest('[data-action]')?.dataset.action;
  try {
    if (action === 'focus' || !action) { state.selectedId = id; bridge.focusFrame(id); state.sidebarSignature = ''; renderSidebar(); }
    else if (action === 'lock') { bridge.updateFrame(id, { locked: !frame.locked }); onDiagramChange(); }
    else if (action === 'delete') { bridge.deleteFrame(id); state.thumbnails.delete(id); onDiagramChange();  }
    else if (action === 'up' || action === 'down') {
      const frames = getFrames(); const index = frames.findIndex(f => f.id === id); const target = index + (action === 'up' ? -1 : 1);
      if (target >= 0 && target < frames.length) { [frames[index], frames[target]] = [frames[target], frames[index]]; bridge.reorderFrames(getDeck().id, frames.map(f => f.id)); onDiagramChange(); }
    }
  } catch (error) { notify(errorMessage(error), true); }
});
$('#slide-list').addEventListener('change', event => {
  const card = event.target.closest('[data-frame]'); if (!card) return;
  const action = event.target.dataset.action;
  try {
    if (action === 'include') bridge.updateFrame(card.dataset.frame, { enabled: event.target.checked });
    if (action === 'title') bridge.updateFrame(card.dataset.frame, { title: event.target.value.trim() || 'スライド' });
    onDiagramChange();
  } catch (error) { notify(errorMessage(error), true); }
});
$('#slide-list').addEventListener('keydown', event => {
  if (event.target.matches('input')) { if (event.key === 'Enter') event.target.blur(); return; }
  if (event.key === 'Enter' && event.target.matches('[data-frame]')) event.target.querySelector('[data-action="focus"]').click();
});
let draggingId;
$('#slide-list').addEventListener('dragstart', event => {
  if (event.target.closest('input')) { event.preventDefault(); return; }
  const card = event.target.closest('[data-frame]'); if (!card) return;
  draggingId = card.dataset.frame; event.dataTransfer.setData('text/plain', draggingId); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging');
});
$('#slide-list').addEventListener('dragover', event => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
$('#slide-list').addEventListener('drop', event => {
  if (!draggingId) return; event.preventDefault();
  const card = event.target.closest('[data-frame]'); if (!card || card.dataset.frame === draggingId) return;
  const ids = getFrames().map(f => f.id); const from = ids.indexOf(draggingId); const to = ids.indexOf(card.dataset.frame); ids.splice(from, 1); ids.splice(to, 0, draggingId);
  bridge.reorderFrames(getDeck().id, ids); draggingId = null; onDiagramChange();
});
$('#slide-list').addEventListener('dragend', () => { draggingId = null; document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')); });
$('#slide-list').addEventListener('scroll', scheduleThumbnails, { passive: true });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveFile(); }
  if (event.key === 'Escape') cancelPlacement();
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('error', event => { if (state.ready) console.error(event.error); });

async function initialize() {
  updateFileStatus();
  try {
    recoveryDraft = await readDraft().catch(() => null);
    bridge = new EditorBridge($('#drawio-editor'), { onChange: onDiagramChange, onError: error => notify(errorMessage(error), true), onSave: saveFile, onPlacementCancel: cancelPlacement });
    // Public integration surface also used for automated round-trip / export checks.
    window.slideWorkspace = { bridge, state, exportPresentation, loadDocument, loadDemo: createDemo, blankXML };
    await bridge.ready();
    state.loading = true;
    await bridge.loadXML(blankXML, state.name);
    state.loading = false; state.ready = true; state.dirty = false;
    $('#editor-loading').hidden = true; updateFileStatus(); renderSidebar(); showWelcome();
  } catch (error) {
    $('#editor-loading').innerHTML = `<strong>draw.ioを読み込めませんでした</strong><p>${escape(errorMessage(error))}</p><button class="button button-primary" onclick="location.reload()">再読み込み</button>`;
  }
}
applyLayout();
initialize();
