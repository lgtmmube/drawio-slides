import PptxGenJS from 'pptxgenjs';

const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SHAPES = {
  rect: 'rect', rectangle: 'rect', roundRect: 'roundRect', ellipse: 'ellipse',
  diamond: 'diamond', triangle: 'triangle', hexagon: 'hexagon',
  parallelogram: 'parallelogram', trapezoid: 'trapezoid', cylinder: 'can', cloud: 'cloud',
};
const ARROWS = {
  none: 'none', classic: 'stealth', classicThin: 'stealth', block: 'triangle',
  blockThin: 'triangle', open: 'arrow', openThin: 'arrow', diamond: 'diamond',
  diamondThin: 'diamond', oval: 'oval',
};
const CSS_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500',
  purple: '800080', pink: 'FFC0CB', cyan: '00FFFF', magenta: 'FF00FF',
  navy: '000080', teal: '008080', silver: 'C0C0C0', maroon: '800000',
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const enabled = (value) => value === true || value === 1 || value === '1';
const disabled = (value) => value === false || value === 0 || value === '0';
const rotation = (value) => ((finite(value) % 360) + 360) % 360;

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('出力を中止しました。');
    error.name = 'AbortError';
    throw error;
  }
}

function color(value, fallback = '000000') {
  const source = String(value ?? fallback).trim().toLowerCase();
  if (source === 'none' || source === 'transparent') return { hex: fallback, alpha: 0 };
  if (CSS_COLORS[source]) return { hex: CSS_COLORS[source], alpha: 1 };
  const hex = source.replace(/^#/, '');
  if (/^[\da-f]{3,4}$/.test(hex)) {
    return color(`#${[...hex].map((c) => c + c).join('')}`, fallback);
  }
  if (/^[\da-f]{6}([\da-f]{2})?$/.test(hex)) {
    return { hex: hex.slice(0, 6).toUpperCase(), alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  const rgb = source.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgb) {
    return {
      hex: rgb.slice(1, 4).map((n) => Math.round(clamp(Number(n), 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase(),
      alpha: rgb[4] === undefined ? 1 : clamp(Number(rgb[4]), 0, 1),
    };
  }
  return { hex: fallback, alpha: 1, unknown: true };
}

function opacity(style, type, alpha = 1) {
  const overall = clamp(finite(style.opacity, 100), 0, 100) / 100;
  const component = clamp(finite(style[`${type}Opacity`], 100), 0, 100) / 100;
  return 100 - overall * component * alpha * 100;
}

function validBounds(rect) {
  return rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key])))
    && Number(rect.width) > 0 && Number(rect.height) > 0;
}

function mapping(frame, size) {
  if (!validBounds(frame)) throw new Error('スライド枠の位置またはサイズが不正です。');
  // A uniform scale also protects diagrams registered from an older, differently proportioned frame.
  const scale = Math.min(size.width / frame.width, size.height / frame.height);
  const offsetX = (size.width - frame.width * scale) / 2;
  const offsetY = (size.height - frame.height * scale) / 2;
  return {
    scale,
    point: (point) => ({ x: (finite(point.x) - frame.x) * scale + offsetX, y: (finite(point.y) - frame.y) * scale + offsetY }),
    rect: (rect) => ({
      x: (finite(rect.x) - frame.x) * scale + offsetX,
      y: (finite(rect.y) - frame.y) * scale + offsetY,
      w: Math.max(0.001, finite(rect.width) * scale),
      h: Math.max(0.001, finite(rect.height) * scale),
    }),
    pointSize: (modelUnits) => finite(modelUnits) * scale * 72,
  };
}

function normalizeImage(result, label) {
  const data = typeof result === 'string' ? result : result?.data ?? result?.dataUrl;
  // Never fetch remote image URLs at export time or embed source diagram XML in the package.
  if (typeof data !== 'string' || !/^data:image\/(png|jpe?g);base64,/i.test(data)) {
    throw new Error(`${label}の画像を取得できませんでした。PNG または JPEG の画像が必要です。`);
  }
  return data;
}

function normalizeWarning(warning, frameId) {
  if (typeof warning === 'string') return { code: 'scene-warning', frameId, message: warning };
  return { code: 'scene-warning', frameId, ...warning, message: warning?.message || '変換時の注意があります。' };
}

function richText(text) {
  if (!text) return false;
  if (text.isRich || text.needsRaster || text.richText || Array.isArray(text.runs)) return true;
  const html = String(text.html || '');
  // draw.io uses simple DIV/BR/SPAN wrappers even for ordinary text. Nested formatting,
  // equations, tables and embedded images cannot be faithfully reduced to one text run.
  return /<(?:b|strong|i|em|u|s|strike|sub|sup|font|table|img|svg|math|ul|ol|li)\b/i.test(html)
    || /(?:font-size|font-family|font-weight|font-style|text-decoration|color|background|vertical-align)\s*:/i.test(html)
    || /(?:MathJax|katex|mjx-container)/i.test(html);
}

function fallbackReason(element) {
  const style = element.style || {};
  if (element.kind === 'unsupported') return element.reason || 'この種類の図形は個別編集に対応していません。';
  if (!['shape', 'text', 'edge', 'image'].includes(element.kind)) return 'この要素の種類は個別編集に対応していません。';
  if (richText(element.text)) return '部分的な文字装飾・数式・HTML の表示を保つため画像にしました。';
  // Resolved draw.io styles include inherited shape effects even on plain text. A
  // transparent gradient (the normal text default) is not a visible gradient.
  const hasBody = element.kind === 'shape' || element.kind === 'edge';
  const fill = color(style.fillColor, 'FFFFFF');
  const stroke = color(style.strokeColor, '000000');
  const visibleBody = hasBody && ((element.kind === 'shape' && fill.alpha > 0) || stroke.alpha > 0);
  if (visibleBody && (enabled(style.sketch) || enabled(style.comic))) return '手描き風の線の表示を保つため画像にしました。';
  if (visibleBody && enabled(style.shadow)) return '影の表示を保つため画像にしました。';
  if (element.kind === 'shape' && fill.alpha > 0 && style.gradientColor && color(style.gradientColor).alpha > 0) return 'グラデーションの表示を保つため画像にしました。';
  if (element.kind === 'shape' && style.fillColor && fill.unknown) return '図形の塗り色を再現するため画像にしました。';
  if (hasBody && style.strokeColor && stroke.unknown) return '図形の線色を再現するため画像にしました。';
  if (element.text && [style.labelBackgroundColor, style.labelBorderColor].some((value) => value && color(value).unknown)) return '文字の背景・枠線の色を再現するため画像にしました。';
  if (element.text && rotation(element.text.rotation ?? element.rotation) !== 0
    && !validBounds(element.text.backgroundBounds)
    && [style.labelBackgroundColor, style.labelBorderColor].some((value) => value && color(value).alpha > 0)) return '回転した文字の背景・枠線の位置を保つため画像にしました。';
  if (element.kind === 'shape' && !SHAPES[element.shape]) return 'この種類の図形は個別編集に対応していません。';
  if (element.kind === 'edge') {
    if (enabled(style.curved) || enabled(style.rounded)) return '曲線・角を丸めた線の形を保つため画像にしました。';
    if (!Array.isArray(element.points) || element.points.length < 2) return '線の経路が取得できないため画像にしました。';
    if (element.points.some((p) => !p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)))) return '線の経路が不正なため画像にしました。';
    for (const end of ['start', 'end']) {
      const arrow = style[`${end}Arrow`] || 'none';
      if (!(arrow in ARROWS)) return '特殊な矢印の形を保つため画像にしました。';
      if (arrow !== 'none' && !/^open/.test(arrow) && disabled(style[`${end}Fill`])) return '白抜き矢印の表示を保つため画像にしました。';
    }
    if (enabled(style.jumpStyle) || (style.jumpStyle && style.jumpStyle !== 'none')) return '交差する線の表示を保つため画像にしました。';
  }
  if (element.text && color(element.text.color ?? style.fontColor).unknown) return '文字色を再現するため画像にしました。';
  return null;
}

