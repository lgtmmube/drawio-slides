import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const artifactDir = path.join(os.tmpdir(), 'drawio-slides-ui-check');
async function startSample(page) {
  await page.goto('/');
  await page.locator('#welcome-demo').click();
  await expect(page.locator('.slide-card')).toHaveCount(2);
  await expect(page.locator('.slide-thumbnail img').first()).toBeVisible();
}
async function downloadDeck(page, filename) {
  const waiting = page.waitForEvent('download');
  await page.locator('#export-confirm').click();
  const download = await waiting;
  await fs.mkdir(artifactDir, { recursive: true });
  const destination = path.join(artifactDir, filename);
  await download.saveAs(destination);
  await expect(page.locator('#export-done')).toBeVisible();
  return { zip: await JSZip.loadAsync(await fs.readFile(destination)), destination };
}

test('complete image and editable export paths produce valid, distinct PowerPoint decks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await startSample(page);
  await page.locator('#open-export').click();
  await expect(page.locator('input[value="image"]')).toBeChecked();
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img')).toHaveCount(2);
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img').first()).toBeVisible();
  await page.locator('#image-resolution').selectOption('1920');
  const { zip: imageZip } = await downloadDeck(page, 'sample-image.pptx');
  expect(Object.keys(imageZip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2);
  const imageSlide = await imageZip.file('ppt/slides/slide1.xml').async('string');
  expect((imageSlide.match(/<p:pic>/g) || [])).toHaveLength(1);
  expect(imageSlide).not.toContain('<p:sp>');
  const media = Object.keys(imageZip.files).find(name => name.startsWith('ppt/media/') && name.endsWith('.png'));
  const bytes = await imageZip.file(media).async('nodebuffer');
  expect(bytes.readUInt32BE(16)).toBe(1920);
  expect(bytes.readUInt32BE(20)).toBe(1080);
  await fs.writeFile(path.join(artifactDir, 'sample-image-slide1.png'), bytes);
  await page.locator('#export-again').click();
  await expect(page.locator('input[value="editable"]')).toBeChecked();
  await expect(page.locator('#mode-note')).toContainText('完全一致を保証しません');
  const { zip: editableZip } = await downloadDeck(page, 'sample-editable.pptx');
  const editableSlide = await editableZip.file('ppt/slides/slide1.xml').async('string');
  expect(editableSlide).toContain('問いを立てる');
  expect(editableSlide).toContain('実験・検証');
  expect(editableSlide).toContain('結果をまとめる');
  expect(editableSlide).toContain('研究の全体像');
  expect(editableSlide).toContain('キャンバス上の図から');
  expect((editableSlide.match(/<p:sp>/g) || []).length).toBeGreaterThan(8);
  expect(editableSlide).not.toContain('<p:pic>');
  expect(await editableZip.file('ppt/slides/slide2.xml').async('string')).not.toContain('<p:pic>');
  expect(editableSlide).not.toContain('素材パレット');
  expect(editableSlide).not.toContain('研究メモ');
  expect(editableSlide).not.toContain('slideFrame');
  await page.locator('#export-done').click();
  await page.screenshot({ path: path.join(artifactDir, 'workspace.png') });
  expect(errors).toEqual([]);
});

