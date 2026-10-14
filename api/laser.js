const crypto = require('crypto');
const { getSupabase, requireAuth, allowedProducts, readJsonBody } = require('./_auth');
const fontkit = require('fontkit');

// Fontes do catálogo embutido do editor (as mesmas de FONTS em index.html).
const FAMILIES = ['IBM Plex Sans', 'IBM Plex Serif', 'Playfair Display', 'Cormorant Garamond', 'Bebas Neue', 'Caveat'];
const MAX_CHARS = 200;
const MAX_LINES = 6;
const MAX_FONT_BYTES = 4 * 1024 * 1024;
// Os ids dos ativos são UUIDs, mas o navegador registra a fonte como "Site_<uuid com _ no lugar de ->".
const UUID_RE = /^[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}$/i;

// Fontes já interpretadas ficam na memória da instância: digitar um texto dispara várias conversões
// seguidas com a mesma fonte, e baixar+interpretar 1–4 MB a cada tecla deixaria o editor lento.
const fontCache = new Map();
function remember(key, font) {
  fontCache.set(key, font);
  if (fontCache.size > 8) fontCache.delete(fontCache.keys().next().value);
  return font;
}

async function download(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Não foi possível carregar a fonte.');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_FONT_BYTES) throw new Error('Fonte muito grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseFont(buffer) {
  let font;
  try { font = fontkit.create(buffer); }
  catch (e) { throw new Error('O arquivo dessa fonte está corrompido ou não é uma fonte válida.'); }
  if (font.fonts) font = font.fonts[0]; // arquivo .ttc/.otc: usa a primeira fonte da coleção
  if (!font || !font.layout) throw new Error('Formato de fonte não suportado.');
  return font;
}

async function loadFont(db, body) {
  if (body.fontId) {
    if (typeof body.fontId !== 'string' || !UUID_RE.test(body.fontId)) throw new Error('Fonte não encontrada.');
    const id = body.fontId.replace(/_/g, '-').toLowerCase();
    const key = 'id:' + id;
    if (fontCache.has(key)) return fontCache.get(key);
    const { data } = await db.from('ativos_padrao').select('url').eq('id', id).eq('tipo', 'fonte').maybeSingle();
    if (!data) throw new Error('Fonte não encontrada.');
    const url = new URL(data.url), origin = new URL(process.env.SUPABASE_URL).origin;
    if (url.origin !== origin || !url.pathname.startsWith('/storage/v1/object/public/site-assets/')) throw new Error('Origem da fonte inválida.');
    return remember(key, parseFont(await download(url.href)));
  }
  if (body.fontData) {
    if (typeof body.fontData !== 'string' || body.fontData.length > 3600000 || !/^data:[^,]*;base64,[A-Za-z0-9+/=]+$/.test(body.fontData)) throw new Error('Arquivo de fonte inválido.');
    const buffer = Buffer.from(body.fontData.split(',')[1], 'base64');
    const key = 'data:' + crypto.createHash('sha1').update(buffer).digest('hex');
    if (fontCache.has(key)) return fontCache.get(key);
    return remember(key, parseFont(buffer));
  }
  if (!FAMILIES.includes(body.family)) throw new Error('Escolha uma fonte do catálogo.');
  const key = 'google:' + body.family;
  if (fontCache.has(key)) return fontCache.get(key);
  const css = (await download('https://fonts.googleapis.com/css?family=' + encodeURIComponent(body.family))).toString();
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) throw new Error('Fonte indisponível.');
  const url = new URL(match[1]);
  if (url.hostname !== 'fonts.gstatic.com') throw new Error('Origem inválida.');
  return remember(key, parseFont(await download(url.href)));
}

const clamp = (v, min, max, fallback) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : fallback);
const num = (n) => String(+n.toFixed(2));

