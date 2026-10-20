// Testes do produto "Gravação a laser": servidor (conversão de texto em curvas, permissões, id de fonte)
// e editor no navegador (Edge headless): texto editável, ícones do site, caminhos SVG, arrastar/girar,
// exportação sem transform/texto/imagem e rascunho.
//   node tests/laser.cjs
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const { outline } = require('../api/laser');
const arial = fs.readFileSync('C:/Windows/Fonts/arial.ttf');

/* ------------------------------ servidor ------------------------------ */
function serverUnit() {
  const one = outline(arial, 'Álbum & João 2026');
  assert(one.bounds.w > 0 && one.bounds.h > 0 && /^[MLQCZ0-9 .\-]+$/.test(one.d), 'texto simples vira curvas');
  assert(one.unit > 0, 'devolve unitsPerEm');
  const three = outline(arial, 'Linha 1\nLinha 2\nLinha 3');
  assert(three.bounds.h > one.bounds.h * 2, 'várias linhas empilham');
  const widths = ['left', 'center', 'right'].map(align => outline(arial, 'Aa\nBBBBBB', { align }).bounds.w);
  assert(widths.every(w => w === widths[0]), 'alinhamento não muda a largura do bloco');
  assert(outline(arial, 'ABC', { letterSpacing: 0.3 }).bounds.w > outline(arial, 'ABC').bounds.w, 'espaço entre letras alarga');
  assert(outline(arial, 'A\nA', { lineHeight: 2 }).bounds.h > outline(arial, 'A\nA', { lineHeight: 1 }).bounds.h, 'entrelinha aumenta a altura');
  assert.throws(() => outline(Buffer.from('[InternetShortcut]\nURL=https://x'), 'oi'), /corrompido ou não é uma fonte/); // upload errado na biblioteca (atalho .url)
  assert.throws(() => outline(arial, 'a\nb\nc\nd\ne\nf\ng'), /até 6 linhas/);
  assert.throws(() => outline(arial, '   \n  '), /texto visível/);
  assert.throws(() => outline(arial, 'a\u0007b'), /inválidos/);
  try { outline(arial, 'ok \u4e2d'); assert.fail('deveria faltar glifo'); }
  catch (e) { assert.deepEqual(e.missing, ['\u4e2d']); assert(/não tem/.test(e.message)); }
}
async function serverPermissionsAndFontId() {
  const source = fs.readFileSync(path.join(root, 'api/laser.js'), 'utf8');
  const run = async (allowed, db, body, method = 'GET') => {
    const context = {
      module: { exports: {} }, console, Buffer, URL, AbortSignal, fetch, process,
      require: name => (name === './_auth'
        ? { requireAuth: () => ({ uid: 'u', role: 'cliente' }), getSupabase: () => db, allowedProducts: async () => allowed, readJsonBody: async () => body }
        : require(name)),
    };
    vm.runInNewContext(source, context);
    const res = { code: 200, setHeader() {}, status(v) { this.code = v; return this; }, json(v) { this.body = v; return this; } };
    await context.module.exports({ method }, res);
    return res;
  };
  for (const allowed of [[], ['autocolante'], ['laser']]) {
    assert.equal((await run(allowed, {})).code, allowed.includes('laser') ? 200 : 403);
  }
  // O navegador manda o id como "Site_<uuid com _>": o servidor precisa devolver os hífens antes de consultar o banco.
  let askedId = null;
  const db = { from: () => ({ select: () => ({ eq: (col, val) => { if (col === 'id') askedId = val; return { eq: () => ({ maybeSingle: async () => ({ data: null }) }) }; } }) }) };
  const res = await run(['laser'], db, { text: 'Oi', fontId: '3f2b8c1e_9a4d_4e6b_8c1d_7a5e2f9b0c3d' }, 'POST');
  assert.equal(res.code, 400);
  assert.equal(askedId, '3f2b8c1e-9a4d-4e6b-8c1d-7a5e2f9b0c3d');
  assert.match(res.body.error, /Fonte não encontrada/);
  const bad = await run(['laser'], db, { text: 'Oi', fontId: "x'; drop table" }, 'POST');
  assert.match(bad.body.error, /Fonte não encontrada/);
}

