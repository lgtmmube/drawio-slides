/** Same-origin adapter for the bundled, unmodified draw.io graph renderer. */
const DECKS_ATTR = 'slidesDecks';
const FRAME_ATTR = 'slideFrame';
const DEFAULT_DECK = { id: 'default', name: '発表1', ratio: '16:9', background: '#ffffff' };
const FRAME_STYLE = 'rounded=0;whiteSpace=wrap;html=0;fillColor=none;strokeColor=#6557df;strokeWidth=2;dashed=1;dashPattern=6 4;fontColor=#6557df;fontSize=16;fontStyle=1;align=left;verticalAlign=bottom;verticalLabelPosition=top;labelPosition=center;spacing=8;container=0;dropTarget=0;collapsible=0;connectable=0;editable=0;rotatable=0;aspect=fixed;pointerEvents=0;';
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const attr = (cell, key, fallback = null) => cell?.value?.getAttribute?.(key) ?? fallback;
const isFrame = cell => attr(cell, FRAME_ATTR) === '1';
const ratioValue = ratio => ratio === '4:3' ? 4 / 3 : 16 / 9;
const intersects = (a, b) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const union = (a, b) => !a ? { ...b } : ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) });

export class EditorBridge {
  constructor(iframe, callbacks = {}) {
    this.iframe = iframe;
    this.callbacks = callbacks;
    this.ui = null;
    this.graph = null;
    this._disposed = false;
    this._loading = false;
    this._loadRequest = null;
    this._message = event => this._onMessage(event);
    window.addEventListener('message', this._message);
    this._ready = new Promise((resolve, reject) => {
      let tries = 0;
      const poll = () => {
        if (this._disposed) return reject(new Error('エディターは終了しました。'));
        try {
          const ui = iframe.contentWindow?.__drawioUi;
          if (ui?.editor?.graph && iframe.contentWindow?.mxEvent) {
            this.ui = ui;
            this.graph = ui.editor.graph;
            this.win = iframe.contentWindow;
            this._install();
            resolve(this);
            callbacks.onReady?.();
            return;
          }
        } catch { /* Same-origin iframe has not finished navigating. */ }
        if (++tries > 1800) {
          const error = new Error('draw.ioの起動に時間がかかっています。ページを再読み込みしてください。');
          callbacks.onError?.(error);
          reject(error);
        } else this._pollTimer = setTimeout(poll, 100);
      };
      poll();
    });
  }

  ready() { return this._ready; }

  _install() {
    const { graph, win, ui } = this;
    this._modelListener = () => this._notify();
    graph.model.addListener(win.mxEvent.CHANGE, this._modelListener);
    this._pageListener = () => this._notify(true);
    ui.editor.addListener('pageSelected', this._pageListener);
    this._keyListener = event => {
      if (event.key === 'Escape' && this._placement) { this.cancelPlacement(); this.callbacks.onPlacementCancel?.(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.callbacks.onSave?.();
      }
    };
    win.document.addEventListener('keydown', this._keyListener, true);
    // A slide guide must never accept dropped cells or acquire children.
    const originalDrop = graph.isValidDropTarget;
    graph.isValidDropTarget = function (cell, ...args) {
      return !isFrame(cell) && originalDrop.call(this, cell, ...args);
    };
    this._originalDrop = originalDrop;
  }

  _onMessage(event) {
    if (event.source !== this.iframe.contentWindow || event.origin !== window.location.origin) return;
    let message = event.data;
    try { if (typeof message === 'string') message = JSON.parse(message); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.event === 'load' && this._loadRequest) {
      const request = this._loadRequest;
      this._loadRequest = null;
      clearTimeout(request.timer);
      this._loading = false;
      if (message.error) request.reject(new Error(String(message.error)));
      else {
        this._notify(true);
        request.resolve();
      }
    } else if (message.event === 'save') this.callbacks.onSave?.();
  }

  _notify(pageChanged = false) {
    if (this._loading || this._disposed) return;
    clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => {
      this.callbacks.onChange?.({ ...this.getPageInfo(), pageChanged, frames: this.getFrames(), decks: this.getDecks() });
    }, 140);
  }

