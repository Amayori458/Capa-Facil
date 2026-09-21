const { getSession } = require('./_auth');

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Não autenticado.' }); return; }
  res.status(200).json({ nome: session.nome, usuario: session.usuario, role: session.role, vendedoraId: session.vendedoraId || null });
};
