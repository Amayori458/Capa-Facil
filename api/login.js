const { getSupabase, verifyPassword, createSessionToken, setSessionCookie, readJsonBody } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }
  const body = await readJsonBody(req);
  const usuario = (body.usuario || '').trim().toLowerCase();
  const senha = body.senha || '';
  if (!usuario || !senha) { res.status(400).json({ error: 'Informe usuário e senha.' }); return; }

  const supabase = getSupabase();
  const { data, error } = await supabase.from('usuarios').select('*').eq('usuario', usuario).maybeSingle();
  if (error || !data || !data.ativo || !verifyPassword(senha, data.senha_hash)) {
    res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    return;
  }
  setSessionCookie(res, createSessionToken(data));
  res.status(200).json({ nome: data.nome, usuario: data.usuario, role: data.role, vendedoraId: data.criado_por_vendedora_id || null });
};
