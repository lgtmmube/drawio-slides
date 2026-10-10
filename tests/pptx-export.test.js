import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportPresentation } from '../src/pptx-export.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wZQAAAAASUVORK5CYII=';
const frame = { id: 'frame-a', x: 100, y: 200, width: 1600, height: 900, title: '研究の図' };
const deck = { id: 'talk', name: '研究発表', ratio: '16:9', background: '#ffffff' };
const rect = { id: 'rect-1', kind: 'shape', shape: 'rect', x: 220, y: 320, width: 240, height: 120, style: { fillColor: '#d9e8fb', strokeColor: '#123456', strokeWidth: 2 }, text: { plain: '日本語の研究図', x: 220, y: 320, width: 240, height: 120, fontSize: 24, fontFamily: 'Yu Gothic', color: '#112233', align: 'center', valign: 'middle' } };

function bridgeFor(elements = [], sourceFrame = frame) {
  return {
    async getScene() { return { frame: sourceFrame, elements, warnings: [] }; },
    async renderFrame() { return PNG; },
    async renderElement(id) {
      const element = elements.find((item) => item.id === id);
      return { data: PNG, x: element.x, y: element.y, width: element.width, height: element.height };
    },
  };
}

async function unzip(result) {
  return JSZip.loadAsync(await result.blob.arrayBuffer());
}

async function slideXml(zip, number = 1) {
  return zip.file(`ppt/slides/slide${number}.xml`).async('string');
}

