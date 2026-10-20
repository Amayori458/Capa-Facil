// SVG enviado por vendedora passa por lista de permitidos: nada que execute script, carregue link ou imagem.
//   node tests/svg-seguro.cjs
const assert = require('node:assert/strict');
const { sanitizeSvg } = require('../api/assets');

const ATAQUES = {
  'script': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0h10v10z"/></svg>',
  'onload com barra': '<svg xmlns="http://www.w3.org/2000/svg"/onload="alert(1)"><path d="M0 0h10v10z"/></svg>',
  'onload': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0h10v10z"/></svg>',
  'animate onbegin': '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"><animate attributeName="x" onbegin="alert(1)"/></path></svg>',
  'set href': '<svg xmlns="http://www.w3.org/2000/svg"><a href="x"><set attributeName="href" to="javascript:alert(1)"/><path d="M0 0h10v10z"/></a></svg>',
  'a xlink:href': '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect width="9" height="9"/></a></svg>',
  'entidade': '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#115;cript:alert(1)"><rect width="9" height="9"/></a></svg>',
  'foreignObject': '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>',
  'image externa': '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/track.png"/><use href="https://evil.test/x.svg#a"/></svg>',
  'style com url': '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(https://evil.test/x)}</style><rect class="a" width="9" height="9" style="fill:url(javascript:alert(1))"/></svg>',
  'xml com outro namespace': '<svg xmlns="http://www.w3.org/2000/svg"><x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script><rect width="9" height="9"/></svg>',
};
for (const [nome, svg] of Object.entries(ATAQUES)) {
  let out;
  try { out = sanitizeSvg(svg); } catch (e) { continue; }   // recusar também é um resultado seguro
  assert(!/script|\bon[a-z]+\s*=|href|foreignObject|iframe|javascript|url\(|<image|<use|<animate|<set/i.test(out), nome + ' sobrou: ' + out);
}
assert.throws(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>'), /inválido/);
assert.throws(() => sanitizeSvg('isso não é svg'), /válido/);

// um ícone de verdade (CorelDRAW: style + classe + metadata) continua desenhando igual
const corel = `<?xml version="1.0" encoding="UTF-8"?><!-- Creator: CorelDRAW --><svg xmlns="http://www.w3.org/2000/svg" width="17mm" height="16mm" viewBox="0 0 78 76" style="fill-rule:evenodd">
<defs><style type="text/css"><![CDATA[ .fil0 {fill:black;fill-rule:nonzero} ]]></style></defs><g id="Camada_1"><metadata id="CorelCorpID"/><path class="fil0" d="M10 10L60 10L60 60L10 60Z"/><polygon class="fil0" points="1,1 5,1 3,4"/></g></svg>`;
const ok = sanitizeSvg(corel);
assert(ok.includes('viewBox="0 0 78 76"') && ok.includes('d="M10 10L60 10L60 60L10 60Z"') && ok.includes('class="fil0"') && ok.includes('.fil0') && ok.includes('<polygon'));
assert(!ok.includes('metadata') && !ok.includes('Creator'));
console.log('PASS: SVG de vendedora sanitizado por lista de permitidos —', Object.keys(ATAQUES).length, 'ataques neutralizados, ícone Corel preservado');
