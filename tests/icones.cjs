// Ícones no editor: sombra (desenho de verdade em pixels) e importação de arquivos de várias origens.
//   node tests/icones.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_NODE_MODULES || 'C:/Users/C3TECH/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));

const SQUARE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6"/></svg>';

const window_posts = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const html = source.replace('/* ============================== BOOT', `
      window.hook = {
        open(){ currentUser = { usuario: 'seller', role: 'vendedora', nome: 'V' }; document.querySelectorAll('.screen').forEach(s => s.hidden = true); openEditor(GABARITOS[0], null, { coverMode:'covers', background:{ type:'solid', color1:'#ffffff' }, layers:[] }, null); },
        layers(){ return layers.map(l => ({ type: l.type, name: l.name, w: l.w, h: l.h, natW: l.natW, natH: l.natH, srcLen: (l.src||'').length, mime: (l.src||'').slice(5, 20), loaded: !!(l._img && l._img.naturalWidth), shadow: l.shadow })); },
        async shadowPixels(shadow){
          const l = { id:'t', type:'icon', x:10, y:10, w:20, h:20, opacity:1, rotation:0, tintColor:null, shadow, src: '${'data:image/svg+xml;base64,'}' + btoa(${JSON.stringify(SQUARE_SVG)}) };
          l._img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = l.src; });
          const c = document.createElement('canvas'); c.width = 400; c.height = 400; const x = c.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 400);
          drawIconLayer(x, l, v => v * 8);   // 8 px por mm; ícone ocupa 80..240 px, quadrado preto de 96 a 224
          const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data);
          return { icon: px(160, 160), below: px(160, 214), above: px(160, 90), right: px(236, 160) };
        },
      };
      /* ============================== BOOT`);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'app.local') return route.abort();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/laser-editor.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '../laser-editor.js'), 'utf8') });
      if (url.pathname === '/laser-editor.css') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname === '/api/me') return json({}, 401);
      if (url.pathname === '/api/assets' && route.request().method() === 'POST') { window_posts.push(route.request().postDataJSON()); return json({ ativo: { id: 'x' } }); }
      return json({ assets: [], ativos: [], pedidos: [], usuarios: [] });
    });
    await page.goto('http://app.local');

    /* --- sombra: precisa aparecer de fato, e ser visível com os valores padrão --- */
    const off = await page.evaluate(() => window.hook.shadowPixels({ enabled: false, color: '#000000', blur: 1.5, dx: 0, dy: 0.6 }));
    const on = await page.evaluate(() => window.hook.shadowPixels({ enabled: true, color: '#000000', blur: 1.2, dx: 0.8, dy: 1.2, opacity: 0.7 }));
    const antiga = await page.evaluate(() => window.hook.shadowPixels({ enabled: true, color: '#000000', blur: 1.5, dx: 0, dy: 0.6 })); // salvo antes de existir 'opacity'
    assert(off.icon[0] < 40, 'o ícone é preto');
    assert(antiga.below[0] < 245, 'sombra salva antes (sem opacity) continua aparecendo');
    assert(off.below[0] > 250, 'sem sombra o fundo continua branco');
    assert(on.below[0] < 150, 'com sombra, abaixo do ícone escurece: ' + JSON.stringify(on));

    /* --- importação de arquivos --- */
    await page.evaluate(() => window.hook.open());
    await page.waitForSelector('#file-icon-import', { state: 'attached' });
    const noise = async (w, h, type) => page.evaluate(async ([w, h, type]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'), d = x.createImageData(w, h);
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, type));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, [w, h, type]);
    const alphaPng = async () => page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#c00'; x.beginPath(); x.arc(300, 200, 150, 0, 7); x.fill();
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const cases = [
      { name: 'png-transparente.png', mimeType: 'image/png', buffer: Buffer.from(await alphaPng()) },
      { name: 'png-grande.png', mimeType: 'image/png', buffer: Buffer.from(await noise(1800, 1800, 'image/png')) },     // vários MB
      { name: 'foto-icone.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await noise(1500, 1500, 'image/jpeg')) },
      { name: 'so-viewbox.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SQUARE_SVG) },
      { name: 'sem-xmlns.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>') },
      { name: 'sem-tipo.svg', mimeType: '', buffer: Buffer.from(SQUARE_SVG) },
    ];
    for (const c of cases) {
      const before = (await page.evaluate(() => window.hook.layers())).length;
      await page.setInputFiles('#file-icon-import', { name: c.name, mimeType: c.mimeType, buffer: c.buffer });
      await page.waitForFunction(n => window.hook.layers().length > n, before, { timeout: 8000 }).catch(() => { throw new Error('não importou: ' + c.name + ' (' + Math.round(c.buffer.length / 1024) + ' KB)'); });
      const l = (await page.evaluate(() => window.hook.layers())).at(-1);
      assert.equal(l.type, 'icon', c.name);
      assert(l.w > 1 && l.h > 1 && Number.isFinite(l.w) && Number.isFinite(l.h), c.name + ' com tamanho inválido ' + l.w + 'x' + l.h);
      assert(l.natW > 8 && l.natH > 8, c.name + ' resolução ' + l.natW + 'x' + l.natH);
      assert(l.srcLen < 1.2 * 1024 * 1024, c.name + ' ficou pesado: ' + l.srcLen);
      await page.waitForFunction(() => window.hook.layers().at(-1).loaded);
    }
    // vendedora: o ícone importado também vai pra biblioteca da equipe (um envio por arquivo importado)
    await page.waitForFunction(() => true);
    assert.equal(window_posts.length, cases.length, 'cada ícone importado é enviado à biblioteca: ' + window_posts.length);
    assert(window_posts.every(p => p.tipo === 'icone' && /^data:image\/(svg\+xml|png);base64,/.test(p.dataUrl) && p.nome), 'corpo do envio');
    // painel: ligar a sombra mostra cor, desfoque, distância e força; mexer na força atualiza a camada
    await page.locator('#p-shadow-on').check();
    for (const id of ['#p-shadow-color', '#p-shadow-blur', '#p-shadow-dx', '#p-shadow-dy', '#p-shadow-opacity']) assert(await page.locator(id).count() === 1 || await page.locator(id + ', [data-color-id="' + id.slice(1) + '"]').count() >= 1, 'falta ' + id);
    await page.locator('#p-shadow-dy').fill('2'); await page.locator('#p-shadow-dy').dispatchEvent('change');
    const sh = (await page.evaluate(() => window.hook.layers())).at(-1).shadow;
    assert(sh.enabled && sh.dy === 2 && sh.dx === 0.8 && sh.opacity === 0.7, JSON.stringify(sh));
    assert.deepEqual(errors, []);
    console.log('PASS: sombra de ícone desenha de verdade; importação de PNG/JPG/SVG (inclusive grande, sem xmlns, sem tipo)');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
