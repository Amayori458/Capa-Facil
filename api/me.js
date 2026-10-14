const { getSession, getSupabase, allowedProducts } = require('./_auth');

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Não autenticado.' }); return; }
  const produtos = await allowedProducts(getSupabase(), session);
  res.status(200).json({ nome: session.nome, usuario: session.usuario, role: session.role, vendedoraId: session.vendedoraId || null, produtos });
};
