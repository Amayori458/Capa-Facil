// Aba "Pedidos" da vendedora: seções por situação (Para aprovar, Aguardando cliente, Ajuste pedido,
// Aprovados, Em produção, Todos), com contagem, busca e ações que só aparecem onde fazem sentido.
//   node tests/vendedora-pedidos.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_NODE_MODULES || 'C:/Users/C3TECH/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));

const img = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#888"/></svg>');
const ped = (id, numero, status, dias) => ({ id, numero_pedido: numero, status, gabarito_id: '10x15-20', gabarito_label: '10×15 · 20 folhas', cliente_id: 'c1', mockup_url: img, criado_em: new Date(Date.now() - dias * 86400000).toISOString() });
const PEDIDOS = [
  ped('1', '1001', 'aguardando_aprovacao_vendedora', 0), ped('2', '1002', 'aguardando_aprovacao_vendedora', 1),
  ped('3', '2001', 'aguardando_aprovacao_cliente', 2), ped('4', '3001', 'reprovado', 3),
  ped('5', '4001', 'aprovado', 4), ped('6', '4002', 'aprovado', 5), ped('7', '4003', 'aprovado', 6), ped('8', '5001', 'producao', 7),
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const html = source.replace('/* ============================== BOOT', `
      window.hook = { async open(){ currentUser = { usuario: 'bianca', role: 'vendedora', nome: 'Bianca' }; document.querySelectorAll('.screen').forEach(s => s.hidden = true); document.getElementById('screen-vendedora').hidden = false;
        document.querySelectorAll('#screen-vendedora .admin-panel').forEach(p => p.hidden = p.id !== 'vendedora-panel-pedidos'); await renderVendedoraPedidos(); } };
      /* ============================== BOOT`);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'app.local') return route.abort();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/laser-editor.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '../laser-editor.js'), 'utf8') });
      if (url.pathname === '/laser-editor.css') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname === '/api/me') return json({}, 401);
      if (url.pathname === '/api/pedidos') return json({ pedidos: PEDIDOS });
      if (url.pathname === '/api/usuarios') return json({ usuarios: [{ id: 'c1', nome: 'Maria Cliente', whatsapp: '11999999999' }] });
      return json({ assets: [] });
    });
    await page.goto('http://app.local');
    await page.evaluate(() => window.hook.open());

    const chips = async () => (await page.locator('#vped-filters .filter-chip').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(await chips(), ['Para aprovar 2', 'Aguardando cliente 1', 'Ajuste pedido 1', 'Aprovados 3', 'Em produção 1', 'Todos 8']);
    // abre no que depende dela
    assert.equal(await page.locator('#vped-filters .filter-chip.on').innerText().then(t => t.replace(/\s+/g, ' ').trim()), 'Para aprovar 2');
    assert.equal(await page.locator('#vped-list > [data-id]').count(), 2);
    assert.equal(await page.locator('#vped-list .pedido-aprovar').count(), 2);
    assert.equal(await page.locator('#vped-list .pedido-ir-producao').count(), 0);

    await page.locator('[data-filter="aprovado"]').click();
    assert.equal(await page.locator('#vped-list > [data-id]').count(), 3);
    assert.equal(await page.locator('#vped-list .pedido-ir-producao').count(), 3);
    assert.equal(await page.locator('#vped-list .pedido-aprovar').count(), 0);

    await page.locator('[data-filter="cliente"]').click();
    assert.equal(await page.locator('#vped-list .pedido-aprovar-cliente').count(), 1);
    assert.equal(await page.locator('#vped-list .pedido-whatsapp').count(), 1);

    await page.locator('[data-filter="todos"]').click();
    assert.equal(await page.locator('#vped-list > [data-id]').count(), 8);
    // busca dentro da seção
    await page.locator('#vped-search').fill('4002');
    assert.equal(await page.locator('#vped-list > [data-id]').count(), 1);
    await page.locator('#vped-search').fill('zzz');
    assert(/Nenhum pedido encontrado/.test(await page.locator('#vped-list').innerText()));
    // seção vazia some do menu e a escolha anterior se mantém ao reabrir a aba
    await page.locator('#vped-search').fill('');
    await page.evaluate(() => window.hook.open());
    assert.equal(await page.locator('#vped-filters .filter-chip.on').innerText().then(t => t.replace(/\s+/g, ' ').trim()), 'Todos 8');
    assert.deepEqual(errors, []);
    console.log('PASS: pedidos da vendedora separados por seção (contagem, busca, ações por situação, estado mantido)');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
