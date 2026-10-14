/* Editor da gravação a laser: arte preta, 100% vetorial, em milímetros.
   O arquivo exportado só tem <path> com coordenadas já em mm (nenhum transform, texto ou imagem),
   pra abrir limpo no Illustrator, CorelDRAW, LightBurn e afins. */
window.LaserEditor = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const VERSION = 2;
  const MAX_ITEMS = 100;
  const SNAP_PX = 6;
  const DEFAULT_TEXT = 'Seu texto';
  const MATERIALS = { courino: 'Courino', tecido: 'Tecido' };

  /* ---------------------------------- utilidades ---------------------------------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fallback);
  const f3 = n => String(+n.toFixed(3));
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const normalizeSearch = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  /* ---------------------------------- matrizes ---------------------------------- */
  // Mesma convenção do SVG: x' = a·x + c·y + e ; y' = b·x + d·y + f.
  const IDENT = { a:1, b:0, c:0, d:1, e:0, f:0 };
  const mul = (m, n) => ({
    a: m.a*n.a + m.c*n.b, b: m.b*n.a + m.d*n.b, c: m.a*n.c + m.c*n.d, d: m.b*n.c + m.d*n.d,
    e: m.a*n.e + m.c*n.f + m.e, f: m.b*n.e + m.d*n.f + m.f,
  });
  const translateM = (x, y) => ({ a:1, b:0, c:0, d:1, e:x, f:y });
  const scaleM = (sx, sy) => ({ a:sx, b:0, c:0, d:sy, e:0, f:0 });
  const rotateM = deg => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { a:c, b:s, c:-s, d:c, e:0, f:0 }; };
  const applyM = (m, x, y) => [m.a*x + m.c*y + m.e, m.b*x + m.d*y + m.f];
  const matrixAttr = m => 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(v => +v.toFixed(6)).join(' ') + ')';

  /* ---------------------------------- geometria dos elementos ---------------------------------- */
  // x/y = canto superior esquerdo da caixa SEM rotação; w = largura; a altura segue a proporção da arte.
  const itemH = it => it.w * it.bounds.h / it.bounds.w;
  const itemCenter = it => ({ x: it.x + it.w / 2, y: it.y + itemH(it) / 2 });
  function itemMatrix(it) {
    const k = it.w / it.bounds.w, c = itemCenter(it);
    return mul(mul(mul(mul(translateM(c.x, c.y), rotateM(it.rot || 0)), translateM(-it.w / 2, -itemH(it) / 2)), scaleM(k, k)), translateM(-it.bounds.x, -it.bounds.y));
  }
  function itemCorners(it) {
    const c = itemCenter(it), h = itemH(it), r = rotateM(it.rot || 0);
    return [[-it.w/2, -h/2], [it.w/2, -h/2], [it.w/2, h/2], [-it.w/2, h/2]].map(([x, y]) => {
      const p = applyM(r, x, y); return { x: c.x + p[0], y: c.y + p[1] };
    });
  }
  function itemAABB(it) {
    const pts = itemCorners(it), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /* ---------------------------------- caminhos SVG ---------------------------------- */
  // Lê qualquer "d" de path SVG e devolve só comandos absolutos M/L/C/Q/Z (relativos, H/V, S/T e
  // arcos viram esses). Com isso dá pra aplicar qualquer matriz nos pontos e exportar sem transform.
  function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
    if (!rx || !ry || (x1 === x2 && y1 === y2)) return [['L', x2, y2]];
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = phiDeg * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const sign = large === sweep ? -1 : 1;
    const num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p, den = rx*rx*y1p*y1p + ry*ry*x1p*x1p;
    const coef = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = coef * (rx * y1p / ry), cyp = coef * (-ry * x1p / rx);
    const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2, cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry, vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta1 = angle(1, 0, ux, uy);
    let dTheta = angle(ux, uy, vx, vy);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI; else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9)), delta = dTheta / n;
    const t = 4 / 3 * Math.tan(delta / 4);
    const pt = (px, py) => [cosP * rx * px - sinP * ry * py + cx, sinP * rx * px + cosP * ry * py + cy];
    const out = [];
    let th = theta1;
    for (let i = 0; i < n; i++, th += delta) {
      const c1 = Math.cos(th), s1 = Math.sin(th), c2 = Math.cos(th + delta), s2 = Math.sin(th + delta);
      const p1 = pt(c1 - t * s1, s1 + t * c1), p2 = pt(c2 + t * s2, s2 - t * c2);
      const p3 = i === n - 1 ? [x2, y2] : pt(c2, s2);
      out.push(['C', p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]);
    }
    return out;
  }
  function parsePathData(d) {
    const bad = () => new Error('O SVG tem um desenho que não consegui ler.');
    const segs = [];
    const numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    const len = d.length;
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0, prev = '';
    const skip = () => { while (i < len && ' ,\t\n\r'.includes(d[i])) i++; };
    const num = () => {
      skip(); numRe.lastIndex = i;
      const m = numRe.exec(d);
      if (!m) throw bad();
      i = numRe.lastIndex;
      return parseFloat(m[0]);
    };
    const flag = () => { skip(); const c = d[i]; if (c !== '0' && c !== '1') throw bad(); i++; return +c; };
    for (;;) {
      skip();
      if (i >= len) break;
      if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
      else if (!cmd) throw bad();
      const rel = cmd >= 'a', C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === 'Z') { segs.push(['Z']); cx = sx; cy = sy; prev = 'Z'; cmd = ''; continue; }
      if (C === 'M') {
        const x = num() + ox, y = num() + oy;
        segs.push(['M', x, y]); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L'; prev = 'M';
      } else if (C === 'L') {
        const x = num() + ox, y = num() + oy;
        segs.push(['L', x, y]); cx = x; cy = y; prev = 'L';
      } else if (C === 'H') {
        const x = num() + ox; segs.push(['L', x, cy]); cx = x; prev = 'L';
      } else if (C === 'V') {
        const y = num() + oy; segs.push(['L', cx, y]); cy = y; prev = 'L';
      } else if (C === 'C') {
        const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
        segs.push(['C', x1, y1, x2, y2, x, y]); px = x2; py = y2; cx = x; cy = y; prev = 'C';
      } else if (C === 'S') {
        const x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
        const x1 = prev === 'C' ? 2 * cx - px : cx, y1 = prev === 'C' ? 2 * cy - py : cy;
        segs.push(['C', x1, y1, x2, y2, x, y]); px = x2; py = y2; cx = x; cy = y; prev = 'C';
      } else if (C === 'Q') {
        const x1 = num() + ox, y1 = num() + oy, x = num() + ox, y = num() + oy;
        segs.push(['Q', x1, y1, x, y]); px = x1; py = y1; cx = x; cy = y; prev = 'Q';
      } else if (C === 'T') {
        const x = num() + ox, y = num() + oy;
        const x1 = prev === 'Q' ? 2 * cx - px : cx, y1 = prev === 'Q' ? 2 * cy - py : cy;
        segs.push(['Q', x1, y1, x, y]); px = x1; py = y1; cx = x; cy = y; prev = 'Q';
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), x = num() + ox, y = num() + oy;
        arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y).forEach(s => segs.push(s));
        cx = x; cy = y; prev = 'A';
      } else throw bad();
    }
    if (!segs.length || segs.some(s => s.slice(1).some(v => !Number.isFinite(v)))) throw bad();
    return segs;
  }
  function transformSegs(segs, m) {
    return segs.map(s => {
      const out = [s[0]];
      for (let i = 1; i < s.length; i += 2) out.push(...applyM(m, s[i], s[i + 1]));
      return out;
    });
  }
  const serializeSegs = segs => segs.map(s => s[0] + s.slice(1).map(f3).join(' ')).join('');

  /* ---------------------------------- importação de SVG (ícones do site e do usuário) ---------------------------------- */
  const BLOCKED = {
    script: 'Este SVG tem script.', foreignObject: 'Este SVG tem conteúdo embutido (foreignObject).', image: 'Este SVG tem imagem incorporada — a gravação precisa ser só vetor.',
    use: 'Este SVG usa elementos reaproveitados (<use>). Abra num editor e use "Expandir/Converter em curvas".', symbol: 'Este SVG usa símbolos. Converta em curvas antes de importar.',
    text: 'Este SVG tem texto. Converta o texto em curvas antes de importar (ou use o botão "Texto" do editor).', tspan: 'Este SVG tem texto. Converta o texto em curvas antes de importar.',
    linearGradient: 'Este SVG tem degradê. A gravação é de uma cor só — use um desenho chapado.', radialGradient: 'Este SVG tem degradê. A gravação é de uma cor só — use um desenho chapado.',
    pattern: 'Este SVG tem padrão de preenchimento. Use um desenho chapado.', mask: 'Este SVG usa máscara. Expanda a arte antes de importar.',
    filter: 'Este SVG usa filtro/efeito. Expanda a arte antes de importar.', clipPath: 'Este SVG usa recorte (clip-path). Expanda a arte antes de importar.', marker: 'Este SVG usa marcadores. Expanda a arte antes de importar.',
  };
  const SKIP = new Set(['defs', 'style', 'metadata', 'title', 'desc']);
  const STYLE_PROPS = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'display', 'opacity', 'visibility'];
  const INHERITED = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'visibility'];
  const isWhite = v => /^(#fff(fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(v.trim());
  const parseDecls = text => {
    const out = {};
    String(text || '').split(';').forEach(part => {
      const i = part.indexOf(':');
      if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim();
    });
    return out;
  };
  // Só entende seletores simples (tag, .classe, #id) — o que CorelDRAW/Illustrator/Inkscape geram.
  function collectRules(doc) {
    const rules = [];
    for (const style of doc.getElementsByTagNameNS(NS, 'style')) {
      const css = style.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = parseDecls(m[2]);
        m[1].split(',').map(s => s.trim()).filter(s => s && s[0] !== '@').forEach(sel => rules.push({ sel, decls }));
      }
    }
    return rules;
  }
  function selectorMatches(sel, node) {
    if (sel === '*') return true;
    const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)(#[\w-]+)?$/.exec(sel);
    if (!m || (!m[1] && !m[2] && !m[3])) return false;
    if (m[1] && m[1] !== node.localName) return false;
    if (m[3] && m[3].slice(1) !== node.getAttribute('id')) return false;
    const classes = (node.getAttribute('class') || '').split(/\s+/);
    return m[2].split('.').filter(Boolean).every(c => classes.includes(c));
  }
  function ownStyle(node, rules) {
    // ordem do CSS: atributo de apresentação < folha de estilo < style="" do próprio elemento
    const st = {};
    STYLE_PROPS.forEach(p => { if (node.hasAttribute(p)) st[p] = node.getAttribute(p).trim(); });
    rules.forEach(r => { if (selectorMatches(r.sel, node)) STYLE_PROPS.forEach(p => { if (r.decls[p] !== undefined) st[p] = r.decls[p]; }); });
    const inline = parseDecls(node.getAttribute('style'));
    STYLE_PROPS.forEach(p => { if (inline[p] !== undefined) st[p] = inline[p]; });
    return st;
  }
  function parseTransform(text) {
    let m = IDENT;
    for (const t of String(text).matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
      const v = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (v.some(n => !Number.isFinite(n))) throw new Error('O SVG tem uma transformação que não consegui ler.');
      let n = IDENT;
      if (t[1] === 'matrix' && v.length === 6) n = { a:v[0], b:v[1], c:v[2], d:v[3], e:v[4], f:v[5] };
      else if (t[1] === 'translate') n = translateM(v[0] || 0, v[1] || 0);
      else if (t[1] === 'scale') n = scaleM(v[0], v.length > 1 ? v[1] : v[0]);
      else if (t[1] === 'rotate') n = v.length === 3 ? mul(mul(translateM(v[1], v[2]), rotateM(v[0])), translateM(-v[1], -v[2])) : rotateM(v[0] || 0);
      else if (t[1] === 'skewX') n = { a:1, b:0, c:Math.tan((v[0] || 0) * Math.PI / 180), d:1, e:0, f:0 };
      else if (t[1] === 'skewY') n = { a:1, b:Math.tan((v[0] || 0) * Math.PI / 180), c:0, d:1, e:0, f:0 };
      m = mul(m, n);
    }
    return m;
  }
  function shapeToPath(node, tag) {
    const n = name => parseFloat(node.getAttribute(name)) || 0;
    if (tag === 'path') return node.getAttribute('d') || null;
    if (tag === 'rect') {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return null;
      let rx = n('rx'), ry = n('ry');
      if (!rx && !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      rx = Math.min(rx || ry, w / 2); ry = Math.min(ry || rx, h / 2);
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = n('cx'), cy = n('cy'), rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    if (tag === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    if (tag === 'polyline' || tag === 'polygon') {
      const v = (node.getAttribute('points') || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
      if (!v || v.length < 4) return null;
      let d = '';
      for (let i = 0; i + 1 < v.length; i += 2) d += (i ? 'L' : 'M') + v[i] + ' ' + v[i + 1];
      return d + (tag === 'polygon' ? 'Z' : '');
    }
    return null;
  }
  function unitToMm(text) {
    const m = /^\s*([\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(text || '');
    if (!m) return null;
    const factor = { mm:1, cm:10, in:25.4, pt:25.4 / 72, pc:25.4 / 6, px:25.4 / 96 }[(m[2] || 'px').toLowerCase()];
    return parseFloat(m[1]) * factor;
  }
  // Mede a tinta de verdade (não o viewBox) com o próprio navegador, que já sabe medir curvas.
  function measureInk(paths) {
    const holder = svgEl('svg', { width: 1, height: 1, style: 'position:absolute;left:-9999px;top:0;visibility:hidden' });
    paths.forEach(p => holder.append(svgEl('path', { d: p.d })));
    document.body.append(holder);
    let box;
    try { box = holder.getBBox(); } finally { holder.remove(); }
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }
  // Devolve só <path> absolutos, tudo preto. Branco = "não grava" e é ignorado.
  function sanitizeIcon(source) {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (doc.querySelector('parsererror') || !root || root.localName !== 'svg') throw new Error('Esse arquivo não é um SVG válido.');
    const ctx = { rules: collectRules(doc), paths: [], whiteIgnored: false };
    function walk(node, inherited, ctm) {
      if (node.nodeType !== 1 || node.namespaceURI !== NS) return;
      const tag = node.localName;
      if (BLOCKED[tag]) throw new Error(BLOCKED[tag]);
      if (SKIP.has(tag)) return;
      for (const attr of ['clip-path', 'mask', 'filter']) {
        const v = node.getAttribute(attr);
        if (v && v !== 'none') throw new Error('Este SVG usa recorte, máscara ou efeito. Expanda a arte num editor antes de importar.');
      }
      const own = ownStyle(node, ctx.rules);
      if (own.display === 'none' || own.visibility === 'hidden' || own.opacity === '0') return;
      const st = Object.assign({}, inherited);
      INHERITED.forEach(p => { if (own[p] !== undefined) st[p] = own[p]; });
      const m = node.hasAttribute('transform') ? mul(ctm, parseTransform(node.getAttribute('transform'))) : ctm;
      if (tag === 'g' || tag === 'svg' || tag === 'a') { for (const child of node.children) walk(child, st, m); return; }
      const d = shapeToPath(node, tag);
      if (!d) return;
      const fillRaw = String(st.fill === undefined ? 'black' : st.fill).toLowerCase();
      const strokeRaw = String(st.stroke === undefined ? 'none' : st.stroke).toLowerCase();
      if (/^url\(/.test(fillRaw) || /^url\(/.test(strokeRaw)) throw new Error(BLOCKED.linearGradient);
      const fill = fillRaw !== 'none' && !isWhite(fillRaw);
      if (fillRaw !== 'none' && isWhite(fillRaw)) ctx.whiteIgnored = true;
      let stroke = 0;
      if (strokeRaw !== 'none' && !isWhite(strokeRaw)) stroke = (parseFloat(st['stroke-width']) || 1) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      if (!fill && !stroke) return;
      ctx.paths.push({ d: serializeSegs(transformSegs(parsePathData(d), m)), fill, rule: st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', stroke: +stroke.toFixed(3) });
    }
    walk(root, {}, IDENT);
    if (!ctx.paths.length) throw new Error('Não encontrei formas pretas nesse SVG.');
    const bounds = measureInk(ctx.paths);
    if (!(bounds.w > 0) || !(bounds.h > 0)) throw new Error('O desenho desse SVG está vazio.');
    // Tamanho físico declarado no arquivo (ex.: width="17mm") vira o tamanho inicial.
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
    const widthMm = unitToMm(root.getAttribute('width'));
    const mmPerUnit = widthMm && vb.length === 4 && vb[2] > 0 ? widthMm / vb[2] : null;
    return { paths: ctx.paths, bounds, mmWidth: mmPerUnit ? bounds.w * mmPerUnit : null, whiteIgnored: ctx.whiteIgnored };
  }

  /* ---------------------------------- estado, rascunho e exportação ---------------------------------- */
  function cleanItem(r) {
    if (!r || (r.type !== 'text' && r.type !== 'icon') || !Array.isArray(r.paths) || !r.bounds) return null;
    const b = r.bounds;
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0) return null;
    const paths = r.paths
      .filter(p => p && typeof p.d === 'string' && /^[MLCQZ0-9eE.,\s+-]+$/.test(p.d))
      .map(p => ({ d: p.d, fill: p.fill !== false, rule: p.rule === 'evenodd' ? 'evenodd' : 'nonzero', stroke: Math.max(0, +p.stroke || 0) }));
    if (!paths.length) return null;
    const item = {
      id: String(r.id || uid()), type: r.type, label: String(r.label || '').slice(0, 80), paths,
      bounds: { x: +b.x, y: +b.y, w: +b.w, h: +b.h }, x: +r.x || 0, y: +r.y || 0, w: Math.max(0.5, +r.w || 10), rot: +r.rot || 0,
    };
    if (r.type === 'text') {
      Object.assign(item, {
        text: String(r.text || '').slice(0, 200), fontKey: String(r.fontKey || ''),
        align: ['left', 'center', 'right'].includes(r.align) ? r.align : 'left',
        lineHeight: clamp(r.lineHeight, 0.6, 3, 1.2), letterSpacing: clamp(r.letterSpacing, -0.2, 1, 0), unit: +r.unit || 1000,
      });
    }
    return item;
  }
  function cleanState(raw) {
    const state = { v: VERSION, width: 200, height: 200, margin: 5, material: 'courino', ident: '', items: [] };
    if (!raw || raw.v !== VERSION || !Array.isArray(raw.items)) return state;
    state.width = clamp(raw.width, 10, 1000, 200);
    state.height = clamp(raw.height, 10, 1000, 200);
    state.margin = clamp(raw.margin, 0, 100, 5);
    state.material = raw.material === 'tecido' ? 'tecido' : 'courino';
    state.ident = typeof raw.ident === 'string' ? raw.ident.slice(0, 60) : '';
    state.items = raw.items.slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
    return state;
  }
  const draftKey = user => 'capabuilder:laser:v' + VERSION + ':' + user.usuario;
  function loadDraft(user) {
    try { return cleanState(JSON.parse(localStorage.getItem(draftKey(user)))); } catch (e) { return cleanState(null); }
  }
  function hasDraft(user) {
    try { return loadDraft(user).items.length > 0; } catch (e) { return false; }
  }
  const fileSlug = text => normalizeSearch(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  function exportName(state) {
    return ['gravacao', fileSlug(state.ident), state.material, f3(state.width) + 'x' + f3(state.height) + 'mm'].filter(Boolean).join('-') + '.svg';
  }
  function buildSvg(state) {
    const paths = [];
    state.items.forEach(item => {
      const m = itemMatrix(item), k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      item.paths.forEach(p => {
        const d = serializeSegs(transformSegs(parsePathData(p.d), m));
        let attrs = p.fill ? 'fill="#000" fill-rule="' + p.rule + '"' : 'fill="none"';
        if (p.stroke) attrs += ' stroke="#000" stroke-width="' + f3(p.stroke * k) + '"';
        paths.push('<path d="' + d + '" ' + attrs + '/>');
      });
    });
    const title = 'Gravação a laser · ' + MATERIALS[state.material] + ' · ' + f3(state.width) + '×' + f3(state.height) + ' mm' + (state.ident ? ' · ' + state.ident : '');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="' + NS + '" width="' + f3(state.width) + 'mm" height="' + f3(state.height) + 'mm" viewBox="0 0 ' + f3(state.width) + ' ' + f3(state.height) + '">\n' +
      '<title>' + esc(title) + '</title>\n<g id="gravacao">\n' + paths.join('\n') + '\n</g>\n</svg>\n';
  }
  // Situação de cada elemento em relação à área: erro = passa da área (bloqueia o export), aviso = passa da margem.
  function itemIssue(state, item) {
    const box = itemAABB(item), eps = 0.01;
    if (box.x < -eps || box.y < -eps || box.x + box.w > state.width + eps || box.y + box.h > state.height + eps) return 'error';
    const m = state.margin;
    if (m > 0 && (box.x < m - eps || box.y < m - eps || box.x + box.w > state.width - m + eps || box.y + box.h > state.height - m + eps)) return 'warn';
    return null;
  }

  /* ---------------------------------- editor ---------------------------------- */
  async function open(options) {
    await options.api('/api/laser'); // confere a permissão do produto antes de abrir
    if (document.getElementById('laser-editor')) return;
    const fonts = options.fonts || [];
    const icons = options.icons || [];
    const toast = (msg, kind) => { if (options.toast) options.toast(msg, kind); };
    const confirmAsk = async (msg, opts) => (options.confirm ? options.confirm(msg, opts) : window.confirm(msg));
    const iconHtml = (name, cls) => (options.icon ? options.icon(name, cls) : '');
    const abort = new AbortController();
    const listen = (target, type, fn, opts) => target.addEventListener(type, fn, Object.assign({ signal: abort.signal }, opts));

    let state = loadDraft(options.user);
    let selectedId = null, history = [], historyIndex = -1, zoom = 1, guides = [], drag = null;
    const textJobs = new Map(); // id -> número da última requisição (descarta respostas antigas)
    const sel = () => state.items.find(i => i.id === selectedId) || null;

    const host = document.createElement('div');
    host.id = 'laser-editor'; host.className = 'laser-editor';
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', 'Editor de gravação a laser');
    const presetOptions = (options.presets || []).map((p, i) => '<option value="' + i + '">' + esc(p.label) + ' — ' + p.w + '×' + p.h + ' mm</option>').join('');
    host.innerHTML =
      '<header class="le-head">' +
        '<button type="button" class="btn ghost" data-close>' + iconHtml('arrowLeft') + ' Voltar</button>' +
        '<strong class="le-title">Gravação a laser</strong>' +
        '<span class="le-sub" data-sub></span>' +
        '<button type="button" class="btn" data-undo title="Desfazer (Ctrl+Z)">Desfazer</button>' +
        '<button type="button" class="btn" data-redo title="Refazer (Ctrl+Shift+Z)">Refazer</button>' +
        '<button type="button" class="btn" data-png>Prévia PNG</button>' +
        '<button type="button" class="btn primary" data-export>' + iconHtml('download') + ' Exportar SVG</button>' +
      '</header>' +
      '<div class="le-body">' +
        '<aside class="le-side">' +
          '<section><h2>Área de gravação</h2>' +
            '<div class="le-field"><label for="le-preset">Medida da capa</label><select id="le-preset" data-preset><option value="">Personalizada</option>' + presetOptions + '</select></div>' +
            '<div class="le-row"><div class="le-field"><label for="le-w">Largura (mm)</label><input id="le-w" data-width type="number" min="10" max="1000" step="0.1"></div>' +
            '<div class="le-field"><label for="le-h">Altura (mm)</label><input id="le-h" data-height type="number" min="10" max="1000" step="0.1"></div></div>' +
            '<div class="le-row"><div class="le-field"><label for="le-m">Margem (mm)</label><input id="le-m" data-margin type="number" min="0" max="100" step="0.5"></div>' +
            '<div class="le-field"><label for="le-mat">Material</label><select id="le-mat" data-material><option value="courino">Courino</option><option value="tecido">Tecido</option></select></div></div>' +
            '<div class="le-field"><label for="le-id">Pedido / identificação</label><input id="le-id" data-ident type="text" maxlength="60" placeholder="Ex.: 48213 Eduardo e Thais"></div>' +
            '<p class="le-hint">Informe a área útil da capa pronta. A margem é só uma guia: elementos fora dela ficam em amarelo.</p>' +
          '</section>' +
          '<section><h2>Adicionar</h2>' +
            '<div class="le-add"><button type="button" class="btn" data-add-text>' + iconHtml('type') + ' Texto</button>' +
            '<button type="button" class="btn" data-add-icon>' + iconHtml('star') + ' Ícone</button>' +
            '<label class="btn" tabindex="0" data-upload-label>' + iconHtml('upload') + ' Meu SVG<input data-upload type="file" accept=".svg,image/svg+xml" hidden></label></div>' +
          '</section>' +
          '<section><h2>Elementos <span data-count></span></h2><ul class="le-items" data-items aria-label="Elementos da gravação"></ul>' +
            '<button type="button" class="btn ghost small" data-clear>Limpar tudo</button></section>' +
        '</aside>' +
        '<main class="le-main">' +
          '<div class="le-bar"><span data-dims></span><span class="le-spacer"></span>' +
            '<button type="button" class="btn small" data-zoom="-">−</button><button type="button" class="btn small" data-zoom="fit" data-zoom-label>100%</button><button type="button" class="btn small" data-zoom="+">+</button></div>' +
          '<div class="le-stage" data-stage><div class="le-paper" data-paper></div></div>' +
          '<p class="le-status" role="status" aria-live="polite" data-status></p>' +
        '</main>' +
        '<aside class="le-props" data-props></aside>' +
      '</div>' +
      '<div class="le-picker" data-picker hidden></div>';
    document.body.append(host);

    const q = s => host.querySelector(s);
    const paper = q('[data-paper]');
    const svg = svgEl('svg', { role: 'img', 'aria-label': 'Área de gravação' });
    paper.append(svg);
    const setStatus = (text, kind) => { const n = q('[data-status]'); n.textContent = text || ''; n.dataset.kind = kind || ''; };

    /* ---- persistência e histórico ---- */
    function save() {
      try { localStorage.setItem(draftKey(options.user), JSON.stringify(state)); }
      catch (e) { setStatus('Não deu pra salvar o rascunho neste navegador. Exporte a arte antes de sair.', 'error'); }
    }
    function commit() {
      history = history.slice(0, historyIndex + 1);
      history.push(JSON.stringify(state));
      if (history.length > 40) history.shift();
      historyIndex = history.length - 1;
      save(); render();
    }
    const commitSoon = debounce(commit, 450);
    function restore(index) {
      historyIndex = index;
      state = cleanState(JSON.parse(history[index]));
      if (!sel()) selectedId = null;
      save(); render();
    }

    /* ---- fontes ---- */
    const fontByKey = key => fonts.find(f => f.v === key) || fonts[0];
    function fontRequest(f) {
      if (f.family && /^Site_/.test(f.family)) return { fontId: f.family.slice(5) };
      if (f.dataUrl && /^data:/.test(f.dataUrl)) return { fontData: f.dataUrl };
      return { family: f.v.split(',')[0].replace(/"/g, '').trim() };
    }
    // Fontes do site/importadas já estão carregadas no navegador, então dá pra descobrir pelo canvas
    // se falta algum caractere (ã, ç, números...) sem pedir nada ao servidor: se o glifo não existe,
    // a largura muda conforme a fonte reserva usada.
    const probe = document.createElement('canvas').getContext('2d');
    const missingCache = new Map();
    function missingChars(f, text) {
      if (!f || !f.family || !/^(Site_|Custom_)/.test(f.family)) return [];
      const family = f.v.split(',')[0];
      if (!document.fonts || !document.fonts.check('32px ' + family)) return [];
      const bad = [];
      for (const ch of new Set(text.replace(/\s/g, ''))) {
        const key = f.v + '|' + ch;
        if (!missingCache.has(key)) {
          const widths = ['monospace', 'serif', 'sans-serif'].map(fb => { probe.font = '32px ' + family + ', ' + fb; return probe.measureText(ch).width; });
          missingCache.set(key, !(widths[0] === widths[1] && widths[1] === widths[2]));
        }
        if (missingCache.get(key)) bad.push(ch);
      }
      return bad;
    }

    /* ---- criação e atualização dos elementos ---- */
    function placeNew(item, mmWidth) {
      const maxW = state.width * 0.8, maxH = state.height * 0.8;
      let w = mmWidth || Math.min(60, state.width * 0.5);
      w = Math.min(w, maxW, maxH * item.bounds.w / item.bounds.h);
      item.w = Math.max(1, +w.toFixed(2));
      item.x = +((state.width - item.w) / 2).toFixed(2);
      item.y = +((state.height - itemH(item)) / 2).toFixed(2);
    }
    function pushItem(item) {
      if (state.items.length >= MAX_ITEMS) throw new Error('Limite de ' + MAX_ITEMS + ' elementos por arte.');
      state.items.push(item);
      selectedId = item.id;
    }
    async function requestText(item) {
      const f = fontByKey(item.fontKey);
      if (!f) throw new Error('Nenhuma fonte disponível.');
      const body = Object.assign({ text: item.text, align: item.align, lineHeight: item.lineHeight, letterSpacing: item.letterSpacing }, fontRequest(f));
      return options.api('/api/laser', { method: 'POST', body: JSON.stringify(body) });
    }
    async function addText() {
      const f = fonts[0];
      const item = { id: uid(), type: 'text', label: DEFAULT_TEXT, text: DEFAULT_TEXT, fontKey: f ? f.v : '', align: 'left', lineHeight: 1.2, letterSpacing: 0, rot: 0, x: 0, y: 0, w: 10 };
      const r = await requestText(item);
      Object.assign(item, { paths: [{ d: r.d, fill: true, rule: 'nonzero', stroke: 0 }], bounds: r.bounds, unit: r.unit || 1000 });
      // tamanho inicial da letra ≈ 9% da altura da área (em mm), limitado pela largura disponível
      const emMm = clamp(state.height * 0.09, 5, 25, 10);
      placeNew(item, r.bounds.w * emMm / item.unit);
      pushItem(item);
      commit();
      const ta = q('[data-text]'); if (ta) { ta.focus(); ta.select(); }
    }
    // Reconverte o texto do elemento mantendo o tamanho da letra e o centro onde estava.
    async function refreshText(item) {
      const job = (textJobs.get(item.id) || 0) + 1;
      textJobs.set(item.id, job);
      const warn = q('[data-textwarn]');
      try {
        const r = await requestText(item);
        if (textJobs.get(item.id) !== job || !state.items.includes(item)) return;
        const emMm = (item.w / item.bounds.w) * item.unit, center = itemCenter(item);
        item.paths = [{ d: r.d, fill: true, rule: 'nonzero', stroke: 0 }];
        item.bounds = r.bounds; item.unit = r.unit || item.unit;
        item.w = Math.max(0.5, +(r.bounds.w * emMm / item.unit).toFixed(3));
        item.x = center.x - item.w / 2; item.y = center.y - itemH(item) / 2;
        item.label = item.text.split('\n')[0].slice(0, 40) || DEFAULT_TEXT;
        if (warn) warn.textContent = '';
        commit();
      } catch (e) {
        if (textJobs.get(item.id) !== job) return;
        if (warn) warn.textContent = e.message;
        setStatus(e.message, 'error');
      }
    }
    const refreshTextSoon = debounce(item => refreshText(item), 380);
    async function addIcon(asset) {
      setStatus('Carregando ícone…');
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error('Não foi possível carregar o ícone.');
      importSvg(await res.text(), asset.nome);
    }
    function importSvg(source, label) {
      const parsed = sanitizeIcon(source);
      const item = { id: uid(), type: 'icon', label: String(label || 'SVG').replace(/\.svg$/i, '').slice(0, 60), paths: parsed.paths, bounds: parsed.bounds, rot: 0, x: 0, y: 0, w: 10 };
      placeNew(item, parsed.mmWidth);
      pushItem(item);
      commit();
      setStatus(parsed.whiteIgnored ? 'Ícone adicionado. As áreas brancas foram ignoradas (branco não grava).' : 'Ícone adicionado.');
    }
    function duplicateItem(item) {
      if (state.items.length >= MAX_ITEMS) throw new Error('Limite de ' + MAX_ITEMS + ' elementos por arte.');
      const copy = JSON.parse(JSON.stringify(item));
      copy.id = uid(); copy.x += 4; copy.y += 4;
      state.items.push(copy); selectedId = copy.id; commit();
    }
    function deleteItem(item) {
      state.items = state.items.filter(i => i !== item);
      if (selectedId === item.id) selectedId = null;
      commit();
    }
    // Move o elemento pra que a caixa visível (já com rotação) fique na posição pedida.
    function moveAabbTo(item, x, y) {
      const box = itemAABB(item);
      if (x !== null) item.x += x - box.x;
      if (y !== null) item.y += y - box.y;
    }

    /* ---- renderização do canvas ---- */
    const pxPerMm = () => { const w = svg.getBoundingClientRect().width; return w > 0 ? w / state.width : 3; };
    function itemNode(item) {
      const g = svgEl('g', { 'data-id': item.id, transform: matrixAttr(itemMatrix(item)), class: 'le-item' });
      g.append(svgEl('rect', { x: item.bounds.x, y: item.bounds.y, width: item.bounds.w, height: item.bounds.h, fill: 'transparent' }));
      item.paths.forEach(p => {
        const attrs = { d: p.d, fill: p.fill ? '#000' : 'none', 'fill-rule': p.rule };
        if (p.stroke) { attrs.stroke = '#000'; attrs['stroke-width'] = p.stroke; }
        g.append(svgEl('path', attrs));
      });
      return g;
    }
    // Tamanho do papel na tela: a maior escala em que a área inteira cabe no espaço livre × o zoom escolhido.
    function fitPaper() {
      const stage = q('[data-stage]');
      const freeW = stage.clientWidth - 48, freeH = stage.clientHeight - 32;
      if (freeW <= 0 || freeH <= 0) return;
      const fit = Math.max(120, Math.min(freeW, freeH * state.width / state.height));
      paper.style.width = Math.round(fit * zoom) + 'px';
    }
    function render() {
      const { width, height } = state;
      fitPaper();
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.style.aspectRatio = width + '/' + height;
      svg.replaceChildren();
      const px = pxPerMm();
      // guias da área: margem e centro (só no editor — nada disso é exportado)
      if (state.margin > 0 && state.margin * 2 < Math.min(width, height)) {
        svg.append(svgEl('rect', { x: state.margin, y: state.margin, width: width - 2 * state.margin, height: height - 2 * state.margin, class: 'le-margin' }));
      }
      svg.append(svgEl('line', { x1: width / 2, y1: 0, x2: width / 2, y2: height, class: 'le-center' }));
      svg.append(svgEl('line', { x1: 0, y1: height / 2, x2: width, y2: height / 2, class: 'le-center' }));
      state.items.forEach(item => svg.append(itemNode(item)));
      // contornos de aviso/erro de cada elemento
      state.items.forEach(item => {
        const issue = itemIssue(state, item);
        if (issue) svg.append(svgEl('polygon', { points: itemCorners(item).map(p => p.x + ',' + p.y).join(' '), class: 'le-issue ' + issue }));
      });
      guides.forEach(g => svg.append(svgEl('line', g.axis === 'x' ? { x1: g.v, y1: 0, x2: g.v, y2: height, class: 'le-snap' } : { x1: 0, y1: g.v, x2: width, y2: g.v, class: 'le-snap' })));
      const item = sel();
      if (item) drawSelection(item, px);
      syncPanels();
    }
    function drawSelection(item, px) {
      const pts = itemCorners(item), hs = 10 / px;
      svg.append(svgEl('polygon', { points: pts.map(p => p.x + ',' + p.y).join(' '), class: 'le-sel', 'pointer-events': 'none', 'stroke-width': 1.5 / px }));
      [['nw', pts[0]], ['ne', pts[1]], ['se', pts[2]], ['sw', pts[3]]].forEach(([name, p]) => {
        svg.append(svgEl('rect', { x: p.x - hs / 2, y: p.y - hs / 2, width: hs, height: hs, class: 'le-handle', 'data-handle': name, 'stroke-width': 1.5 / px }));
      });
      const c = itemCenter(item), top = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dx = top.x - c.x, dy = top.y - c.y, len = Math.hypot(dx, dy) || 1, knob = { x: top.x + dx / len * 22 / px, y: top.y + dy / len * 22 / px };
      svg.append(svgEl('line', { x1: top.x, y1: top.y, x2: knob.x, y2: knob.y, class: 'le-sel', 'pointer-events': 'none', 'stroke-width': 1.5 / px }));
      svg.append(svgEl('circle', { cx: knob.x, cy: knob.y, r: hs * 0.62, class: 'le-handle le-rot', 'data-handle': 'rot', 'stroke-width': 1.5 / px }));
    }

    /* ---- painéis laterais ---- */
    function buildItemsList() {
      const list = q('[data-items]');
      list.replaceChildren();
      state.items.slice().reverse().forEach(item => {
        const li = document.createElement('li');
        li.className = 'le-row-item' + (item.id === selectedId ? ' on' : '');
        const issue = itemIssue(state, item);
        li.innerHTML = '<button type="button" class="le-pick" data-pick="' + esc(item.id) + '">' + iconHtml(item.type === 'text' ? 'type' : 'star') +
          '<span>' + esc(item.label || (item.type === 'text' ? 'Texto' : 'Ícone')) + '</span>' +
          (issue ? '<em class="le-tag ' + issue + '">' + (issue === 'error' ? 'fora da área' : 'fora da margem') + '</em>' : '') + '</button>';
        list.append(li);
      });
      if (!state.items.length) list.innerHTML = '<li class="le-empty">Nada ainda. Adicione um texto ou ícone.</li>';
      q('[data-count]').textContent = state.items.length ? '(' + state.items.length + ')' : '';
    }
    let propsFor; // undefined = ainda não montado
    function buildProps() {
      const item = sel();
      propsFor = item ? item.id + ':' + item.type : null;
      const box = q('[data-props]');
      if (!item) {
        box.innerHTML = '<section><h2>Elemento selecionado</h2><p class="le-hint">Clique num elemento da arte pra editar. Arraste pra mover, use os cantos pra mudar o tamanho e a bolinha de cima pra girar.</p></section>' +
          '<section><h2>Atalhos</h2><ul class="le-keys"><li><kbd>←↑↓→</kbd> move 0,1 mm (<kbd>Shift</kbd> 1 mm)</li><li><kbd>Delete</kbd> exclui</li><li><kbd>Ctrl</kbd>+<kbd>D</kbd> duplica</li><li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz</li><li><kbd>Alt</kbd> ao arrastar: sem encaixe</li></ul></section>';
        return;
      }
      let html = '<section><h2>' + (item.type === 'text' ? 'Texto' : 'Ícone') + '</h2>';
      if (item.type === 'text') {
        html += '<div class="le-field"><label for="le-text">Texto (até 6 linhas)</label><textarea id="le-text" data-text rows="3" maxlength="200"></textarea></div>' +
          '<p class="le-warn" data-textwarn role="alert"></p>' +
          '<div class="le-field"><label for="le-fontq">Fonte</label><input id="le-fontq" data-fontq type="search" placeholder="Buscar fonte…" autocomplete="off"><div class="le-fonts" data-fonts role="listbox" aria-label="Fontes"></div></div>' +
          '<div class="le-field"><label>Alinhamento</label><div class="le-seg" data-align>' +
            ['left:Esquerda', 'center:Centro', 'right:Direita'].map(s => '<button type="button" class="btn small" data-al="' + s.split(':')[0] + '">' + s.split(':')[1] + '</button>').join('') + '</div></div>' +
          '<div class="le-field"><label for="le-lh">Entrelinha <output data-lh-out></output></label><input id="le-lh" data-lh type="range" min="0.8" max="2" step="0.05"></div>' +
          '<div class="le-field"><label for="le-ls">Espaço entre letras <output data-ls-out></output></label><input id="le-ls" data-ls type="range" min="-5" max="60" step="1"></div>';
      } else {
        html += '<p class="le-hint" data-iconname></p>';
      }
      html += '</section><section><h2>Posição e tamanho</h2>' +
        '<div class="le-row"><div class="le-field"><label for="le-x">X (mm)</label><input id="le-x" data-x type="number" step="0.1"></div><div class="le-field"><label for="le-y">Y (mm)</label><input id="le-y" data-y type="number" step="0.1"></div></div>' +
        '<div class="le-row"><div class="le-field"><label for="le-iw">Largura (mm)</label><input id="le-iw" data-iw type="number" min="0.5" step="0.1"></div><div class="le-field"><label for="le-ih">Altura (mm)</label><input id="le-ih" data-ih type="number" min="0.5" step="0.1"></div></div>' +
        '<div class="le-field"><label for="le-rot">Rotação (°)</label><div class="le-row"><input id="le-rot" data-rot type="number" step="1"><button type="button" class="btn small" data-rotstep="-90">−90°</button><button type="button" class="btn small" data-rotstep="90">+90°</button></div></div>' +
        '<div class="le-field"><label>Alinhar na área</label><div class="le-seg">' +
          [['left', 'alignLeft', 'À esquerda'], ['hcenter', 'alignHCenter', 'Centro na horizontal'], ['right', 'alignRight', 'À direita'], ['top', 'alignTop', 'No topo'], ['vcenter', 'alignVCenter', 'Centro na vertical'], ['bottom', 'alignBottom', 'Embaixo']]
            .map(a => '<button type="button" class="btn small icon" data-alignto="' + a[0] + '" title="' + a[2] + '" aria-label="' + a[2] + '">' + iconHtml(a[1]) + '</button>').join('') + '</div></div>' +
        '<div class="le-row"><button type="button" class="btn" data-dup>' + iconHtml('copy') + ' Duplicar</button><button type="button" class="btn danger" data-del>' + iconHtml('trash') + ' Excluir</button></div></section>';
      box.innerHTML = html;
      if (item.type === 'text') { q('[data-text]').value = item.text; buildFontList(); }
      else q('[data-iconname]').textContent = item.label;
    }
    function buildFontList() {
      const item = sel(), list = q('[data-fonts]');
      if (!item || item.type !== 'text' || !list) return;
      const query = normalizeSearch(q('[data-fontq]').value);
      const sample = (item.text.split('\n')[0] || 'Aa').slice(0, 24);
      list.replaceChildren();
      fonts.filter(f => !query || normalizeSearch(f.label).includes(query)).forEach(f => {
        const bad = missingChars(f, item.text);
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'option');
        b.className = 'le-font' + (f.v === item.fontKey ? ' on' : '') + (bad.length ? ' bad' : '');
        b.dataset.font = f.v;
        b.setAttribute('aria-selected', f.v === item.fontKey ? 'true' : 'false');
        b.innerHTML = '<span class="le-fname">' + esc(f.label) + (bad.length ? ' <em>sem ' + esc(bad.slice(0, 4).join(' ')) + '</em>' : '') + '</span>' +
          '<span class="le-fsample" style="font-family:' + esc(f.v) + '">' + esc(sample) + '</span>';
        list.append(b);
      });
      if (!list.children.length) list.innerHTML = '<p class="le-hint">Nenhuma fonte com esse nome.</p>';
    }
    const buildFontListSoon = debounce(buildFontList, 250);
    function setIfIdle(selector, value) {
      const el = q(selector);
      if (el && document.activeElement !== el) el.value = value;
    }
    function syncPanels() {
      const item = sel();
      setIfIdle('[data-width]', state.width); setIfIdle('[data-height]', state.height); setIfIdle('[data-margin]', state.margin);
      setIfIdle('[data-ident]', state.ident); q('[data-material]').value = state.material;
      const presetIndex = (options.presets || []).findIndex(p => Math.abs(p.w - state.width) < 0.01 && Math.abs(p.h - state.height) < 0.01);
      q('[data-preset]').value = presetIndex >= 0 ? String(presetIndex) : '';
      q('[data-sub]').textContent = MATERIALS[state.material] + ' · ' + f3(state.width) + ' × ' + f3(state.height) + ' mm';
      q('[data-dims]').textContent = 'Área: ' + f3(state.width) + ' × ' + f3(state.height) + ' mm' + (state.margin ? ' · margem ' + f3(state.margin) + ' mm' : '');
      q('[data-undo]').disabled = historyIndex <= 0; q('[data-redo]').disabled = historyIndex >= history.length - 1;
      q('[data-zoom-label]').textContent = Math.round(zoom * 100) + '%';
      buildItemsList();
      const key = item ? item.id + ':' + item.type : null;
      if (key !== propsFor) buildProps();
      if (item) {
        const box = itemAABB(item);
        setIfIdle('[data-x]', +box.x.toFixed(2)); setIfIdle('[data-y]', +box.y.toFixed(2));
        setIfIdle('[data-iw]', +item.w.toFixed(2)); setIfIdle('[data-ih]', +itemH(item).toFixed(2)); setIfIdle('[data-rot]', +(item.rot || 0).toFixed(1));
        if (item.type === 'text') {
          if (document.activeElement !== q('[data-text]')) q('[data-text]').value = item.text;
          q('[data-lh]').value = item.lineHeight; q('[data-lh-out]').textContent = item.lineHeight.toFixed(2);
          q('[data-ls]').value = Math.round(item.letterSpacing * 100); q('[data-ls-out]').textContent = Math.round(item.letterSpacing * 100) + '%';
          host.querySelectorAll('[data-al]').forEach(b => b.classList.toggle('on', b.dataset.al === item.align));
          host.querySelectorAll('.le-font').forEach(b => { const on = b.dataset.font === item.fontKey; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        }
      }
    }

    /* ---- seletor de ícones ---- */
    function openIconPicker() {
      const picker = q('[data-picker]');
      const cats = ['Todos'].concat(Array.from(new Set(icons.map(i => i.categoria).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')));
      let cat = 'Todos', query = '';
      picker.hidden = false;
      picker.innerHTML = '<div class="le-picker-box" role="dialog" aria-label="Escolher ícone"><header><strong>Ícones do site</strong><input type="search" data-iq placeholder="Buscar ícone…" autocomplete="off"><button type="button" class="btn ghost" data-pclose aria-label="Fechar">' + iconHtml('x') + '</button></header>' +
        '<div class="le-chips">' + cats.map(c => '<button type="button" class="le-chip' + (c === 'Todos' ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div><div class="le-icon-grid" data-igrid></div></div>';
      const grid = picker.querySelector('[data-igrid]');
      const draw = () => {
        const list = icons.filter(i => (cat === 'Todos' || i.categoria === cat) && (!query || normalizeSearch(i.nome + ' ' + (i.categoria || '')).includes(query)));
        grid.innerHTML = list.length ? list.map(i => '<button type="button" class="le-icon" data-url="' + esc(i.url) + '" title="' + esc(i.nome) + '"><img src="' + esc(i.url) + '" alt="' + esc(i.nome) + '" loading="lazy" width="48" height="48"></button>').join('') : '<p class="le-hint">Nenhum ícone encontrado.</p>';
      };
      const close = () => { picker.hidden = true; picker.replaceChildren(); };
      picker.querySelector('[data-pclose]').onclick = close;
      picker.onclick = async e => {
        if (e.target === picker) return close();
        const chip = e.target.closest('[data-cat]');
        if (chip) { cat = chip.dataset.cat; picker.querySelectorAll('.le-chip').forEach(c => c.classList.toggle('on', c === chip)); return draw(); }
        const btn = e.target.closest('[data-url]');
        if (!btn) return;
        const asset = icons.find(i => i.url === btn.dataset.url);
        close();
        try { await addIcon(asset); } catch (err) { setStatus(err.message, 'error'); }
      };
      picker.querySelector('[data-iq]').oninput = e => { query = normalizeSearch(e.target.value); draw(); };
      draw();
      picker.querySelector('[data-iq]').focus();
    }

    /* ---- encaixe magnético ---- */
    function snapLines() {
      const m = state.margin, xs = [0, state.width / 2, state.width], ys = [0, state.height / 2, state.height];
      if (m > 0) { xs.push(m, state.width - m); ys.push(m, state.height - m); }
      state.items.forEach(o => {
        if (o.id === selectedId) return;
        const b = itemAABB(o);
        xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
      });
      return { xs, ys };
    }
    function snapBox(box, threshold) {
      const { xs, ys } = snapLines(), out = { dx: 0, dy: 0, guides: [] };
      const pick = (edges, lines, axis) => {
        let best = null;
        edges.forEach(e => lines.forEach(l => { const d = l - e; if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l }; }));
        if (best) { out['d' + axis] = best.d; out.guides.push({ axis, v: best.l }); }
      };
      pick([box.x, box.x + box.w / 2, box.x + box.w], xs, 'x');
      pick([box.y, box.y + box.h / 2, box.y + box.h], ys, 'y');
      return out;
    }

    /* ---- mouse / toque no canvas ---- */
    const toMm = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    svg.addEventListener('pointerdown', e => {
      const handle = e.target.closest('[data-handle]'), node = e.target.closest('[data-id]');
      const p = toMm(e);
      if (handle && sel()) {
        const item = sel(), c = itemCenter(item);
        drag = { kind: handle.dataset.handle === 'rot' ? 'rotate' : 'resize', item, c, w0: item.w, diag0: Math.hypot(item.w / 2, itemH(item) / 2) };
      } else if (node) {
        selectedId = node.dataset.id;
        const item = sel(), box = itemAABB(item);
        drag = { kind: 'move', item, start: p, x0: item.x, y0: item.y, box, moved: false };
      } else {
        selectedId = null; render(); return;
      }
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      render();
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = toMm(e), item = drag.item;
      if (drag.kind === 'move') {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * pxPerMm() < 3) return; // evita mexer sem querer num clique
        drag.moved = true;
        guides = [];
        if (!e.altKey) {
          const s = snapBox({ x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }, SNAP_PX / pxPerMm());
          dx += s.dx; dy += s.dy; guides = s.guides;
        }
        item.x = +(drag.x0 + dx).toFixed(3); item.y = +(drag.y0 + dy).toFixed(3);
      } else if (drag.kind === 'resize') {
        const ratio = Math.hypot(p.x - drag.c.x, p.y - drag.c.y) / drag.diag0;
        item.w = Math.max(0.5, +(drag.w0 * ratio).toFixed(3));
        item.x = drag.c.x - item.w / 2; item.y = drag.c.y - itemH(item) / 2;
      } else {
        let deg = Math.atan2(p.y - drag.c.y, p.x - drag.c.x) * 180 / Math.PI + 90;
        if (deg > 180) deg -= 360;
        const nearest = Math.round(deg / 15) * 15;
        if (e.shiftKey || Math.abs(deg - nearest) < 3) deg = nearest;
        item.rot = +deg.toFixed(1);
      }
      render();
    });
    const endDrag = () => { if (!drag) return; const moved = drag.kind !== 'move' || drag.moved; drag = null; guides = []; if (moved) commit(); else render(); };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    /* ---- teclado ---- */
    listen(document, 'keydown', e => {
      if (!document.body.contains(host) || !q('[data-picker]').hidden) { if (e.key === 'Escape' && !q('[data-picker]').hidden) { q('[data-picker]').hidden = true; q('[data-picker]').replaceChildren(); } return; }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) { if (historyIndex < history.length - 1) restore(historyIndex + 1); } else if (historyIndex > 0) restore(historyIndex - 1); return; }
      if (mod && key === 'y' && !typing) { e.preventDefault(); if (historyIndex < history.length - 1) restore(historyIndex + 1); return; }
      const item = sel();
      if (typing || !item) return;
      if (mod && key === 'd') { e.preventDefault(); try { duplicateItem(item); } catch (err) { setStatus(err.message, 'error'); } return; }
      if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteItem(item); return; }
      if (key === 'escape') { selectedId = null; render(); return; }
      const step = e.shiftKey ? 1 : 0.1, arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
      if (arrows) { e.preventDefault(); item.x = +(item.x + arrows[0]).toFixed(3); item.y = +(item.y + arrows[1]).toFixed(3); render(); commitSoon(); }
    });

    /* ---- controles ---- */
    const busy = async (button, job) => {
      if (button) button.disabled = true;
      try { await job(); } catch (err) { setStatus(err.message, 'error'); } finally { if (button) button.disabled = false; }
    };
    host.addEventListener('click', async e => {
      const t = e.target;
      const btn = name => t.closest('[' + name + ']');
      if (btn('data-close')) {
        commitSoon.cancel(); save(); abort.abort(); host.remove();
        if (options.onClose) options.onClose();
        return;
      }
      if (btn('data-undo')) { if (historyIndex > 0) restore(historyIndex - 1); return; }
      if (btn('data-redo')) { if (historyIndex < history.length - 1) restore(historyIndex + 1); return; }
      if (btn('data-add-text')) return busy(btn('data-add-text'), async () => { setStatus('Preparando texto…'); await addText(); setStatus(''); });
      if (btn('data-add-icon')) return openIconPicker();
      if (btn('data-export')) return busy(btn('data-export'), exportSvg);
      if (btn('data-png')) return busy(btn('data-png'), exportPng);
      if (btn('data-clear')) {
        if (!state.items.length) return;
        if (await confirmAsk('Remover todos os elementos desta arte? Dá pra desfazer logo em seguida.', { title: 'Limpar arte', confirmLabel: 'Limpar', danger: true })) { state.items = []; selectedId = null; commit(); }
        return;
      }
      const pick = btn('data-pick');
      if (pick) { selectedId = pick.dataset.pick; render(); return; }
      const z = btn('data-zoom');
      if (z) { zoom = z.dataset.zoom === '+' ? Math.min(4, zoom * 1.25) : z.dataset.zoom === '-' ? Math.max(0.25, zoom / 1.25) : 1; applyZoom(); return; }
      const item = sel();
      if (!item) return;
      const font = btn('data-font') || t.closest('.le-font');
      if (font && item.type === 'text') { item.fontKey = font.dataset.font; render(); refreshText(item); return; }
      const al = btn('data-al');
      if (al && item.type === 'text') { item.align = al.dataset.al; render(); refreshText(item); return; }
      const rs = btn('data-rotstep');
      if (rs) { const c = itemAABB(item); item.rot = +(((item.rot || 0) + +rs.dataset.rotstep + 540) % 360 - 180).toFixed(1); const box = itemAABB(item); item.x += (c.x + c.w / 2) - (box.x + box.w / 2); item.y += (c.y + c.h / 2) - (box.y + box.h / 2); commit(); return; }
      const to = btn('data-alignto');
      if (to) {
        const m = state.margin, box = itemAABB(item), a = to.dataset.alignto;
        if (a === 'left') moveAabbTo(item, m, null); else if (a === 'right') moveAabbTo(item, state.width - m - box.w, null);
        else if (a === 'hcenter') moveAabbTo(item, (state.width - box.w) / 2, null);
        else if (a === 'top') moveAabbTo(item, null, m); else if (a === 'bottom') moveAabbTo(item, null, state.height - m - box.h);
        else moveAabbTo(item, null, (state.height - box.h) / 2);
        commit(); return;
      }
      if (btn('data-dup')) { try { duplicateItem(item); } catch (err) { setStatus(err.message, 'error'); } return; }
      if (btn('data-del')) deleteItem(item);
    });
    host.addEventListener('input', e => {
      const t = e.target, item = sel();
      if (t.matches('[data-fontq]')) { buildFontList(); return; }
      if (t.matches('[data-text]') && item) {
        item.text = t.value; item.label = t.value.split('\n')[0].slice(0, 40) || DEFAULT_TEXT;
        buildItemsList(); buildFontListSoon();
        if (t.value.trim()) refreshTextSoon(item);
        return;
      }
      if (t.matches('[data-lh]') && item) { item.lineHeight = +t.value; q('[data-lh-out]').textContent = item.lineHeight.toFixed(2); refreshTextSoon(item); return; }
      if (t.matches('[data-ls]') && item) { item.letterSpacing = +t.value / 100; q('[data-ls-out]').textContent = t.value + '%'; refreshTextSoon(item); }
    });
    host.addEventListener('change', e => {
      const t = e.target, item = sel();
      if (t.matches('[data-preset]')) {
        if (t.value === '') return; // "Personalizada": mantém as medidas digitadas
        const p = (options.presets || [])[+t.value];
        if (p) { state.width = p.w; state.height = p.h; commit(); }
        return;
      }
      for (const field of ['width', 'height']) {
        if (t.matches('[data-' + field + ']')) {
          const v = +t.value;
          if (v >= 10 && v <= 1000) { state[field] = v; commit(); } else { setStatus('Use medidas entre 10 e 1000 mm.', 'error'); render(); }
          return;
        }
      }
      if (t.matches('[data-margin]')) { state.margin = clamp(t.value, 0, 100, 0); commit(); return; }
      if (t.matches('[data-material]')) { state.material = t.value === 'tecido' ? 'tecido' : 'courino'; commit(); return; }
      if (t.matches('[data-ident]')) { state.ident = t.value.slice(0, 60); commit(); return; }
      if (t.matches('[data-upload]')) {
        const file = t.files[0]; t.value = '';
        if (!file) return;
        busy(null, async () => {
          if (file.size > 2 * 1024 * 1024) throw new Error('O SVG deve ter até 2 MB.');
          importSvg(await file.text(), file.name);
        });
        return;
      }
      if (!item) return;
      const v = +t.value;
      if (t.matches('[data-x]') && Number.isFinite(v)) { moveAabbTo(item, v, null); commit(); }
      else if (t.matches('[data-y]') && Number.isFinite(v)) { moveAabbTo(item, null, v); commit(); }
      else if (t.matches('[data-iw]') && v > 0) { const c = itemCenter(item); item.w = Math.max(0.5, v); item.x = c.x - item.w / 2; item.y = c.y - itemH(item) / 2; commit(); }
      else if (t.matches('[data-ih]') && v > 0) { const c = itemCenter(item); item.w = Math.max(0.5, v * item.bounds.w / item.bounds.h); item.x = c.x - item.w / 2; item.y = c.y - itemH(item) / 2; commit(); }
      else if (t.matches('[data-rot]') && Number.isFinite(v)) { const c = itemCenter(item); item.rot = ((v + 180) % 360 + 360) % 360 - 180; item.x = c.x - item.w / 2; item.y = c.y - itemH(item) / 2; commit(); }
    });
    q('[data-upload-label]').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); q('[data-upload]').click(); } });
    const applyZoom = () => render();

    /* ---- exportação ---- */
    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    function checkBeforeExport() {
      if (!state.items.length) throw new Error('Adicione pelo menos um texto ou ícone.');
      const out = state.items.filter(i => itemIssue(state, i) === 'error');
      if (out.length) { selectedId = out[0].id; render(); throw new Error('Há ' + out.length + ' elemento(s) fora da área de gravação (contorno vermelho). Reposicione antes de exportar.'); }
    }
    async function exportSvg() {
      await options.api('/api/laser'); // confirma que a conta ainda tem o produto liberado
      checkBeforeExport();
      downloadBlob(new Blob([buildSvg(state)], { type: 'image/svg+xml' }), exportName(state));
      const warn = state.items.filter(i => itemIssue(state, i) === 'warn').length;
      setStatus('SVG exportado em milímetros, só com curvas.' + (warn ? ' Atenção: ' + warn + ' elemento(s) ficaram fora da margem.' : ''), warn ? 'warn' : 'ok');
      toast('SVG exportado.', 'success');
    }
    async function exportPng() {
      checkBeforeExport();
      const pxPerMmOut = Math.min(300 / 25.4, 6000 / Math.max(state.width, state.height)); // até 300 DPI, limitado a 6000 px
      const w = Math.round(state.width * pxPerMmOut), h = Math.round(state.height * pxPerMmOut);
      const url = URL.createObjectURL(new Blob([buildSvg(state)], { type: 'image/svg+xml' }));
      try {
        const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Não foi possível gerar a prévia.')); im.src = url; });
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const c = canvas.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
        c.drawImage(img, 0, 0, w, h);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        downloadBlob(blob, exportName(state).replace(/\.svg$/, '-previa.png'));
        setStatus('Prévia PNG baixada (arte preta sobre fundo branco).', 'ok');
      } finally { URL.revokeObjectURL(url); }
    }

    // arrancada
    commit();
    if (!fonts.length) setStatus('Nenhuma fonte carregada ainda — tente de novo em instantes.', 'warn');
    new ResizeObserver(() => { if (document.body.contains(host) && !drag) render(); }).observe(q('[data-stage]'));
  }

  return { open, hasDraft, sanitizeIcon, buildSvg, itemAABB, itemIssue, cleanState, parsePathData };
})();