test('export preview shows every included slide in output order, with detail navigation in either export mode', async ({ page }) => {
  await startSample(page);
  const expected = await page.evaluate(() => {
    const bridge = window.slideWorkspace.bridge;
    const frames = bridge.getFrames();
    const deckId = frames[0].deckId;
    const excluded = bridge.createFrame({ deckId, title: '出力しないスライド' });
    bridge.updateFrame(excluded.id, { enabled: false });
    const otherDeck = bridge.addDeck({ name: '別の発表セット' });
    bridge.createFrame({ deckId: otherDeck.id, title: '別セットのスライド' });
    bridge.reorderFrames(deckId, [frames[1].id, frames[0].id, excluded.id]);
    return [frames[1], frames[0]].map(({ id, title }) => ({ id, title }));
  });
  await page.locator('#open-export').click();
  const cards = page.locator('#export-preview-grid button[data-preview-frame]');
  await expect(cards).toHaveCount(2);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.previewFrame))).toEqual(expected.map(frame => frame.id));
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img')).toHaveCount(2);
  const images = await page.locator('#export-preview-grid .export-preview-thumbnail img').evaluateAll(nodes => nodes.map(node => node.src));
  expect(images[0]).not.toBe(images[1]);
  await expect(page.locator('#export-preview')).not.toContainText('出力しないスライド');
  await expect(page.locator('#export-preview')).not.toContainText('別セットのスライド');
  await expect(page.locator('#export-confirm')).toContainText('2枚');

  await page.locator('input[value="editable"]').check();
  await expect(page.locator('#export-preview-grid')).toBeVisible();
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img')).toHaveCount(2);
  await cards.first().click();
  await expect(page.locator('#export-preview-grid')).toBeHidden();
  await expect(page.locator('#export-preview-image img')).toBeVisible();
  await expect(page.locator('.export-preview-detail-title')).toContainText(expected[0].title);
  await expect(page.locator('#export-preview-position')).toContainText(/1\s*\/\s*2/);
  await expect(page.locator('#export-preview-prev')).toBeDisabled();
  await page.locator('#export-preview-next').click();
  await expect(page.locator('.export-preview-detail-title')).toContainText(expected[1].title);
  await expect(page.locator('#export-preview-position')).toContainText(/2\s*\/\s*2/);
  await expect(page.locator('#export-preview-next')).toBeDisabled();
  await page.locator('#export-preview-prev').click();
  await expect(page.locator('.export-preview-detail-title')).toContainText(expected[0].title);
  await page.locator('#export-preview-back').click();
  await expect(page.locator('#export-preview-grid')).toBeVisible();
  await page.locator('input[value="image"]').check();
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img')).toHaveCount(2);
  await cards.last().click();
  await expect(page.locator('.export-preview-detail-title')).toContainText(expected[1].title);
  await page.locator('#export-cancel').click();
});

test('closing a pending preview does not alter a reopened dialog, and a failed slide can be retried independently', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await startSample(page);
  const ids = await page.evaluate(() => {
    const bridge = window.slideWorkspace.bridge;
    const renderFrame = bridge.renderFrame.bind(bridge);
    window.previewRenderCalls = 0;
    bridge.renderFrame = (id, options) => {
      if (options?.width !== 480) return renderFrame(id, options);
      window.previewRenderCalls++;
      if (window.previewRenderCalls === 1) return new Promise(resolve => {
        window.releaseStalePreview = () => resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
      });
      if (window.previewRenderCalls === 2) return Promise.reject(new Error('Preview failure injected for retry test'));
      return renderFrame(id, options);
    };
    return bridge.getFrames().map(frame => frame.id);
  });
  await page.locator('#open-export').click();
  await expect.poll(() => page.evaluate(() => window.previewRenderCalls)).toBe(1);
  await page.locator('#export-cancel').click();
  await page.locator('#open-export').click();
  const retry = page.locator(`#export-preview-grid button[data-preview-retry="${ids[0]}"]`);
  await expect(retry).toBeVisible();
  await expect(page.locator(`#export-preview-grid button[data-preview-frame="${ids[1]}"] .export-preview-thumbnail img`)).toBeVisible();
  await page.evaluate(() => window.releaseStalePreview());
  // Allow the old completion handler to run; it must neither replace current content nor continue its queue.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => window.previewRenderCalls)).toBe(3);
  await retry.click();
  await expect(page.locator('#export-preview-grid .export-preview-thumbnail img')).toHaveCount(2);
  await expect(retry).toBeHidden();
  await expect(page.locator('#export-confirm')).toBeEnabled();
  expect(errors).toEqual([]);
  await page.locator('#export-cancel').click();
});

test('a long export preview scrolls to the last slide while export controls stay reachable on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startSample(page);
  const lastId = await page.evaluate(() => {
    const bridge = window.slideWorkspace.bridge;
    const deckId = bridge.getFrames()[0].deckId;
    let last;
    for (let index = 3; index <= 14; index++) last = bridge.createFrame({ deckId, title: `スライド ${index}` });
    return last.id;
  });
  await page.locator('#open-export').click();
  const cards = page.locator('#export-preview-grid button[data-preview-frame]');
  await expect(cards).toHaveCount(14);
  const last = page.locator(`#export-preview-grid button[data-preview-frame="${lastId}"]`);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(page.locator('#export-confirm')).toBeInViewport();
  await expect(page.locator('#export-cancel')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await last.click();
  await expect(page.locator('#export-preview-position')).toContainText(/14\s*\/\s*14/);
  await expect(page.locator('#export-preview-back')).toBeInViewport();
  await expect(page.locator('#export-confirm')).toBeInViewport();
  await page.locator('#export-cancel').click();
});

