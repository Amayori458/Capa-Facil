const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SESSION_COOKIE = 'cdc_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'construtor_capas' },
    auth: { persistSession: false },
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const hashBuf = Buffer.from(hash, 'hex');
  const checkBuf = crypto.scryptSync(password, salt, 64);
  if (hashBuf.length !== checkBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, checkBuf);
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payloadB64).digest('hex');
}

function createSessionToken(user) {
  const payload = {
    uid: user.id, nome: user.nome, usuario: user.usuario, role: user.role,
    vendedoraId: user.criado_por_vendedora_id || null,
    exp: Date.now() + SESSION_MAX_AGE * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return payloadB64 + '.' + sign(payloadB64);
}

function verifySessionToken(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let sigBuf, expBuf;
  try { sigBuf = Buffer.from(sig, 'hex'); expBuf = Buffer.from(sign(payloadB64), 'hex'); } catch (e) { return null; }
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    SESSION_COOKIE + '=' + token, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=' + SESSION_MAX_AGE,
  ].join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

function getSession(req) {
  return verifySessionToken(parseCookies(req)[SESSION_COOKIE]);
}

function requireAuth(req, res, opts) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Não autenticado.' }); return null; }
  if (opts && opts.role && session.role !== opts.role) { res.status(403).json({ error: 'Sem permissão.' }); return null; }
  if (opts && opts.roles && !opts.roles.includes(session.role)) { res.status(403).json({ error: 'Sem permissão.' }); return null; }
  return session;
}

// Produtos que o site sabe montar. O id do produto de um gabarito vem do prefixo do id
// do gabarito (encadernados são "enc-<formato>-<lâminas>") — o servidor não conhece a lista
// de gabaritos, então o prefixo é o que impede alguém de montar um produto não liberado.
const ALL_PRODUCTS = ['autocolante', 'encadernado', 'laser'];
function produtoDeGabarito(gabaritoId) {
  if (String(gabaritoId || '').startsWith('laser-')) return 'laser';
  return String(gabaritoId || '').startsWith('enc-') ? 'encadernado' : 'autocolante';
}
// Admin monta tudo; os demais, só o que o admin liberou (lido do banco a cada chamada,
// pra liberar/tirar acesso valer na hora, sem precisar de novo login).
async function allowedProducts(supabase, session) {
  if (session.role === 'admin') return ALL_PRODUCTS.slice();
  const { data } = await supabase.from('usuarios').select('produtos').eq('id', session.uid).maybeSingle();
  const list = data && Array.isArray(data.produtos) ? data.produtos : ['autocolante'];
  return list.filter(p => ALL_PRODUCTS.includes(p));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}

module.exports = {
  getSupabase, hashPassword, verifyPassword, createSessionToken, verifySessionToken,
  setSessionCookie, clearSessionCookie, getSession, requireAuth, readJsonBody,
  ALL_PRODUCTS, produtoDeGabarito, allowedProducts,
};