function shapeLine(style, map) {
  const stroke = color(style.strokeColor, '000000');
  if (stroke.alpha === 0 || finite(style.strokeWidth, 1) <= 0) return { type: 'none' };
  return {
    color: stroke.hex,
    transparency: opacity(style, 'stroke', stroke.alpha),
    width: Math.max(0, map.pointSize(finite(style.strokeWidth, 1))),
    dashType: enabled(style.dashed) ? (style.dashPattern === '1 1' ? 'sysDot' : 'dash') : 'solid',
    ...(enabled(style.fixDash) ? { beginArrowType: 'none', endArrowType: 'none' } : {}),
  };
}

function addText(slide, element, map, stats) {
  const text = element.text;
  if (!text || text.plain === undefined || text.plain === null || text.plain === '') return;
  const style = element.style || {};
  const bounds = validBounds(text) ? text : element;
  const fontStyle = finite(style.fontStyle);
  const foreground = color(text.color ?? style.fontColor, '000000');
  const fontSize = clamp(map.pointSize(finite(text.fontSize ?? style.fontSize, 12)), 1, 4000);
  const fontFamily = String(text.fontFamily || style.fontFamily || 'Arial').split(',')[0].replace(/^[\s'"]+|[\s'"]+$/g, '') || 'Arial';
  const align = ['left', 'center', 'right', 'justify'].includes(text.align || style.align) ? (text.align || style.align) : 'center';
  const vertical = text.valign || style.verticalAlign || 'middle';
  const valign = vertical === 'center' ? 'middle' : ['top', 'middle', 'bottom'].includes(vertical) ? vertical : 'middle';
  const background = color(style.labelBackgroundColor || 'none', 'FFFFFF');
  const border = color(style.labelBorderColor || 'none', '000000');
  if (background.alpha > 0 || border.alpha > 0) {
    // mxText's layout rectangle can fill a whole shape. Use its measured ink/background
    // rectangle so an edge label masks the line without whitening the surrounding figure.
    const backgroundBounds = validBounds(text.backgroundBounds) ? text.backgroundBounds : bounds;
    slide.addShape('rect', {
      ...map.rect(backgroundBounds),
      objectName: `${element.id || 'element'}:text-background`,
      rotate: rotation(text.rotation ?? element.rotation),
      fill: { color: background.hex, transparency: opacity(style, 'text', background.alpha) },
      line: border.alpha > 0 ? { color: border.hex, width: map.pointSize(1), transparency: opacity(style, 'text', border.alpha) } : { type: 'none' },
    });
    stats.shapes += 1;
  }
  slide.addText(String(text.plain), {
    ...map.rect(bounds),
    objectName: `${element.id || 'element'}:text`,
    fontFace: fontFamily,
    fontSize,
    color: foreground.hex,
    transparency: opacity(style, 'text', foreground.alpha),
    bold: text.bold ?? Boolean(fontStyle & 1),
    italic: text.italic ?? Boolean(fontStyle & 2),
    underline: text.underline ?? Boolean(fontStyle & 4),
    ...(fontStyle & 8 ? { strike: 'sngStrike' } : {}),
    align,
    valign,
    margin: 0,
    breakLine: false,
    paraSpaceAfter: 0,
    paraSpaceBefore: 0,
    lineSpacingMultiple: 1,
    rotate: rotation(text.rotation ?? element.rotation),
    fit: 'none',
    wrap: style.whiteSpace === 'wrap' || text.wrap === true,
    lang: 'ja-JP',
    isTextBox: true,
    ...(disabled(style.horizontal) ? { vert: 'vert270' } : {}),
  });
  stats.texts += 1;
}

function addShape(slide, element, map, stats) {
  const style = element.style || {};
  const fill = color(style.fillColor, 'FFFFFF');
  const bounds = map.rect(element);
  let angle = rotation(element.rotation);
  // draw.io triangles point east by default; the PowerPoint preset points north.
  // Swap the unrotated extent for quarter turns to keep the same visual bounds.
  if (element.shape === 'triangle') {
    const direction = { north: 0, east: 90, south: 180, west: 270 }[style.direction || 'east'] ?? 90;
    angle = rotation(angle + direction);
    if (direction === 90 || direction === 270) {
      const { x, y, w, h } = bounds;
      Object.assign(bounds, { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w });
    }
  }
  // Native preset geometries are deliberately limited to the common draw.io shapes.
  slide.addShape(SHAPES[element.shape], {
    ...bounds,
    objectName: `${element.id || 'element'}:shape`,
    rotate: angle,
    flipH: enabled(style.flipH),
    flipV: enabled(style.flipV),
    fill: { color: fill.hex, transparency: opacity(style, 'fill', fill.alpha) },
    line: shapeLine(style, map),
    ...(element.shape === 'roundRect' ? { rectRadius: Math.min(element.width, element.height) * clamp(finite(style.arcSize, 15), 0, 50) / 100 * map.scale } : {}),
  });
  stats.shapes += 1;
}

function addEdge(slide, element, map, stats) {
  const style = element.style || {};
  const points = element.points.map(map.point).filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    // OOXML extents must be positive. Flip flags retain the path's directed endpoints,
    // including lines travelling up or left and arrows on the last segment only.
    slide.addShape('line', {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y),
      flipH: end.x < start.x,
      flipV: end.y < start.y,
      objectName: `${element.id || 'edge'}:segment-${index}`,
      line: {
        ...shapeLine(style, map),
        beginArrowType: index === 1 ? ARROWS[style.startArrow || 'none'] : 'none',
        endArrowType: index === points.length - 1 ? ARROWS[style.endArrow || 'none'] : 'none',
      },
    });
  }
  stats.edges += 1;
}