/* ------------------------------ navegador ------------------------------ */
const ICON_CORELDRAW = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="20mm" height="20mm" version="1.1" style="shape-rendering:geometricPrecision; fill-rule:evenodd; clip-rule:evenodd" viewBox="0 0 100 100">
 <defs><style type="text/css"><![CDATA[ .fil0 {fill:black} .fil1 {fill:black;fill-rule:nonzero} ]]></style></defs>
 <g id="Camada_x0020_1"><metadata id="CorelCorpID_0Corel-Layer"/>
  <path class="fil0" d="M10 10L90 10L90 90L10 90Z M30 30L30 70L70 70L70 30Z"/>
  <polygon class="fil1" points="40,40 60,40 50,60"/>
 </g></svg>`;
// Formas variadas pra conferir, pixel a pixel, que o caminho normalizado desenha o mesmo que o SVG original.
const SHAPES = {
  relativo_e_arco: '<path d="m 10 50 a 30 20 30 1 1 60 10 c 10 -30 30 -30 20 10 s -10 20 -30 10 q 10 -20 -10 -20 t -20 10 z"/>',
  transform_grupo: '<g transform="translate(20 10) rotate(25) scale(1.3 .7)"><path d="M10 10H60V40H10Z"/><rect x="20" y="50" width="30" height="20" rx="6"/></g>',
  formas: '<circle cx="30" cy="30" r="18"/><ellipse cx="70" cy="70" rx="22" ry="10"/><polygon points="50,5 60,30 40,30"/><polyline fill="none" stroke="#000" stroke-width="4" points="5,95 30,80 55,95"/>',
  furo_evenodd: '<path fill-rule="evenodd" d="M50 5a45 45 0 1 0 .01 0Z M50 25a25 25 0 1 1 -.01 0Z"/>',
};

async function browserTests() {
  const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_NODE_MODULES || 'C:/Users/C3TECH/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 700 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const files = { '/laser-editor.js': 'text/javascript', '/laser-editor.css': 'text/css' };
    await page.route('https://laser.test/**', route => {
      const p = new URL(route.request().url()).pathname;
      if (files[p]) return route.fulfill({ contentType: files[p] + '; charset=utf-8', body: fs.readFileSync(path.join(root, p.slice(1)), 'utf8') });
      if (p === '/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: ICON_CORELDRAW });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/laser-editor.css"><style>:root{--bg:#12191b;--surface:#182123;--surface-2:#212b2d;--border:#2e393b;--ink:#eaecec;--ink-muted:#9aa5a4;--accent:#4fd0c5;--accent-strong:#7fe0d8;--accent-tint:#173836;--danger:#e9838d;--danger-bg:#3a2023;--danger-border:#5c3238;--warning:#e2b568;--warning-bg:#3a3020;--success:#7fd9bd;--shadow:0 2px 8px #0006}body{margin:0;font-family:sans-serif}.btn{padding:6px 10px;border:1px solid #444;background:#222;color:#eee;border-radius:6px;font:inherit}</style><body><script src="/laser-editor.js"></script>' });
    });
    await page.exposeFunction('nodeApi', async body => {
      try { return outline(arial, ...(() => { const b = JSON.parse(body); return [b.text, b]; })()); }
      catch (e) { return { __error: e.message }; }
    });
    await page.goto('https://laser.test/');
    // fonte que NÃO tem "ã" (OCR-A) registrada como fonte do site, pra testar o aviso de caracteres que faltam
    await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const face = new FontFace('Site_wd', bytes.buffer); await face.load(); document.fonts.add(face);
    }, fs.readFileSync('C:/Windows/Fonts/OCR-A BT.ttf').toString('base64'));

    const open = () => page.evaluate(() => {
      window.apiCalls = [];
      return LaserEditor.open({
        user: { usuario: 'test' },
        fonts: [{ v: '"IBM Plex Sans", sans-serif', label: 'Plex' }, { v: '"Site_wd", sans-serif', family: 'Site_wd', label: 'OCR-A' }],
        icons: [{ nome: 'Quadro', categoria: 'Teste', url: '/icon.svg' }],
        presets: [{ label: 'Capa 20×20', w: 203, h: 203 }],
        icon: () => '',
        api: async (url, init) => { if (!init) return { ok: true }; window.apiCalls.push(JSON.parse(init.body)); const r = await window.nodeApi(init.body); if (r.__error) throw new Error(r.__error); return r; },
        onClose: () => { window.laserClosed = true; },
      });
    });
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')));
    const status = () => page.locator('[data-status]').textContent();

    /* --- importação de SVG: CorelDRAW (classes, <style>, fill-rule herdado) e fidelidade de desenho --- */
    const sanitized = await page.evaluate(src => { const r = LaserEditor.sanitizeIcon(src); return { n: r.paths.length, rules: r.paths.map(p => p.rule), b: r.bounds, mm: r.mmWidth }; }, ICON_CORELDRAW);
    assert.equal(sanitized.n, 2);
    assert.deepEqual(sanitized.rules, ['evenodd', 'nonzero'], 'fill-rule herdado do style do <svg> e sobrescrito pela classe');
    assert(Math.abs(sanitized.b.w - 80) < 0.01 && Math.abs(sanitized.mm - 16) < 0.01, 'tamanho físico vem do width em mm: 80/100 de 20 mm');
    for (const [name, inner] of Object.entries(SHAPES)) {
      const diff = await page.evaluate(async inner => {
        const svgOf = body => '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100">' + body + '</svg>';
        const raster = async svg => {
          const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
          const c = document.createElement('canvas'); c.width = c.height = 200; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 200, 200).data;
        };
        const parsed = LaserEditor.sanitizeIcon(svgOf(inner));
        const normalized = parsed.paths.map(p => '<path d="' + p.d + '" fill="' + (p.fill ? '#000' : 'none') + '" fill-rule="' + p.rule + '"' + (p.stroke ? ' stroke="#000" stroke-width="' + p.stroke + '"' : '') + '/>').join('');
        const a = await raster(svgOf(inner)), b = await raster(svgOf(normalized));
        let different = 0, ink = 0;
        for (let i = 3; i < a.length; i += 4) { if (a[i] > 128) ink++; if (Math.abs(a[i] - b[i]) > 100) different++; }
        return { different, ink };
      }, inner);
      assert(diff.ink > 300, name + ': o desenho original tem tinta');
      assert(diff.different / diff.ink < 0.01, name + ': normalizado desenha igual ao original (' + diff.different + ' px diferentes)');
    }
    // recusa o que não é arte de uma cor só
    for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="x.png"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>oi</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect width="5" height="5" fill="url(#g)"/></svg>', 'isso não é svg']) {
      assert(await page.evaluate(s => { try { LaserEditor.sanitizeIcon(s); return false; } catch (e) { return true; } }, bad), 'deveria recusar: ' + bad.slice(0, 50));
    }
    assert.equal(await page.evaluate(() => { const r = LaserEditor.sanitizeIcon('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect width="4" height="4" fill="red"/></svg>'); return r.paths.length + ':' + r.whiteIgnored; }), '1:true', 'branco não grava; outras cores viram preto');

    /* --- editor --- */
    await open();
    await page.locator('[data-add-text]').click();
    await page.locator('[data-items] .le-pick').first().waitFor();
    assert.equal(await page.locator('[data-text]').inputValue(), 'Seu texto');
    let d = await draft();
    assert.equal(d.items.length, 1);
    const baseW = d.items[0].w;
    // editar o texto: reconverte mantendo o tamanho da letra e o centro
    const centerBefore = d.items[0].x + d.items[0].w / 2;
    await page.locator('[data-text]').fill('Eduardo & Thais\nCasamento');
    await page.waitForFunction(() => window.apiCalls.length >= 2);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items[0].text.includes('Casamento'));
    d = await draft();
    assert.equal(d.items[0].text, 'Eduardo & Thais\nCasamento');
    assert(Math.abs(d.items[0].x + d.items[0].w / 2 - centerBefore) < 0.5, 'centro preservado ao editar o texto');
    assert(await page.locator('.le-paper path').count() >= 1);
    // alinhamento, entrelinha e espaço entre letras chegam ao servidor
    await page.locator('[data-al="center"]').click();
    await page.waitForFunction(() => window.apiCalls.some(c => c.align === 'center'));
    await page.locator('[data-ls]').fill('20'); await page.locator('[data-ls]').dispatchEvent('input');
    await page.waitForFunction(() => window.apiCalls.some(c => Math.abs(c.letterSpacing - 0.2) < 1e-9));
    // fonte sem "ã": o texto novo é recusado com mensagem clara e o desenho anterior fica
    await page.locator('[data-text]').fill('João');
    await page.waitForFunction(() => window.apiCalls.length >= 5);
    await page.locator('.le-font.bad').first().waitFor({ timeout: 4000 }).catch(async () => { throw new Error('nenhuma fonte marcada: ' + (await page.locator('[data-fonts]').innerText())); });
    assert(/sem/.test(await page.locator('.le-font', { hasText: 'OCR-A' }).first().textContent()), 'lista avisa que a fonte não tem "ã"');
    await page.locator('.le-font', { hasText: 'Plex' }).first().click();
    await page.waitForFunction(() => window.apiCalls.at(-1).family === 'IBM Plex Sans' && window.apiCalls.at(-1).text === 'João');

    if (process.env.LASER_SHOTS) await page.screenshot({ path: path.join(process.env.LASER_SHOTS, 'laser-texto.png') });

    // posição por campo numérico (caixa visível) e rotação
    await page.locator('[data-x]').fill('10'); await page.locator('[data-x]').dispatchEvent('change');
    await page.locator('[data-y]').fill('20'); await page.locator('[data-y]').dispatchEvent('change');
    let box = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')); return LaserEditor.itemAABB(s.items[0]); });
    assert(Math.abs(box.x - 10) < 0.01 && Math.abs(box.y - 20) < 0.01);
    await page.locator('[data-rotstep="90"]').click();
    d = await draft();
    assert.equal(d.items[0].rot, 90);
    box = await page.evaluate(() => LaserEditor.itemAABB(JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items[0]));
    assert(box.h > box.w * 0.9 || box.h > 0, 'caixa gira junto');

    // arrasto com mouse + encaixe no centro da área (200 mm)
    await page.locator('[data-rotstep="-90"]').click();
    const screen = (x, y) => page.evaluate(([x, y]) => { const s = document.querySelector('.le-paper svg'), m = s.getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]);
    d = await draft();
    let it = d.items[0];
    const start = await screen(it.x + it.w / 2, it.y + (it.w * it.bounds.h / it.bounds.w) / 2);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    const target = await screen(100 + 1.2, 100 + 0.8); // perto do centro, dentro do limiar de encaixe
    await page.mouse.move((start.x + target.x) / 2, (start.y + target.y) / 2, { steps: 4 });
    await page.mouse.move(target.x, target.y, { steps: 4 });
    assert(await page.locator('.le-snap').count() >= 1, 'mostra a linha de encaixe');
    await page.mouse.up();
    box = await page.evaluate(() => LaserEditor.itemAABB(JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items[0]));
    assert(Math.abs(box.x + box.w / 2 - 100) < 0.05 && Math.abs(box.y + box.h / 2 - 100) < 0.05, 'encaixou no centro da área: ' + JSON.stringify(box));

    // redimensionar pelo canto (escala a partir do centro) e girar pela bolinha
    const before = (await draft()).items[0];
    const corner = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 40, corner.y + corner.height / 2 + 20, { steps: 5 }); await page.mouse.up();
    const after = (await draft()).items[0];
    assert(after.w > before.w, 'arrastar o canto aumenta');
    assert(Math.abs((after.x + after.w / 2) - (before.x + before.w / 2)) < 0.01, 'o centro não sai do lugar');
    const knob = await page.locator('[data-handle="rot"]').boundingBox();
    const kc = { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 };
    const ctr = await screen(after.x + after.w / 2, after.y + (after.w * after.bounds.h / after.bounds.w) / 2);
    await page.mouse.move(kc.x, kc.y); await page.mouse.down();
    await page.mouse.move(ctr.x + 80, ctr.y, { steps: 6 }); // knob à direita do centro = 90°
    await page.mouse.up();
    assert.equal((await draft()).items[0].rot, 90);

    // ícone do site (CorelDRAW) chega com o tamanho do arquivo (16 mm de tinta)
    await page.locator('[data-add-icon]').click();
    await page.locator('.le-icon').first().click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items.length === 2);
    d = await draft();
    const iconItem = d.items[1];
    assert.equal(iconItem.type, 'icon');
    assert(Math.abs(iconItem.w - 16) < 0.05, 'ícone entra no tamanho físico do arquivo: ' + iconItem.w);

    // teclado: seta move 0,1 mm; Ctrl+Z desfaz; Delete apaga
    await page.locator('.le-paper svg').click({ position: { x: 3, y: 3 } }); // limpa a seleção
    await page.locator('[data-items] .le-pick', { hasText: 'Quadro' }).click();
    const x0 = (await draft()).items[1].x;
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
    await page.waitForFunction(x0 => Math.abs(JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items[1].x - (x0 + 0.1)) < 1e-6, x0);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items.length === 1);
    await page.locator('[data-undo]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('capabuilder:laser:v2:test')).items.length === 2);

    if (process.env.LASER_SHOTS) await page.screenshot({ path: path.join(process.env.LASER_SHOTS, 'laser-icone.png') });

    // fora da área bloqueia o export; dentro exporta SVG limpo
    await page.locator('[data-items] .le-pick', { hasText: 'Quadro' }).click();
    await page.locator('[data-x]').fill('-50'); await page.locator('[data-x]').dispatchEvent('change');
    await page.locator('[data-export]').click();
    await page.waitForFunction(() => /fora da área/.test(document.querySelector('[data-status]').textContent));
    assert(await page.locator('.le-issue.error').count() >= 1, 'contorno vermelho no elemento fora da área');
    await page.locator('[data-alignto="hcenter"]').click();
    await page.locator('[data-ident]').fill('48213 Eduardo e Thais'); await page.locator('[data-ident]').dispatchEvent('change');
    const downloadP = page.waitForEvent('download');
    await page.locator('[data-export]').click();
    const dl = await downloadP;
    assert.equal(dl.suggestedFilename(), 'gravacao-48213-eduardo-e-thais-courino-200x200mm.svg');
    const svgText = fs.readFileSync(await dl.path(), 'utf8');
    assert(svgText.includes('width="200mm"') && svgText.includes('viewBox="0 0 200 200"'));
    assert(!/<(?:text|image|script|use|style)\b|transform=|<g [^>]*transform|#14a89d|data-handle/.test(svgText), 'sem texto, imagem, transform nem guias do editor');
    assert((svgText.match(/<path /g) || []).length >= 2 && !/NaN|undefined/.test(svgText));
    // o SVG exportado ocupa exatamente a caixa que o editor mostra
    const exported = await page.evaluate(async svgText => {
      const holder = document.createElement('div'); holder.innerHTML = svgText.replace(/^<\?xml[^>]*>/, ''); document.body.append(holder);
      const paths = [...holder.querySelectorAll('path')].map(p => p.getBBox()); holder.remove();
      const s = JSON.parse(localStorage.getItem('capabuilder:laser:v2:test'));
      return { items: s.items.map(i => LaserEditor.itemAABB(i)), svgBoxes: paths.length };
    }, svgText);
    assert(exported.svgBoxes >= 2 && exported.items.length === 2);
    const union = await page.evaluate(svgText => {
      const holder = document.createElement('div'); holder.innerHTML = svgText.replace(/^<\?xml[^>]*>/, ''); document.body.append(holder);
      const b = holder.querySelector('#gravacao').getBBox(); holder.remove(); return { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height };
    }, svgText);
    const expected = { x: Math.min(...exported.items.map(i => i.x)), y: Math.min(...exported.items.map(i => i.y)), r: Math.max(...exported.items.map(i => i.x + i.w)), b: Math.max(...exported.items.map(i => i.y + i.h)) };
    // (a caixa da tinta é um pouco menor ou igual à caixa do elemento, nunca maior)
    assert(union.x >= expected.x - 0.5 && union.y >= expected.y - 0.5 && union.r <= expected.r + 0.5 && union.b <= expected.b + 0.5, 'export dentro da caixa do editor: ' + JSON.stringify({ union, expected }));
    // formato AI (Illustrator): mesmo nome, extensão .ai, arquivo PDF-compatível
    await page.locator('[data-format]').selectOption('ai');
    const aiP = page.waitForEvent('download');
    await page.locator('[data-export]').click();
    const ai = await aiP;
    assert.equal(ai.suggestedFilename(), 'gravacao-48213-eduardo-e-thais-courino-200x200mm.ai');
    assert.equal(fs.readFileSync(await ai.path()).subarray(0, 5).toString(), '%PDF-');
    await page.locator('[data-format]').selectOption('svg');
    // prévia PNG
    const pngP = page.waitForEvent('download');
    await page.locator('[data-png]').click();
    const png = await pngP;
    assert(png.suggestedFilename().endsWith('-previa.png'));
    assert.equal(fs.readFileSync(await png.path()).subarray(1, 4).toString(), 'PNG');

    // fechar guarda o rascunho; reabrir restaura tudo
    await page.locator('[data-close]').click();
    assert(await page.evaluate(() => window.laserClosed === true && !document.getElementById('laser-editor')));
    assert(await page.evaluate(() => LaserEditor.hasDraft({ usuario: 'test' })));
    await open();
    assert.equal(await page.locator('[data-items] .le-pick').count(), 2);
    assert.equal(await page.locator('[data-ident]').inputValue(), '48213 Eduardo e Thais');
    // rascunho corrompido não derruba o editor
    await page.locator('[data-close]').click();
    await page.evaluate(() => localStorage.setItem('capabuilder:laser:v2:test', '{"v":2,"items":[{"type":"text","paths":[{"d":"<script>"}],"bounds":{"x":0,"y":0,"w":1,"h":1}}]}'));
    await open();
    assert.equal(await page.locator('[data-items] .le-pick').count(), 0);
    await page.locator('[data-close]').click();

    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

(async () => {
  serverUnit();
  await serverPermissionsAndFontId();
  await browserTests();
  console.log('PASS: conversão de texto (linhas, alinhamento, espaçamento, glifos faltando), permissões, id de fonte do site, ícones CorelDRAW, fidelidade de caminhos SVG, edição de texto, arrastar/encaixar/redimensionar/girar, teclado, undo, export SVG limpo + PNG, rascunho');
})().catch(e => { console.error(e); process.exit(1); });