test('frame placement, order, include, title, lock and deletion leave drawing intact', async ({ page }) => {
  await startSample(page);
  const shapesBefore = await page.evaluate(() => Object.values(window.slideWorkspace.bridge.graph.model.cells).filter(c => c.vertex && c.value?.getAttribute?.('slideFrame') !== '1').length);
  const firstId = await page.locator('.slide-card').first().getAttribute('data-frame');
  await page.locator('.slide-card').first().locator('[data-action="down"]').click();
  await expect(page.locator('.slide-card').last()).toHaveAttribute('data-frame', firstId);
  await page.locator('.slide-card').last().locator('[data-action="title"]').fill('変更したタイトル');
  await page.locator('.slide-card').last().locator('[data-action="title"]').press('Enter');
  await expect.poll(() => page.evaluate(id => window.slideWorkspace.bridge.getFrames().find(f => f.id === id).title, firstId)).toBe('変更したタイトル');
  await page.locator('.slide-card').last().locator('[data-action="include"]').uncheck();
  await page.locator('#open-export').click();
  await expect(page.locator('#export-confirm')).toContainText('1枚');
  await page.locator('#export-cancel').click();
  await page.locator('.slide-card').last().locator('[data-action="lock"]').click();
  await expect.poll(() => page.evaluate(id => window.slideWorkspace.bridge.graph.isCellMovable(window.slideWorkspace.bridge.graph.model.getCell(id)), firstId)).toBe(false);
  await page.locator('.slide-card').last().locator('[data-action="delete"]').click();
  await expect(page.locator('.slide-card')).toHaveCount(1);
  expect(await page.evaluate(() => Object.values(window.slideWorkspace.bridge.graph.model.cells).filter(c => c.vertex && c.value?.getAttribute?.('slideFrame') !== '1').length)).toBe(shapesBefore);
  await page.locator('#add-frame').click();
  await expect(page.locator('#placement-banner')).toBeVisible();
  const editor = page.frameLocator('#drawio-editor');
  await editor.locator('.geDiagramContainer').click({ position: { x: 400, y: 160 } });
  await expect(page.locator('.slide-card')).toHaveCount(2);
  await expect(page.locator('#placement-banner')).toBeHidden();
  await page.locator('#add-frame').click();
  await editor.locator('body').press('Escape');
  await expect(page.locator('#placement-banner')).toBeHidden();
});

test('file save and reload round-trip preserves slides, decks and independent source content', async ({ page }) => {
  await startSample(page);
  await page.locator('#new-deck').click();
  await page.locator('#deck-name-input').fill('研究室報告');
  await page.locator('#deck-ratio-input').selectOption('4:3');
  await page.locator('#deck-form button[type="submit"]').click();
  await expect(page.locator('.slide-card')).toHaveCount(0);
  await page.locator('#add-frame').click();
  await page.frameLocator('#drawio-editor').locator('.geDiagramContainer').click({ position: { x: 350, y: 170 } });
  await expect(page.locator('.slide-card')).toHaveCount(1);
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const waiting = page.waitForEvent('download');
  await page.locator('#save-file').click();
  const download = await waiting;
  const destination = path.join(artifactDir, 'sample-roundtrip.drawio');
  await fs.mkdir(artifactDir, { recursive: true }); await download.saveAs(destination);
  const saved = await fs.readFile(destination, 'utf8');
  expect(saved).toContain('mxfile');
  await expect(page.locator('#file-status')).toHaveText('保存済み');
  await page.locator('#new-file').click();
  await page.locator('#cancel-placement').click();
  await page.locator('#file-input').setInputFiles(destination);
  await expect(page.locator('.slide-card')).toHaveCount(2);
  await expect(page.locator('#deck-select option')).toHaveCount(2);
  const decks = await page.evaluate(() => window.slideWorkspace.bridge.getDecks());
  await page.locator('#deck-select').selectOption(decks.find(d => d.name === '研究室報告').id);
  await expect(page.locator('.slide-card')).toHaveCount(1);
  await expect(page.locator('#ratio-badge')).toHaveText('4:3');
  expect(await page.evaluate(() => window.slideWorkspace.bridge.graph.model.getCell('palette-a')?.value)).toBe('入力');
});

async function drawingSnapshot(page) {
  return page.evaluate(() => {
    const bridge = window.slideWorkspace.bridge;
    const xml = new DOMParser().parseFromString(bridge.getXML(), 'application/xml');
    // Viewport dimensions legitimately change when the editor grows; diagram cells must not.
    return {
      content: [...xml.querySelectorAll('mxGraphModel > root')].map(root => new XMLSerializer().serializeToString(root)),
      frames: bridge.getFrames(),
    };
  });
}

