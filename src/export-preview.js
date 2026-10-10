import { icon } from './icons.js';

/** Previews use draw.io's renderer; editable PowerPoint output may differ. */
export function mountExportPreview({ container, bridge, frames, deck }) {
  const records = frames.map((frame, index) => ({
    frame, index, thumbnailStatus: 'queued', detailStatus: 'idle',
    thumbnailData: null, detailData: null,
  }));
  const listeners = new AbortController();
  let disposed = false;
  let running = false;
  let selected = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const titleOf = record => record.frame.title || `スライド ${record.index + 1}`;
  const ratioOf = frame => frame.width > 0 && frame.height > 0
    ? `${frame.width} / ${frame.height}` : (deck.ratio || '16:9').replace(':', '/');
  const control = (id, label, glyph) => {
    const button = element('button', 'icon-button');
    button.type = 'button';
    button.id = id;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(glyph);
    return button;
  };
  const image = (data, record) => {
    const img = element('img');
    img.src = data;
    img.alt = `${record.index + 1}. ${titleOf(record)}の作図プレビュー`;
    img.decoding = 'async';
    img.draggable = false;
    return img;
  };
  const retryButton = record => {
    const button = element('button', 'text-button', '再試行');
    button.type = 'button';
    button.dataset.previewRetry = record.frame.id;
    button.setAttribute('aria-label', `${record.index + 1}枚目のプレビューを再試行`);
    return button;
  };

  const heading = element('div', 'export-preview-heading');
  heading.append(element('span', '', '作図プレビュー'), element('span', 'export-preview-total', `${records.length}枚`));
  const grid = element('div', 'export-preview-grid');
  grid.id = 'export-preview-grid';
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', '出力するスライド');
  for (const record of records) {
    const card = element('div', 'export-preview-card');
    card.setAttribute('role', 'listitem');
    const button = element('button', 'export-preview-open');
    button.type = 'button';
    button.dataset.previewFrame = record.frame.id;
    button.setAttribute('aria-label', `${record.index + 1}. ${titleOf(record)}を拡大`);
    const thumbnail = element('span', 'export-preview-thumbnail');
    thumbnail.style.aspectRatio = ratioOf(record.frame);
    thumbnail.append(element('span', 'spinner'));
    thumbnail.setAttribute('aria-busy', 'true');
    const caption = element('span', 'export-preview-caption');
    caption.append(element('span', 'export-preview-number', String(record.index + 1)), element('span', 'export-preview-title', titleOf(record)));
    caption.title = titleOf(record);
    button.append(thumbnail, caption);
    const failure = element('div', 'export-preview-error');
    failure.hidden = true;
    failure.append(element('span', '', 'プレビューを表示できません'), retryButton(record));
    card.append(button, failure);
    grid.append(card);
    Object.assign(record, { card, button, thumbnail, failure });
  }

  const detail = element('div', 'export-preview-detail');
  detail.hidden = true;
  const toolbar = element('div', 'export-preview-toolbar');
  const back = element('button', 'text-button');
  back.type = 'button';
  back.id = 'export-preview-back';
  back.innerHTML = `${icon('left', 15)}<span>一覧</span>`;
  back.setAttribute('aria-label', 'スライド一覧へ戻る');
  const position = element('span', 'export-preview-position');
  position.id = 'export-preview-position';
  position.setAttribute('aria-live', 'polite');
  const previous = control('export-preview-prev', '前のスライド', 'left');
  const next = control('export-preview-next', '次のスライド', 'right');
  toolbar.append(back, position, previous, next);
  const detailTitle = element('div', 'export-preview-detail-title');
  const detailImage = element('div', 'export-preview-large');
  const detailStatus = element('div', 'export-preview-detail-status');
  detail.append(toolbar, detailTitle, detailImage, detailStatus);
  container.replaceChildren(heading, grid, detail);

  function alive() {
    if (!disposed && !container.isConnected) dispose();
    return !disposed;
  }

  function updateThumbnail(record) {
    record.thumbnail.setAttribute('aria-busy', String(record.thumbnailStatus === 'loading' || record.thumbnailStatus === 'queued'));
    if (record.thumbnailData) record.thumbnail.replaceChildren(image(record.thumbnailData, record));
    else if (record.thumbnailStatus === 'error') record.thumbnail.replaceChildren(element('span', 'export-preview-unavailable', '—'));
    else record.thumbnail.replaceChildren(element('span', 'spinner'));
    record.failure.hidden = record.thumbnailStatus !== 'error';
  }

  function updateDetail() {
    if (selected === null) return;
    const record = records[selected];
    position.textContent = `${selected + 1} / ${records.length}`;
    detailTitle.textContent = titleOf(record);
    detailTitle.title = titleOf(record);
    previous.disabled = selected === 0;
    next.disabled = selected === records.length - 1;
    detailImage.style.aspectRatio = ratioOf(record.frame);
    detailImage.setAttribute('aria-busy', String(record.detailStatus === 'queued' || record.detailStatus === 'loading'));
    const data = record.detailData || record.thumbnailData;
    detailImage.replaceChildren(...(data ? [image(data, record)] : record.detailStatus === 'error' ? [element('span', 'export-preview-unavailable', '—')] : [element('span', 'spinner')]));
    detailStatus.replaceChildren();
    if (record.detailStatus === 'error') {
      detailStatus.append(element('span', '', 'プレビューを表示できません'), retryButton(record));
    } else if (data && record.detailStatus !== 'ready') {
      detailStatus.append(element('span', '', '読み込み中…'));
    }
  }

  function showDetail(index) {
    if (!alive() || index < 0 || index >= records.length) return;
    selected = index;
    const record = records[index];
    if (record.detailStatus === 'idle') record.detailStatus = 'queued';
    grid.hidden = true;
    detail.hidden = false;
    detailImage.id = 'export-preview-image';
    updateDetail();
    back.focus({ preventScroll: true });
    void pump();
  }

  function showGrid() {
    if (!alive()) return;
    const record = records[selected];
    selected = null;
    detail.hidden = true;
    detailImage.removeAttribute('id');
    grid.hidden = false;
    record?.button.focus({ preventScroll: true });
  }

  async function pump() {
    if (running || !alive()) return;
    running = true;
    try {
      while (alive()) {
        const current = selected === null ? null : records[selected];
        const large = current?.detailStatus === 'queued';
        const record = large ? current : records.find(item => item.thumbnailStatus === 'queued');
        if (!record) break;
        const status = large ? 'detailStatus' : 'thumbnailStatus';
        record[status] = 'loading';
        if (!large) updateThumbnail(record);
        if (selected === record.index) updateDetail();
        try {
          const data = await bridge.renderFrame(record.frame.id, { width: large ? 1100 : 480, background: deck.background });
          if (!alive()) return;
          record[status] = 'ready';
          if (large) record.detailData = data;
          if (!record.thumbnailData || !large) record.thumbnailData = data;
          record.thumbnailStatus = 'ready';
        } catch {
          if (!alive()) return;
          record[status] = 'error';
        }
        updateThumbnail(record);
        if (selected === record.index) updateDetail();
      }
    } finally {
      running = false;
    }
  }

  function onClick(event) {
    const target = event.target.closest('button');
    if (!target || !container.contains(target) || !alive()) return;
    if (target.dataset.previewFrame !== undefined) {
      showDetail(records.findIndex(record => String(record.frame.id) === target.dataset.previewFrame));
    } else if (target.dataset.previewRetry !== undefined) {
      const record = records.find(item => String(item.frame.id) === target.dataset.previewRetry);
      if (!record) return;
      if (detail.contains(target)) {
        record.detailStatus = 'queued';
        updateDetail();
      } else {
        record.thumbnailStatus = 'queued';
        updateThumbnail(record);
      }
      void pump();
    } else if (target === back) showGrid();
    else if (target === previous) showDetail(selected - 1);
    else if (target === next) showDetail(selected + 1);
  }

  function onKeyDown(event) {
    if (selected === null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' && selected > 0) {
      event.preventDefault();
      showDetail(selected - 1);
    } else if (event.key === 'ArrowRight' && selected < records.length - 1) {
      event.preventDefault();
      showDetail(selected + 1);
    }
  }

  const observer = new MutationObserver(() => { if (!container.isConnected) dispose(); });
  observer.observe(document.body, { childList: true, subtree: true });
  container.addEventListener('click', onClick, { signal: listeners.signal });
  container.addEventListener('keydown', onKeyDown, { signal: listeners.signal });

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    observer.disconnect();
    for (const button of container.querySelectorAll('button')) button.disabled = true;
    for (const spinner of container.querySelectorAll('.spinner')) spinner.remove();
    for (const busy of container.querySelectorAll('[aria-busy]')) busy.setAttribute('aria-busy', 'false');
  }

  void pump();
  return { dispose };
}