async function addFallback(slide, element, bridge, map, context, reason) {
  checkAbort(context.signal);
  const rendered = element.fallbackPNG && validBounds(element)
    ? { data: element.fallbackPNG, ...element }
    : await bridge.renderElement(element.id);
  checkAbort(context.signal);
  if (!validBounds(rendered)) throw new Error(`要素「${element.id}」の画像サイズを取得できませんでした。`);
  slide.addImage({ data: normalizeImage(rendered, '要素'), ...map.rect(rendered), objectName: `${element.id}:fallback` });
  context.stats.images += 1;
  context.stats.fallbacks += 1;
  context.warnings.push({ code: 'raster-fallback', frameId: context.frameId, elementId: element.id, message: reason });
}

async function addEditable(slide, scene, bridge, map, context) {
  for (const element of scene.elements || []) {
    checkAbort(context.signal);
    const reason = fallbackReason(element);
    if (reason) {
      await addFallback(slide, element, bridge, map, context, reason);
      continue;
    }
    if (element.kind === 'edge') {
      addEdge(slide, element, map, context.stats);
      const count = element.points.length - 1;
      if (count > 1) context.warnings.push({ code: 'segmented-edge', frameId: context.frameId, elementId: element.id, message: '折れ線は区間ごとに編集できる線として出力しました。接続は自動追従しません。' });
      if ((element.style?.startArrow && element.style.startArrow !== 'none') || (element.style?.endArrow && element.style.endArrow !== 'none')) {
        context.warnings.push({ code: 'arrow-appearance', frameId: context.frameId, elementId: element.id, message: '矢印の先端は PowerPoint の標準形状です。draw.io と大きさ・形がわずかに異なる場合があります。' });
      }
    } else if (element.kind === 'shape') {
      addShape(slide, element, map, context.stats);
      if (!['rect', 'rectangle', 'ellipse', 'diamond'].includes(element.shape)) context.warnings.push({ code: 'preset-geometry', frameId: context.frameId, elementId: element.id, message: 'PowerPoint の標準図形に変換しました。角丸や輪郭の細部は draw.io と異なる場合があります。' });
    } else if (element.kind === 'image') {
      // A rendered image uses the graph's image sizing/cropping, so it matches the source.
      const rendered = element.imageData && validBounds(element)
        ? { data: element.imageData, ...element }
        : await bridge.renderElement(element.id);
      checkAbort(context.signal);
      if (!validBounds(rendered)) throw new Error(`画像「${element.id}」のサイズが不正です。`);
      slide.addImage({ data: normalizeImage(rendered, '画像'), ...map.rect(rendered), rotate: element.imageData ? rotation(element.rotation) : 0, objectName: `${element.id}:image` });
      context.stats.images += 1;
      // renderElement includes a label; do not add it for a second time.
      if (!element.imageData) continue;
    }
    addText(slide, element, map, context.stats);
  }
}

