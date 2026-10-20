// Teste do envio de pedido com imagens pesadas: o corpo da requisição precisa ficar abaixo do limite da
// Vercel (~4,5MB), senão o servidor responde "Erro 413". Usa o mesmo molde dos outros testes de tela.
//   node tests/payload.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_NODE_MODULES || 'C:/Users/C3TECH/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const html = source.replace('/* ============================== BOOT', `
      window.hook = {
        open(){ currentUser = { usuario: 'seller', role: 'vendedora', nome: 'Vendedora' }; document.querySelectorAll('.screen').forEach(s => s.hidden = true); selectedClienteId = 'c1'; openEditor(GABARITOS[0], null, { coverMode:'covers', background:{ type:'solid', color1:'#ffffff' }, layers:[] }, null); },
        add(layer){ layers.push(layer); },
        async fit(){ const t = await fitPayload(() => ({ designJson: { layers: layers.map(l => { const c = Object.assign({}, l); delete c._img; return c; }) } })); return t.length; },
        sizes(){ return layers.map(l => ({ id: l.id, bytes: l.src.length, natW: l.natW, natH: l.natH, faces: l.facesRaw })); },
      };
      /* ============================== BOOT`);
    let posted = null;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'app.local') return route.abort();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/laser-editor.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '../laser-editor.js'), 'utf8') });
      if (url.pathname === '/laser-editor.css') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname === '/api/me') return json({}, 401);
      if (url.pathname === '/api/pedidos' && route.request().method() === 'POST') { posted = route.request().postData(); return json({ ok: true }); }
      return json({ assets: [], pedidos: [], usuarios: [] });
    });
    await page.goto('http://app.local');
    await page.evaluate(() => window.hook.open());

    // Foto e ícone que juntos passam fácil de 4,5MB: ruído (quase incompressível) em PNG/JPEG.
    const heavy = await page.evaluate(() => {
      const noise = (w, h, type, q) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'), d = x.createImageData(w, h);
        for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
        x.putImageData(d, 0, 0);
        return c.toDataURL(type, q);
      };
      const photo = noise(1400, 1400, 'image/jpeg', 0.95), icon = noise(1200, 1200, 'image/png');
      const mk = (id, type, src, w, h, extra) => Object.assign({ id, type, name: id, src, natW: w, natH: h, x: 10, y: 10, w: 60, h: 60, opacity: 1, rotation: 0, visible: true, locked: false }, extra);
      window.hook.add(mk('foto', 'image', photo, 1400, 1400, { imgScale: 1, facesRaw: [{ x: 700, y: 700, w: 200, h: 200 }] }));
      window.hook.add(mk('icone', 'icon', icon, 1200, 1200, { tintColor: null }));
      return { photoBytes: photo.length, iconBytes: icon.length };
    });
    assert(heavy.photoBytes + heavy.iconBytes > 5 * 1024 * 1024, 'o cenário precisa ser pesado de verdade: ' + JSON.stringify(heavy));

    const size = await page.evaluate(() => window.hook.fit());
    assert(size <= 4 * 1024 * 1024, 'corpo ficou com ' + size + ' bytes');
    const after = await page.evaluate(() => window.hook.sizes());
    assert(after.every(l => l.bytes < heavy.photoBytes), 'as imagens foram recomprimidas');
    const photo = after.find(l => l.id === 'foto');
    assert(Math.abs(photo.faces[0].x / photo.natW - 0.5) < 0.01, 'posição do rosto acompanha a nova resolução');
    assert.deepEqual(errors, []);
    console.log('PASS: envio com imagens pesadas fica abaixo de 4MB —', Math.round(size / 1024), 'KB (antes', Math.round((heavy.photoBytes + heavy.iconBytes) / 1024), 'KB)');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