function pathData(commands, tx, ty) {
  // Fonte tem o eixo Y pra cima; o SVG tem Y pra baixo. Aplica o espelhamento e o deslocamento
  // direto nas coordenadas, assim o arquivo final não depende de transform nenhum nos glifos.
  const pt = (x, y) => num(x + tx) + ' ' + num(ty - y);
  let d = '';
  for (const c of commands) {
    const a = c.args;
    if (c.command === 'moveTo') d += 'M' + pt(a[0], a[1]);
    else if (c.command === 'lineTo') d += 'L' + pt(a[0], a[1]);
    else if (c.command === 'quadraticCurveTo') d += 'Q' + pt(a[0], a[1]) + ' ' + pt(a[2], a[3]);
    else if (c.command === 'bezierCurveTo') d += 'C' + pt(a[0], a[1]) + ' ' + pt(a[2], a[3]) + ' ' + pt(a[4], a[5]);
    else if (c.command === 'closePath') d += 'Z';
  }
  return d;
}

// Converte um texto (até MAX_LINES linhas) em contornos vetoriais. Devolve um único "d" em unidades
// da fonte, Y pra baixo, mais a caixa real da tinta (bounds) — o editor escala isso pra milímetros.
function outline(source, text, options = {}) {
  const font = Buffer.isBuffer(source) ? parseFont(source) : source;
  if (typeof text !== 'string') throw new Error('Digite um texto visível.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('O texto tem caracteres inválidos.');
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  if (!lines.length) throw new Error('Digite um texto visível.');
  if (lines.length > MAX_LINES) throw new Error('Use até ' + MAX_LINES + ' linhas.');

  const missing = new Set();
  for (const ch of text.replace(/\s/g, '')) if (!font.hasGlyphForCodePoint(ch.codePointAt(0))) missing.add(ch);
  if (missing.size) {
    const err = new Error('Esta fonte não tem o(s) caractere(s): ' + [...missing].join(' ') + '. Escolha outra fonte ou troque o texto.');
    err.missing = [...missing];
    throw err;
  }

  const unit = font.unitsPerEm || 1000;
  const spacing = clamp(options.letterSpacing, -0.2, 1, 0) * unit;
  const lineStep = unit * clamp(options.lineHeight, 0.6, 3, 1.2);
  const align = ['left', 'center', 'right'].includes(options.align) ? options.align : 'left';

  const built = lines.map((line, li) => {
    const glyphs = [];
    let x = 0, y = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    if (line) {
      const run = font.layout(line);
      run.glyphs.forEach((glyph, i) => {
        const pos = run.positions[i], gx = x + pos.xOffset, gy = y + pos.yOffset;
        const commands = glyph.path.commands;
        if (commands.length) {
          const b = glyph.bbox;
          minX = Math.min(minX, gx + b.minX); maxX = Math.max(maxX, gx + b.maxX);
          minY = Math.min(minY, li * lineStep - gy - b.maxY); maxY = Math.max(maxY, li * lineStep - gy - b.minY);
          glyphs.push({ commands, gx, gy });
        }
        x += pos.xAdvance + spacing; y += pos.yAdvance;
      });
    }
    return { glyphs, minX, maxX, minY, maxY, baseline: li * lineStep };
  });

  const inkW = Math.max(...built.map(l => (l.glyphs.length ? l.maxX - l.minX : 0)));
  let d = '', bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const l of built) {
    if (!l.glyphs.length) continue;
    const lineW = l.maxX - l.minX;
    const shift = (align === 'left' ? 0 : align === 'center' ? (inkW - lineW) / 2 : inkW - lineW) - l.minX;
    for (const g of l.glyphs) d += pathData(g.commands, g.gx + shift, l.baseline - g.gy);
    bx0 = Math.min(bx0, l.minX + shift); bx1 = Math.max(bx1, l.maxX + shift);
    by0 = Math.min(by0, l.minY); by1 = Math.max(by1, l.maxY);
  }
  if (!d || bx1 <= bx0 || by1 <= by0) throw new Error('Digite um texto visível.');
  return { d, unit, bounds: { x: +bx0.toFixed(2), y: +by0.toFixed(2), w: +(bx1 - bx0).toFixed(2), h: +(by1 - by0).toFixed(2) } };
}

module.exports = async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const db = getSupabase();
  if (!(await allowedProducts(db, session)).includes('laser')) return res.status(403).json({ error: 'Gravação a laser não liberada para esta conta.' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const body = await readJsonBody(req);
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_CHARS) throw new Error('Use um texto de até ' + MAX_CHARS + ' caracteres.');
    const font = await loadFont(db, body);
    res.status(200).json(outline(font, body.text, body));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Não foi possível converter o texto.', missing: error.missing });
  }
};
module.exports.outline = outline;