/**
 * Build a PowerPoint without initiating a browser download.
 * All coordinates exposed by the bridge are unzoomed model coordinates.
 * Warnings are structured, Japanese, and intended to remain visible before saving.
 */
export async function exportPresentation({ bridge, frames, deck = {}, mode = 'image', imageWidth = 1920, filename, onProgress, signal }) {
  checkAbort(signal);
  if (!bridge) throw new Error('draw.io が読み込まれていません。');
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('出力するスライドを選んでください。');
  if (!['image', 'editable'].includes(mode)) throw new Error('出力モードが不正です。');
  if (deck.ratio !== undefined && !['16:9', '4:3'].includes(deck.ratio)) throw new Error('縦横比は 16:9 または 4:3 を選んでください。');
  if (![1920, 3840].includes(Number(imageWidth))) throw new Error('画像幅は 1920 または 3840 を選んでください。');
  const size = deck.ratio === '4:3' ? { width: 10, height: 7.5 } : { width: 40 / 3, height: 7.5 };
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DRAWIO_SLIDES', width: size.width, height: size.height });
  pptx.layout = 'DRAWIO_SLIDES';
  pptx.author = 'draw.io Slides';
  pptx.subject = mode === 'image' ? 'draw.io スライド（見た目を保つ画像モード）' : 'draw.io スライド（個別編集モード）';
  pptx.title = deck.name || filename?.replace(/\.pptx$/i, '') || 'draw.io スライド';
  pptx.company = '';
  pptx.lang = 'ja-JP';
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'ja-JP' };
  const warnings = [];
  const stats = { slides: frames.length, shapes: 0, texts: 0, edges: 0, images: 0, fallbacks: 0 };
  if (mode === 'editable') {
    warnings.push({ code: 'editable-fidelity', message: '個別編集モードでは、フォント・改行・図形の輪郭などが元の表示と異なる場合があります。見た目を優先する場合は画像モードをご利用ください。' });
    warnings.push({ code: 'outside-content', message: '枠をまたぐ要素は、枠の外側の部分も PowerPoint 内に残ります。文字や図形の編集時には表示されることがあります。' });
  }
  for (let index = 0; index < frames.length; index += 1) {
    checkAbort(signal);
    const frame = frames[index];
    const report = (stage) => onProgress?.({ completed: index, total: frames.length, stage, frameId: frame.id, message: `${index + 1} / ${frames.length} 枚目を変換しています` });
    report('rendering');
    const slide = pptx.addSlide();
    slide.background = { color: color(deck.background, 'FFFFFF').hex };
    if (mode === 'image') {
      const data = normalizeImage(await bridge.renderFrame(frame.id, { width: Number(imageWidth), background: deck.background || '#ffffff' }), 'スライド');
      checkAbort(signal);
      const map = validBounds(frame) ? mapping(frame, size) : null;
      if (map && Math.abs(frame.width / frame.height - size.width / size.height) > 0.002) warnings.push({ code: 'aspect-ratio', frameId: frame.id, message: '枠とスライドの縦横比が異なるため、画像を変形させず余白を付けました。' });
      slide.addImage({ data, ...(map ? map.rect(frame) : { x: 0, y: 0, w: size.width, h: size.height }), objectName: `slide-${index + 1}:image`, altText: frame.title || `スライド ${index + 1}` });
      stats.images += 1;
    } else {
      const scene = await bridge.getScene(frame.id);
      checkAbort(signal);
      const resolvedFrame = scene.frame || frame;
      const map = mapping(resolvedFrame, size);
      if (Math.abs(resolvedFrame.width / resolvedFrame.height - size.width / size.height) > 0.002) warnings.push({ code: 'aspect-ratio', frameId: frame.id, message: '枠とスライドの縦横比が異なるため、図形を変形させず余白を付けました。' });
      warnings.push(...(scene.warnings || []).map((warning) => normalizeWarning(warning, frame.id)));
      await addEditable(slide, scene, bridge, map, { signal, warnings, stats, frameId: frame.id });
    }
    onProgress?.({ completed: index + 1, total: frames.length, stage: 'converted', frameId: frame.id, message: `${index + 1} / ${frames.length} 枚の変換が完了しました` });
  }
  checkAbort(signal);
  onProgress?.({ completed: frames.length, total: frames.length, stage: 'packaging', message: 'PowerPoint ファイルを作成しています' });
  const result = await pptx.write({ outputType: 'blob', compression: true });
  checkAbort(signal);
  const blob = result instanceof Blob ? result : new Blob([result], { type: MIME });
  return { blob, warnings, stats };
}