test('image mode exports only selected frame rasters, in order and at exact slide size', async () => {
  const calls = [];
  const frames = [frame, { ...frame, id: 'frame-b', x: 3000 }];
  const bridge = bridgeFor([rect]);
  bridge.getScene = () => { throw new Error('Image mode must not export editable/source content'); };
  bridge.renderFrame = async (id, options) => { calls.push({ id, options }); return PNG; };
  const progress = [];
  const result = await exportPresentation({ bridge, frames, deck, mode: 'image', imageWidth: 3840, onProgress: (entry) => progress.push(entry) });
  const zip = await unzip(result);
  assert.deepEqual(calls.map((call) => call.id), ['frame-a', 'frame-b']);
  assert.deepEqual(calls[0].options, { width: 3840, background: '#ffffff' });
  assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, 2);
  for (const number of [1, 2]) {
    const xml = await slideXml(zip, number);
    assert.equal((xml.match(/<p:pic>/g) || []).length, 1);
    assert.doesNotMatch(xml, /<p:sp>/);
    assert.match(xml, /<a:off x="0" y="0"\/>\s*<a:ext cx="12192000" cy="6858000"\/>/);
    assert.doesNotMatch(xml, /日本語の研究図|mxGraphModel|frame-a|frame-b/);
  }
  assert.equal(zip.file(/\.drawio$|customXml\/|embeddings\//).length, 0);
  assert.equal(result.stats.images, 2);
  assert.equal(result.stats.texts, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(progress.at(-1).stage, 'packaging');
});

test('editable mode creates real text and shapes with frame-relative positions and scaled font sizes', async () => {
  const result = await exportPresentation({ bridge: bridgeFor([rect]), frames: [frame], deck, mode: 'editable' });
  const zip = await unzip(result);
  const xml = await slideXml(zip);
  assert.equal((xml.match(/<p:sp>/g) || []).length, 2);
  assert.match(xml, /<a:prstGeom prst="rect">/);
  assert.match(xml, /<a:t>日本語の研究図<\/a:t>/);
  assert.match(xml, /typeface="Yu Gothic"/);
  // 1600 model units span 13 1/3 inches: 120 units = 1 inch, 24 units = 14.4pt.
  assert.match(xml, /<a:off x="914400" y="914400"\/><a:ext cx="1828800" cy="914400"\/>/);
  assert.match(xml, /sz="1440"/);
  assert.match(xml, /<a:ln w="15240">/);
  assert.equal((xml.match(/<p:pic>/g) || []).length, 0);
  assert.equal(result.stats.shapes, 1);
  assert.equal(result.stats.texts, 1);
  assert.ok(result.warnings.some((item) => item.code === 'editable-fidelity'));
});

test('4:3 presentation has the requested page ratio and retains text size proportional to its frame', async () => {
  const standardFrame = { ...frame, width: 1200, height: 900 };
  const result = await exportPresentation({ bridge: bridgeFor([rect], standardFrame), frames: [standardFrame], deck: { ...deck, ratio: '4:3' }, mode: 'editable' });
  const zip = await unzip(result);
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  assert.match(presentation, /<p:sldSz cx="9144000" cy="6858000"/);
  assert.match(await slideXml(zip), /sz="1440"/);
});

test('up-left arrow geometry preserves directed endpoints; elbow heads appear on terminal segments only', async () => {
  const edge = {
    id: 'arrow', kind: 'edge', x: 220, y: 320, width: 240, height: 240,
    points: [{ x: 460, y: 560 }, { x: 340, y: 440 }, { x: 220, y: 440 }],
    style: { strokeColor: '#000000', strokeWidth: 2, startArrow: 'oval', endArrow: 'block' },
  };
  const result = await exportPresentation({ bridge: bridgeFor([edge]), frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  const shapes = xml.match(/<p:sp>.*?<\/p:sp>/g);
  assert.equal(shapes.length, 2);
  assert.match(shapes[0], /<a:xfrm flipH="1" flipV="1">/);
  assert.match(shapes[0], /<a:off x="1828800" y="1828800"\/><a:ext cx="914400" cy="914400"\/>/);
  assert.match(shapes[0], /<a:headEnd type="oval"/);
  assert.match(shapes[0], /<a:tailEnd type="none"/);
  assert.match(shapes[1], /<a:xfrm flipH="1">/);
  assert.match(shapes[1], /<a:off x="914400" y="1828800"\/><a:ext cx="914400" cy="0"\/>/);
  assert.match(shapes[1], /<a:headEnd type="none"/);
  assert.match(shapes[1], /<a:tailEnd type="triangle"/);
  assert.equal(result.stats.edges, 1);
  assert.equal(result.stats.fallbacks, 0);
});

test('unsupported and rich labels rasterize individual elements, retain order, and report each fallback', async () => {
  const formula = { id: 'math', kind: 'unsupported', x: 500, y: 300, width: 200, height: 100, reason: '数式は画像で表示します。' };
  const formatted = { ...rect, id: 'formatted', text: { ...rect.text, plain: '混在する文字', html: '<div><b>混在</b>する文字</div>' } };
  const calls = [];
  const bridge = bridgeFor([rect, formula, formatted]);
  const originalRender = bridge.renderElement;
  bridge.renderElement = async (id) => { calls.push(id); return originalRender(id); };
  const result = await exportPresentation({ bridge, frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  assert.deepEqual(calls, ['math', 'formatted']);
  assert.equal((xml.match(/<p:pic>/g) || []).length, 2);
  assert.doesNotMatch(xml, /<a:t>混在する文字<\/a:t>/);
  assert.ok(xml.indexOf('rect-1:shape') < xml.indexOf('math:fallback'));
  assert.ok(xml.indexOf('math:fallback') < xml.indexOf('formatted:fallback'));
  assert.deepEqual(result.warnings.filter((item) => item.code === 'raster-fallback').map((item) => item.elementId), ['math', 'formatted']);
  assert.equal(result.stats.fallbacks, 2);
});

test('curved and unknown-arrow connectors fall back instead of silently becoming straight lines', async () => {
  const curve = { id: 'curve', kind: 'edge', x: 120, y: 240, width: 200, height: 100, points: [{ x: 120, y: 240 }, { x: 320, y: 340 }], style: { curved: '1' } };
  const customArrow = { ...curve, id: 'custom-arrow', style: { endArrow: 'ERmany' } };
  const result = await exportPresentation({ bridge: bridgeFor([curve, customArrow]), frames: [frame], deck, mode: 'editable' });
  assert.equal(result.stats.fallbacks, 2);
  assert.equal(result.stats.edges, 0);
  assert.equal((await slideXml(await unzip(result))).match(/<p:pic>/g).length, 2);
});

test('plain headings with draw.io transparent default gradients remain editable text', async () => {
  const title = {
    ...rect, id: 'title1',
    style: { shape: 'label', fillColor: 'transparent', strokeColor: 'transparent', gradientColor: 'transparent', align: 'left', fontSize: 34, fontStyle: 1 },
    text: { ...rect.text, plain: '01  研究の全体像', fontSize: 34, align: 'left' },
  };
  const subtitle = { ...title, id: 'subtitle1', kind: 'text', text: { ...title.text, plain: 'キャンバス上の図から、伝えたい範囲を選ぶ' } };
  const bridge = bridgeFor([title, subtitle]);
  bridge.renderElement = () => { throw new Error('Plain headings must not be rasterized'); };
  const result = await exportPresentation({ bridge, frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  assert.match(xml, /<a:t>01  研究の全体像<\/a:t>/);
  assert.match(xml, /<a:t>キャンバス上の図から、伝えたい範囲を選ぶ<\/a:t>/);
  assert.doesNotMatch(xml, /<p:pic>/);
  assert.equal(result.stats.fallbacks, 0);
  assert.equal(result.stats.texts, 2);
});

test('visible gradient shapes still rasterize while unused text body effects do not', async () => {
  const gradient = { ...rect, id: 'gradient', style: { ...rect.style, gradientColor: '#ffffff' } };
  const text = { ...rect, id: 'plain-text', kind: 'text', style: { fillColor: 'none', strokeColor: 'none', gradientColor: '#aabbcc', shadow: 1 }, text: { ...rect.text, plain: '編集可能' } };
  const result = await exportPresentation({ bridge: bridgeFor([gradient, text]), frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  assert.match(xml, /<a:t>編集可能<\/a:t>/);
  assert.equal(result.stats.fallbacks, 1);
  assert.equal(result.warnings.find((warning) => warning.code === 'raster-fallback').elementId, 'gradient');
});

test('objects crossing a frame boundary are retained rather than shifted into view', async () => {
  const crossing = { ...rect, id: 'crossing', x: 40, text: null };
  const result = await exportPresentation({ bridge: bridgeFor([crossing]), frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  assert.match(xml, /<a:off x="-457200" y="914400"\/><a:ext cx="1828800" cy="914400"\/>/);
  assert.ok(result.warnings.some((warning) => warning.code === 'outside-content'));
});

test('connector label background masks the line using measured label bounds before editable text', async () => {
  const edge = {
    id: 'labelled-edge', kind: 'edge', x: 220, y: 320, width: 240, height: 1,
    points: [{ x: 220, y: 320 }, { x: 460, y: 320 }],
    style: { strokeColor: '#000000', labelBackgroundColor: '#ffffff', labelBorderColor: 'none' },
    text: { plain: '関係', x: 220, y: 260, width: 240, height: 120, fontSize: 24, backgroundBounds: { x: 316, y: 308, width: 48, height: 24 } },
  };
  const result = await exportPresentation({ bridge: bridgeFor([edge]), frames: [frame], deck, mode: 'editable' });
  const xml = await slideXml(await unzip(result));
  const shapes = xml.match(/<p:sp>.*?<\/p:sp>/g);
  assert.equal(shapes.length, 3);
  assert.match(shapes[0], /labelled-edge:segment-1/);
  assert.match(shapes[1], /labelled-edge:text-background/);
  assert.match(shapes[1], /<a:off x="1645920" y="822960"\/><a:ext cx="365760" cy="182880"\/>/);
  assert.match(shapes[1], /<a:srgbClr val="FFFFFF"/);
  assert.match(shapes[2], /<a:t>関係<\/a:t>/);
});

test('cancellation stops between frames and never returns a partial deck', async () => {
  const controller = new AbortController();
  let renders = 0;
  const bridge = { async renderFrame() { renders += 1; controller.abort(); return PNG; } };
  await assert.rejects(exportPresentation({ bridge, frames: [frame, { ...frame, id: 'b' }], deck, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(renders, 1);
});

test('render failures reject the whole export and remote image references are not fetched', async () => {
  await assert.rejects(exportPresentation({ bridge: { async renderFrame() { return 'https://example.test/image.png'; } }, frames: [frame], deck }), /画像を取得できません/);
  await assert.rejects(exportPresentation({ bridge: bridgeFor(), frames: [], deck }), /出力するスライド/);
  await assert.rejects(exportPresentation({ bridge: bridgeFor(), frames: [frame], deck, mode: 'unknown' }), /出力モード/);
});