  async loadXML(xml, title = '無題.drawio') {
    await this.ready();
    if (this._loadRequest) throw new Error('別のファイルを読み込み中です。');
    this.cancelPlacement();
    clearTimeout(this._changeTimer);
    this._loading = true;
    const parsed = new DOMParser().parseFromString(xml, 'text/xml');
    if (parsed.querySelector('parsererror') || !['mxfile', 'mxGraphModel'].includes(parsed.documentElement?.nodeName)) {
      this._loading = false;
      throw new Error('有効な.drawioファイルではありません。');
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._loadRequest = null;
        this._loading = false;
        reject(new Error('ファイルの読み込みが完了しませんでした。'));
      }, 60000);
      this._loadRequest = { resolve, reject, timer };
      this.iframe.contentWindow.postMessage(JSON.stringify({ action: 'load', xml, title, autosave: 0, noSaveBtn: 1, saveAndExit: 0 }), window.location.origin);
    });
    await this.win.document.fonts?.ready;
    this.graph.view.validate();
    // The caller establishes its clean baseline after this Promise resolves.
    clearTimeout(this._changeTimer);
  }

  getXML() {
    this._assertReady();
    this.graph.stopEditing(false);
    return this.ui.getFileData(true, null, null, null, true, false, null, null, null, true);
  }

  getPageInfo() {
    const page = this.ui?.currentPage;
    return { pageId: String(page?.getId?.() ?? '0'), pageName: page?.getName?.() || 'ページ1', pageCount: this.ui?.pages?.length || 1 };
  }

  _assertReady() { if (!this.graph) throw new Error('エディターを準備中です。'); }
  _cell(id) { return this.graph.model.getCell(id); }
  _frameCell(id) {
    const cell = this._cell(id);
    if (!isFrame(cell)) throw new Error('スライド枠が見つかりません。');
    return cell;
  }

  _transaction(fn) {
    this._assertReady();
    this.graph.stopEditing(false);
    this.graph.model.beginUpdate();
    try { return fn(); } finally { this.graph.model.endUpdate(); }
  }

  _setAttributes(cell, attributes) {
    const value = cell.value?.cloneNode ? cell.value.cloneNode(true) : this.win.mxUtils.createXmlDocument().createElement('object');
    if (!cell.value?.cloneNode) value.setAttribute('label', typeof cell.value === 'string' ? cell.value : '');
    for (const [key, val] of Object.entries(attributes)) {
      if (val == null) value.removeAttribute(key);
      else value.setAttribute(key, String(val));
    }
    this.graph.model.setValue(cell, value);
  }

  getDecks() {
    this._assertReady();
    let decks;
    try { decks = JSON.parse(attr(this.graph.model.root, DECKS_ATTR, 'null')); } catch { /* Foreign document metadata is not trusted. */ }
    if (!Array.isArray(decks) || !decks.length) decks = [DEFAULT_DECK];
    return decks.filter(d => d && typeof d.id === 'string').map(d => ({
      id: d.id, name: String(d.name || '発表'), ratio: d.ratio === '4:3' ? '4:3' : '16:9',
      background: /^#[0-9a-f]{6}$/i.test(d.background) ? d.background : '#ffffff',
    }));
  }

  _setDecks(decks) { this._setAttributes(this.graph.model.root, { [DECKS_ATTR]: JSON.stringify(decks) }); }

  addDeck({ name = '新しい発表', ratio = '16:9', background = '#ffffff' } = {}) {
    const deck = { id: uid('deck'), name, ratio: ratio === '4:3' ? '4:3' : '16:9', background };
    this._transaction(() => this._setDecks([...this.getDecks(), deck]));
    return deck;
  }

  updateDeck(id, patch) {
    this._transaction(() => {
      const decks = this.getDecks();
      const index = decks.findIndex(deck => deck.id === id);
      if (index < 0) throw new Error('発表セットが見つかりません。');
      const old = decks[index];
      decks[index] = { ...old, ...patch, id, ratio: (patch.ratio ?? old.ratio) === '4:3' ? '4:3' : '16:9' };
      this._setDecks(decks);
      if (decks[index].ratio !== old.ratio) {
        for (const frame of this.getFrames().filter(f => f.deckId === id)) this.updateFrame(frame.id, { height: frame.width / ratioValue(decks[index].ratio) });
      }
    });
    return this.getDecks().find(deck => deck.id === id);
  }

  _toFrame(cell) {
    const geo = cell.geometry;
    const state = this.graph.view.getState(cell);
    const position = state ? this._modelRect(state) : geo;
    return {
      id: String(cell.id), title: attr(cell, 'slideTitle', attr(cell, 'label', 'スライド')),
      deckId: attr(cell, 'slideDeck', 'default'), order: number(attr(cell, 'slideOrder')),
      enabled: attr(cell, 'slideEnabled', '1') !== '0', locked: attr(cell, 'slideLocked', '0') === '1',
      x: position?.x || 0, y: position?.y || 0, width: geo?.width || 960, height: geo?.height || 540,
    };
  }

  getFrames() {
    this._assertReady();
    return Object.values(this.graph.model.cells || {}).filter(isFrame).map(cell => this._toFrame(cell)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  createFrame({ deckId = 'default', x, y, width, height, title } = {}) {
    const deck = this.getDecks().find(d => d.id === deckId);
    if (!deck) throw new Error('発表セットが見つかりません。');
    const existing = this.getFrames().filter(f => f.deckId === deckId);
    width = Math.max(40, number(width, existing.at(-1)?.width || 960));
    height = width / ratioValue(deck.ratio);
    if (x == null || y == null) {
      const last = existing.at(-1);
      const graph = this.graph;
      x = x ?? (last ? last.x + last.width + 80 : (graph.container.scrollLeft + graph.container.clientWidth / 2) / graph.view.scale - graph.view.translate.x - width / 2);
      y = y ?? (last ? last.y : (graph.container.scrollTop + graph.container.clientHeight / 2) / graph.view.scale - graph.view.translate.y - height / 2);
    }
    let cell;
    this._transaction(() => {
      cell = this.graph.insertVertex(this.graph.getDefaultParent(), uid('slide'), '', number(x), number(y), width, height, FRAME_STYLE);
      this._setAttributes(cell, {
        [FRAME_ATTR]: '1', slideTitle: title || `スライド ${existing.length + 1}`, label: title || `スライド ${existing.length + 1}`,
        slideDeck: deckId, slideOrder: Math.max(-1, ...existing.map(f => f.order)) + 1, slideEnabled: '1', slideLocked: '0',
      });
      cell.setConnectable(false);
      this.graph.orderCells(true, [cell]);
    });
    return this._toFrame(cell);
  }

  startFramePlacement(options = {}, onPlaced) {
    this.cancelPlacement();
    this._assertReady();
    const container = this.graph.container;
    const cursor = container.style.cursor;
    container.style.cursor = 'crosshair';
    const pointer = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = this.graph.getPointForEvent(event);
      this.cancelPlacement();
      try {
        const frame = this.createFrame({ ...options, x: point.x, y: point.y });
        onPlaced?.(frame);
      } catch (error) { this.callbacks.onError?.(error); }
    };
    container.addEventListener('pointerdown', pointer, true);
    this._placement = { container, pointer, cursor };
  }

  cancelPlacement() {
    if (!this._placement) return;
    const { container, pointer, cursor } = this._placement;
    container.removeEventListener('pointerdown', pointer, true);
    container.style.cursor = cursor;
    this._placement = null;
  }

  registerSelection(deckId = 'default') {
    const cells = this.graph.getSelectionCells();
    if (cells.length !== 1 || !this.graph.model.isVertex(cells[0]) || !cells[0].geometry || isFrame(cells[0])) throw new Error('枠にする長方形を1つ選択してください。');
    const deck = this.getDecks().find(d => d.id === deckId);
    if (!deck) throw new Error('発表セットが見つかりません。');
    const cell = cells[0];
    const style = this.graph.getCellStyle(cell);
    if (style.shape && !['rectangle', 'rect', 'label'].includes(style.shape)) throw new Error('長方形を選択してください。');
    const existing = this.getFrames().filter(f => f.deckId === deckId);
    const title = this.graph.convertValueToString(cell) || `スライド ${existing.length + 1}`;
    this._transaction(() => {
      // Retain the cell ID and unrelated custom attributes from existing documents.
      this._detachChildren(cell);
      this._setAttributes(cell, { [FRAME_ATTR]: '1', slideTitle: title, label: title, slideDeck: deckId,
        slideOrder: Math.max(-1, ...existing.map(f => f.order)) + 1, slideEnabled: '1', slideLocked: '0' });
      const geo = cell.geometry.clone();
      geo.height = geo.width / ratioValue(deck.ratio);
      this.graph.model.setGeometry(cell, geo);
      this.graph.model.setStyle(cell, FRAME_STYLE);
      cell.setConnectable(false);
      this.graph.orderCells(true, [cell]);
    });
    return this._toFrame(cell);
  }

  updateFrame(id, patch) {
    const cell = this._frameCell(id);
    this._transaction(() => {
      const fields = { title: 'slideTitle', deckId: 'slideDeck', order: 'slideOrder', enabled: 'slideEnabled', locked: 'slideLocked' };
      const attrs = {};
      for (const [key, field] of Object.entries(fields)) if (patch[key] != null) attrs[field] = typeof patch[key] === 'boolean' ? (patch[key] ? '1' : '0') : patch[key];
      if (patch.title != null) attrs.label = patch.title;
      if (Object.keys(attrs).length) this._setAttributes(cell, attrs);
      if (['x', 'y', 'width', 'height'].some(key => patch[key] != null)) {
        const geo = cell.geometry.clone();
        for (const key of ['x', 'y', 'width', 'height']) if (patch[key] != null) geo[key] = number(patch[key], geo[key]);
        geo.width = Math.max(40, geo.width);
        geo.height = Math.max(20, geo.height);
        this.graph.model.setGeometry(cell, geo);
      }
      if (patch.locked != null) this.graph.model.setStyle(cell, FRAME_STYLE + (patch.locked ? 'movable=0;resizable=0;deletable=0;' : 'movable=1;resizable=1;deletable=1;'));
    });
    return this._toFrame(cell);
  }

  _detachChildren(cell) {
    const children = [...(cell.children || [])];
    for (const child of children) {
      const state = this.graph.view.getState(child);
      const bounds = state ? this._modelRect(state) : null;
      this.graph.model.add(this.graph.getDefaultParent(), child);
      if (bounds && child.geometry && !this.graph.model.isEdge(child)) {
        const geo = child.geometry.clone();
        geo.x = bounds.x; geo.y = bounds.y; geo.relative = false;
        this.graph.model.setGeometry(child, geo);
      }
    }
  }

  _removePreservingChildren(cell) {
    this._detachChildren(cell);
    this.graph.model.remove(cell);
  }

  deleteFrame(id) { this._transaction(() => this._removePreservingChildren(this._frameCell(id))); }
  reorderFrames(deckId, ids) {
    this._transaction(() => ids.forEach((id, index) => {
      if (attr(this._frameCell(id), 'slideDeck', 'default') === deckId) this.updateFrame(id, { order: index });
    }));
  }

  focusFrame(id) {
    const frame = this._toFrame(this._frameCell(id));
    this.graph.stopEditing(false);
    if (this.ui.applyViewBox) this.ui.applyViewBox({ x: frame.x, y: frame.y, width: frame.width, height: frame.height, border: 60 });
    else this.graph.scrollCellToVisible(this._cell(id), true);
  }
  fitAll() { this.graph.fit(40); this.graph.center(); }

  _modelRect(bounds) {
    const { scale, translate } = this.graph.view;
    return { x: bounds.x / scale - translate.x, y: bounds.y / scale - translate.y, width: bounds.width / scale, height: bounds.height / scale };
  }

  _stateBounds(state) {
    let bounds = null;
    for (const part of [state.shape, state.text]) if (part?.boundingBox) bounds = union(bounds, this._modelRect(part.boundingBox));
    return bounds || this._modelRect(state);
  }

  _states() {
    const states = [];
    const visit = cell => {
      if (!this.graph.isCellVisible(cell)) return;
      const state = this.graph.view.getState(cell);
      if (state && !isFrame(cell) && (this.graph.model.isVertex(cell) || this.graph.model.isEdge(cell))) states.push(state);
      if (cell.collapsed) return;
      for (const child of cell.children || []) visit(child);
    };
    visit(this.graph.model.root);
    return states;
  }

  commitEditing() { this._assertReady(); this.graph.stopEditing(false); }

  async _prepareRender() {
    this._assertReady();
    await this.win.document.fonts?.ready;
    if (this.graph.mathEnabled && this.win.Editor.loadMath) {
      if (!this._mathReadyPromise) this._mathReadyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('数式の描画機能を読み込めませんでした。ページを再読み込みしてください。')), 45000);
        this.win.Editor.loadMath(() => {
          clearTimeout(timer);
          if (this.win.DrawioMathJax?.typeset) resolve();
          else reject(new Error('数式の描画機能を読み込めませんでした。'));
        });
      });
      await this._mathReadyPromise;
    }
    this.graph.view.validate();
  }

  _svgForRect(rect, predicate, { backgroundImage = true } = {}) {
    const graph = this.graph;
    const view = graph.view;
    const exp = graph.createSvgImageExport(false, false);
    const fontLookup = Object.create(null);
    const originalBounds = view.getBackgroundPageBounds;
    const originalBackgroundImage = graph.backgroundImage;
    if (!backgroundImage) graph.backgroundImage = null;
    view.getBackgroundPageBounds = () => new this.win.mxRectangle((rect.x + view.translate.x) * view.scale, (rect.y + view.translate.y) * view.scale, rect.width * view.scale, rect.height * view.scale);
    try {
      const svg = this.ui.getSvgWithFontLookup(fontLookup, exp, () => {
        const drawWithFonts = exp.drawCellState;
        exp.drawCellState = (state, canvas) => {
          if (!isFrame(state.cell) && (!predicate || predicate(state)) && intersects(this._stateBounds(state), rect)) drawWithFonts.call(exp, state, canvas);
        };
        return graph.getSvg(null, 1, 0, false, false, true, true, exp, null, false, false, 'light', 'page', null, true, true, false);
      });
      this._svgFontLookups ||= new WeakMap();
      this._svgFontLookups.set(svg, fontLookup);
      return svg;
    } finally { view.getBackgroundPageBounds = originalBounds; graph.backgroundImage = originalBackgroundImage; }
  }

  async _rasterize(svg, width, background = null) {
    const editor = this.ui.editor;
    // Match draw.io's native PNG export: document web fonts are not inherited
    // by a standalone SVG image, so their binary data must be embedded first.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('カスタムフォントを読み込めませんでした。使用フォントを確認してください。')), 45000);
      try {
        this.ui.embedFonts(svg, () => { clearTimeout(timer); resolve(); }, true, this._svgFontLookups?.get(svg));
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    if (this.graph.mathEnabled) editor.addMathCss(svg);
    const fontChecks = [];
    this._fontChecks ||= new Map();
    for (const node of svg.querySelectorAll('style')) {
      const css = node.textContent || '';
      if (/@import\s/i.test(css)) throw new Error('カスタムフォントを画像に埋め込めませんでした。フォントを読み込んでから再出力してください。');
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\)\s]*))\s*\)/gi)) {
        const source = match[1] ?? match[2] ?? match[3];
        if (source && !source.startsWith('data:') && !source.startsWith('#')) throw new Error('カスタムフォントを画像に埋め込めませんでした。フォントを読み込んでから再出力してください。');
        if (source?.startsWith('data:') && /@font-face/i.test(css)) {
          if (!this._fontChecks.has(source)) this._fontChecks.set(source, new FontFace('SlidesExportValidation', `url("${source}")`).load().catch(() => { throw new Error('カスタムフォントのデータを読み込めませんでした。使用フォントを確認してください。'); }));
          fontChecks.push(this._fontChecks.get(source));
        }
      }
    }
    await Promise.all(fontChecks);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('画像素材の読み込みが完了しません。画像のリンクを確認してください。')), 45000);
      try { editor.convertImages(svg, () => { clearTimeout(timer); resolve(); }, {}); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
    // Unconverted remote images would silently disappear from a Canvas export.
    for (const node of svg.querySelectorAll('image, img')) {
      const src = node.getAttribute('href') || node.getAttribute('xlink:href') || node.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('#')) throw new Error('画像を読み込めませんでした。画像をdraw.ioへ埋め込んでから再出力してください。');
    }
    const naturalWidth = parseFloat(svg.getAttribute('width')) || 1;
    const naturalHeight = parseFloat(svg.getAttribute('height')) || 1;
    width = Math.min(8192, Math.max(1, Math.round(width)));
    const height = Math.max(1, Math.round(width * naturalHeight / naturalWidth));
    if (height > 16384) throw new Error('画像の高さが大きすぎます。出力サイズを小さくしてください。');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (background && background !== 'none') { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    const xml = new XMLSerializer().serializeToString(svg);
    const data = 'data:image/svg+xml;base64,' + this.win.Graph.base64EncodeUnicode(xml);
    const image = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('図の画像化に時間がかかっています。')), 45000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('図を画像として描画できませんでした。')); };
      image.src = data;
    });
    ctx.drawImage(image, 0, 0, width, height);
    try { return canvas.toDataURL('image/png'); }
    catch { throw new Error('外部画像を含むため出力できません。画像を埋め込んでから再出力してください。'); }
  }

  async renderFrame(id, { width = 1920, background } = {}) {
    await this._prepareRender();
    const frame = this._toFrame(this._frameCell(id));
    const deck = this.getDecks().find(d => d.id === frame.deckId) || DEFAULT_DECK;
    return this._rasterize(this._svgForRect(frame), width, background || deck.background);
  }

  async renderElement(elementId) {
    await this._prepareRender();
    const cell = this._cell(elementId);
    const state = cell && this.graph.view.getState(cell);
    if (!state || isFrame(cell)) throw new Error('出力する図形が見つかりません。');
    const bounds = this._stateBounds(state);
    const rect = { x: bounds.x - 2, y: bounds.y - 2, width: Math.max(1, bounds.width + 4), height: Math.max(1, bounds.height + 4) };
    const svg = this._svgForRect(rect, candidate => candidate.cell === cell, { backgroundImage: false });
    return { data: await this._rasterize(svg, Math.min(4096, Math.max(64, Math.ceil(rect.width * 2)))), ...rect };
  }

  _color(value) {
    if (typeof value !== 'string' || value === 'none' || value === 'transparent') return value;
    try { return this.win.mxUtils.getLightDarkColor(value).light || value; } catch { return value; }
  }

  _text(state) {
    if (!state.text) return null;
    const style = state.style;
    const raw = this.graph.getLabel(state.cell);
    if (raw == null || raw === '') return null;
    const html = typeof raw === 'string' ? raw : raw.outerHTML || raw.textContent || '';
    const div = this.win.document.createElement('div');
    div.innerHTML = this.graph.isHtmlLabel(state.cell) ? html : '';
    const plain = this.graph.isHtmlLabel(state.cell) ? this.win.mxUtils.extractTextWithWhitespace(div.childNodes) : String(raw);
    const rich = /<(?:sup|sub|img|table|ul|ol|li|svg|mjx-container)\b/i.test(html) || /(?:font-size|font-family|color|font-weight|font-style)\s*[:=]/i.test(html) || /<(?:b|strong|i|em|u|font)\b/i.test(html) || /(?:\\\(|\\\[|\$\$)/.test(html);
    const rotation = number(state.text.getTextRotation?.(), number(style.rotation));
    // mxText.bounds uses an alignment anchor; reverse its margin to obtain the label rectangle.
    const b = state.text.bounds || state.text.boundingBox || state;
    const margin = state.text.margin || { x: 0, y: 0 };
    let anchorX = b.x, anchorY = b.y;
    if (rotation && this.graph.model.isVertex(state.cell)) {
      const cx = state.x + state.width / 2, cy = state.y + state.height / 2;
      const radians = -rotation * Math.PI / 180;
      const dx = b.x - cx, dy = b.y - cy;
      anchorX = cx + dx * Math.cos(radians) - dy * Math.sin(radians);
      anchorY = cy + dx * Math.sin(radians) + dy * Math.cos(radians);
    }
    let rectangle = { x: anchorX + number(margin.x) * b.width, y: anchorY + number(margin.y) * b.height, width: b.width, height: b.height };
    if (rectangle.width <= 1 || rectangle.height <= 1) rectangle = state.text.unrotatedBoundingBox || state.text.boundingBox || rectangle;
    const bounds = this._modelRect(rectangle);
    const backgroundBounds = state.text.unrotatedBoundingBox || (!rotation ? state.text.boundingBox : null);
    return { plain, html, ...bounds, ...(backgroundBounds ? { backgroundBounds: this._modelRect(backgroundBounds) } : {}), fontFamily: style.fontFamily || 'Helvetica', fontSize: number(style.fontSize, 12), color: this._color(style.fontColor || '#000000'), bold: (number(style.fontStyle) & 1) !== 0, italic: (number(style.fontStyle) & 2) !== 0, underline: (number(style.fontStyle) & 4) !== 0, align: style.align || 'center', valign: style.verticalAlign || 'middle', rotation, isRich: rich, needsRaster: rich };
  }

  async getScene(id) {
    await this._prepareRender();
    const frame = this._toFrame(this._frameCell(id));
    const deck = this.getDecks().find(d => d.id === frame.deckId) || DEFAULT_DECK;
    const elements = [];
    const warnings = [];
    if (this.graph.backgroundImage) {
      const imageData = await this._rasterize(this._svgForRect(frame, () => false), 1920);
      elements.push({ id: '@slide-background-image', kind: 'image', x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: 0, style: {}, imageData });
    }
    for (const state of this._states()) {
      if (!intersects(this._stateBounds(state), frame)) continue;
      const cell = state.cell;
      const style = { ...state.style };
      for (const key of Object.keys(style)) if (/color$/i.test(key)) style[key] = this._color(style[key]);
      const bounds = this._modelRect(state);
      const text = this._text(state);
      const element = { id: String(cell.id), ...bounds, rotation: number(style.rotation), style, ...(text ? { text } : {}) };
      if (this.graph.model.isEdge(cell)) {
        element.kind = 'edge';
        element.points = (state.absolutePoints || []).filter(Boolean).map(p => ({ x: p.x / this.graph.view.scale - this.graph.view.translate.x, y: p.y / this.graph.view.scale - this.graph.view.translate.y }));
      } else {
        const shape = style.shape || 'rectangle';
        const shapes = { label: number(style.rounded) ? 'roundRect' : 'rect', rectangle: number(style.rounded) ? 'roundRect' : 'rect', rect: 'rect', ellipse: 'ellipse', rhombus: 'diamond', diamond: 'diamond', triangle: 'triangle', hexagon: 'hexagon', parallelogram: 'parallelogram', trapezoid: 'trapezoid', cylinder: 'cylinder', cylinder3: 'cylinder', cloud: 'cloud', line: 'line' };
        if (shape === 'text' || (['none', 'transparent'].includes(style.fillColor) && ['none', 'transparent'].includes(style.strokeColor) && !style.image && !cell.children?.length)) {
          element.kind = 'text';
          if (!text) continue;
        } else if (shape === 'image' || style.image) {
          element.kind = 'image';
          // Rendering the complete image cell preserves draw.io crop/aspect and its label.
          const rendered = await this.renderElement(element.id);
          Object.assign(element, { imageData: rendered.data, x: rendered.x, y: rendered.y, width: rendered.width, height: rendered.height, rotation: 0 });
          delete element.text;
        } else if (shape === 'group' || (cell.style === 'group' && !text)) continue;
        else if (shapes[shape]) { element.kind = 'shape'; element.shape = shapes[shape]; }
        else element.kind = 'unsupported';
      }
      if (text?.needsRaster || number(style.sketch) || number(style.handDrawn) || style.stencil || (element.kind === 'edge' && number(style.curved))) {
        element.kind = 'unsupported';
        warnings.push({ elementId: element.id, message: '数式・書式付き文字・複雑な図形は画像で保持します。' });
      }
      if (element.kind === 'unsupported' && !warnings.some(w => w.elementId === element.id)) warnings.push({ elementId: element.id, message: 'この特殊図形は画像で保持します。' });
      elements.push(element);
    }
    return { frame, background: deck.background, elements, warnings };
  }

  destroy() {
    this._disposed = true;
    this.cancelPlacement();
    clearTimeout(this._pollTimer);
    clearTimeout(this._changeTimer);
    window.removeEventListener('message', this._message);
    this.win?.document.removeEventListener('keydown', this._keyListener, true);
    if (this.graph) {
      this.graph.model.removeListener(this._modelListener);
      this.ui.editor.removeListener(this._pageListener);
      this.graph.isValidDropTarget = this._originalDrop;
    }
  }
}
