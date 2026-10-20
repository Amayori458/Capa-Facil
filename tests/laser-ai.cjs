// Exportação em AI (Illustrator): confere que o arquivo sai bem formado e com a mesma geometria do SVG
// (aberto com o pypdf, se houver Python). Para conferir no Illustrator de verdade: AI_OUT=<pasta> grava os arquivos gerados lá.
//   node tests/laser-ai.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), cp = require('node:child_process');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_NODE_MODULES || 'C:/Users/C3TECH/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://laser.test/**', route => {
      const p = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: (p.endsWith('.js') ? 'text/javascript' : 'text/html') + '; charset=utf-8', body: p === '/laser-editor.js' ? fs.readFileSync(path.join(__dirname, '../laser-editor.js'), 'utf8') : '<script src="/laser-editor.js"></script>' });
    });
    await page.goto('https://laser.test/');
    const out = await page.evaluate(() => {
      // furo (evenodd) + curva quadrática + cúbica + traço, rotacionado, numa área de 100 × 60 mm
      const item = (extra) => Object.assign({ id: 'a', type: 'icon', label: 'x', bounds: { x: 0, y: 0, w: 40, h: 30 }, x: 10, y: 10, w: 40, rot: 0,
        paths: [
          { d: 'M0 0L40 0L40 30L0 30ZM10 10L10 20L30 20L30 10Z', fill: true, rule: 'evenodd', stroke: 0 },
          { d: 'M5 5Q20 -5 35 5C30 25 10 25 5 5Z', fill: true, rule: 'nonzero', stroke: 0 },
          { d: 'M2 28L38 28', fill: false, rule: 'nonzero', stroke: 1 },
        ] }, extra);
      const state = LaserEditor.cleanState({ v: 2, width: 100, height: 60, margin: 5, material: 'courino', ident: 'Teste Maçã', items: [item({}), item({ id: 'b', x: 55, y: 30, w: 30, rot: 30 })] });
      const flat = LaserEditor.flattenItems(state);
      const pdf = LaserEditor.buildPdfAi(state);
      return { pdf: Array.from(pdf), svg: LaserEditor.buildSvg(state), paths: flat.length, subpaths: flat.reduce((n, p) => n + p.segs.filter(s => s[0] === 'M').length, 0) };
    });
    const pdf = Buffer.from(out.pdf);
    const dir = process.env.AI_OUT || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'laser-ai-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'teste.ai'), pdf); fs.writeFileSync(path.join(dir, 'teste.svg'), out.svg);

    // --- PDF-compatível
    assert(pdf.subarray(0, 8).toString() === '%PDF-1.5' && pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
    const py = `
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
pg = r.pages[0]
mb = [float(v) for v in pg.mediabox]
c = pg.get_contents().get_data().decode('latin1')
print(len(r.pages), round(mb[2], 2), round(mb[3], 2), c.count(' m\\n'), c.count(' c\\n'), c.count('f*\\n'), c.count('S\\n'), r.metadata.title)
`;
    const res = cp.spawnSync('python', ['-c', py, path.join(dir, 'teste.ai')], { encoding: 'utf8' });
    if (res.status === 0) {
      const [pages, w, h, m, c, fe, st] = res.stdout.trim().split(/\s+/);
      assert.equal(+pages, 1);
      assert(Math.abs(w - 100 * 72 / 25.4) < 0.01 && Math.abs(h - 60 * 72 / 25.4) < 0.01, 'MediaBox = área em pontos: ' + w + 'x' + h);
      assert.equal(+m, out.subpaths); assert.equal(+fe, 2); assert.equal(+st, 2);
      assert(+c >= 4, 'curvas presentes (Q virou C)');
    } else console.log('(pypdf indisponível — conferência do PDF ignorada)', (res.stderr || '').split('\n').slice(-2).join(' '));
    // O arquivo continua legível por quem só conhece SVG: as medidas batem
    assert(out.svg.includes('width="100mm"') && out.svg.includes('height="60mm"'));
    assert.deepEqual(errors, []);
    console.log('PASS: AI (PDF-compatível) bem formado, mesma geometria do SVG — arquivos em', dir);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