test('header and slide sidebar collapse independently without reloading or changing the drawing, and persist across reload', async ({ page }) => {
  await startSample(page);
  const iframe = page.locator('#drawio-editor');
  const expanded = await iframe.boundingBox();
  const source = await drawingSnapshot(page);
  expect(source.content.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    const iframe = document.querySelector('#drawio-editor');
    window.chromeTest = { iframe, document: iframe.contentDocument, graph: window.slideWorkspace.bridge.graph, loads: 0 };
    iframe.addEventListener('load', () => window.chromeTest.loads++);
  });

  await expect(page.locator('#collapse-header')).toHaveAttribute('aria-controls', 'app-header');
  await expect(page.locator('#collapse-header')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#collapse-header').click();
  await expect(page.locator('#app-header')).toBeHidden();
  await expect(page.locator('#slide-sidebar')).toBeVisible();
  await expect(page.locator('#expand-header')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await iframe.boundingBox()).height).toBeGreaterThan(expanded.height);
  await expect.poll(async () => (await iframe.boundingBox()).width).toBe(expanded.width);
  expect(await drawingSnapshot(page)).toEqual(source);
  await page.locator('#expand-header').click();
  await expect(page.locator('#app-header')).toBeVisible();
  await expect(page.locator('#expand-header')).toBeHidden();

  await expect(page.locator('#collapse-sidebar')).toHaveAttribute('aria-controls', 'slide-sidebar');
  await expect(page.locator('#collapse-sidebar')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#collapse-sidebar').click();
  await expect(page.locator('#slide-sidebar')).toBeHidden();
  await expect(page.locator('#app-header')).toBeVisible();
  await expect(page.locator('#expand-sidebar')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await iframe.boundingBox()).width).toBeGreaterThan(expanded.width);
  await expect.poll(async () => (await iframe.boundingBox()).height).toBe(expanded.height);

  await page.locator('#collapse-header').click();
  await expect(page.locator('#expand-header')).toBeVisible();
  await expect(page.locator('#expand-sidebar')).toBeVisible();
  await expect.poll(async () => (await iframe.boundingBox()).height).toBeGreaterThan(expanded.height);
  expect(await drawingSnapshot(page)).toEqual(source);
  expect(await page.evaluate(() => ({
    sameIframe: window.chromeTest.iframe === document.querySelector('#drawio-editor'),
    sameDocument: window.chromeTest.document === document.querySelector('#drawio-editor').contentDocument,
    sameGraph: window.chromeTest.graph === window.slideWorkspace.bridge.graph,
    loads: window.chromeTest.loads,
  }))).toEqual({ sameIframe: true, sameDocument: true, sameGraph: true, loads: 0 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drawio-slides:layout')))).toEqual({ headerCollapsed: true, sidebarCollapsed: true });

  // The unsaved sample intentionally triggers the app's leave-page confirmation.
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.locator('#recover-draft').click();
  await expect.poll(() => page.evaluate(() => window.slideWorkspace?.bridge?.getFrames().length)).toBe(2);
  await expect(page.locator('#app-header')).toBeHidden();
  await expect(page.locator('#slide-sidebar')).toBeHidden();
  await expect(page.locator('#expand-header')).toBeVisible();
  await expect(page.locator('#expand-sidebar')).toBeVisible();
  expect(await drawingSnapshot(page)).toEqual(source);
  await page.locator('#expand-header').click();
  await expect(page.locator('#app-header')).toBeVisible();
  await expect(page.locator('#slide-sidebar')).toBeHidden();
  await page.locator('#expand-sidebar').click();
  await expect(page.locator('#slide-sidebar')).toBeVisible();
  await expect(page.locator('.slide-card')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drawio-slides:layout')))).toEqual({ headerCollapsed: false, sidebarCollapsed: false });
});

test('compact chrome keeps file, slide and restore controls reachable at a 900px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startSample(page);
  const withinViewport = async selector => {
    await expect(page.locator(selector)).toBeVisible();
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  };
  for (const selector of ['#open-file', '#save-file', '#open-export', '#collapse-header', '#collapse-sidebar', '#add-frame']) await withinViewport(selector);
  await expect(page.locator('#slide-sidebar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.locator('#collapse-header').click();
  await page.locator('#collapse-sidebar').click();
  await withinViewport('#expand-header');
  await withinViewport('#expand-sidebar');
  const enlarged = await page.locator('#drawio-editor').boundingBox();
  expect(enlarged.width).toBeGreaterThan(800);
  expect(enlarged.height).toBeGreaterThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.locator('#expand-sidebar').click();
  await page.locator('#expand-header').click();
  await withinViewport('#open-export');
  await withinViewport('#add-frame');
});
