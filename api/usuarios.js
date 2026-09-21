const { getSupabase, requireAuth, readJsonBody, hashPassword } = require('./_auth');

module.exports = async (req, res) => {
  const session = requireAuth(req, res, { roles: ['admin', 'vendedora'] });
  if (!session) return;
  const isAdmin = session.role === 'admin';
  const supabase = getSupabase();

  if (req.method === 'GET') {
    let query = supabase.from('usuarios')
      .select('id,nome,usuario,role,ativo,criado_em,whatsapp,criado_por_vendedora_id')
      .order('criado_em', { ascending: true });
    if (!isAdmin) query = query.eq('criado_por_vendedora_id', session.uid);
    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ usuarios: data });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const nome = (body.nome || '').trim().slice(0, 120);
    const usuario = (body.usuario || '').trim().toLowerCase().slice(0, 60);
    const senha = body.senha || '';
    const whatsapp = (body.whatsapp || '').replace(/\D/g, '').slice(0, 20) || null;
    let role, criado_por_vendedora_id;
    if (isAdmin) {
      role = body.role === 'admin' ? 'admin' : body.role === 'vendedora' ? 'vendedora' : 'cliente';
      criado_por_vendedora_id = null;
    } else {
      role = 'cliente';
      criado_por_vendedora_id = session.uid;
    }
    if (!nome || !usuario || senha.length < 6) {
      res.status(400).json({ error: 'Preencha nome, usuário e uma senha com 6+ caracteres.' });
      return;
    }
    const { error } = await supabase.from('usuarios').insert({
      nome, usuario, senha_hash: hashPassword(senha), role, ativo: true, whatsapp, criado_por_vendedora_id,
    });
    if (error) {
      const msg = /duplicate|unique/i.test(error.message) ? 'Já existe um usuário com esse nome de acesso.' : error.message;
      res.status(400).json({ error: msg });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    if (id === session.uid && body.ativo === false) {
      res.status(400).json({ error: 'Você não pode desativar sua própria conta.' });
      return;
    }
    if (id === session.uid && typeof body.role === 'string') {
      res.status(400).json({ error: 'Você não pode mudar o tipo da sua própria conta.' });
      return;
    }
    if (!isAdmin) {
      const { data: target, error: findErr } = await supabase.from('usuarios').select('criado_por_vendedora_id').eq('id', id).maybeSingle();
      if (findErr) { res.status(500).json({ error: findErr.message }); return; }
      if (!target || target.criado_por_vendedora_id !== session.uid) { res.status(403).json({ error: 'Sem permissão.' }); return; }
    }
    const updates = {};
    if (typeof body.ativo === 'boolean') updates.ativo = body.ativo;
    if (typeof body.nome === 'string' && body.nome.trim()) updates.nome = body.nome.trim().slice(0, 120);
    if (typeof body.role === 'string') {
      if (!isAdmin) { res.status(403).json({ error: 'Só o admin pode mudar o tipo de uma conta.' }); return; }
      if (!['admin', 'vendedora', 'cliente'].includes(body.role)) { res.status(400).json({ error: 'Tipo inválido.' }); return; }
      updates.role = body.role;
      // Conta deixou de ser cliente de uma vendedora específica — não faz sentido continuar "pertencendo" a ela.
      if (body.role !== 'cliente') updates.criado_por_vendedora_id = null;
    }
    if (typeof body.whatsapp === 'string') updates.whatsapp = body.whatsapp.replace(/\D/g, '').slice(0, 20) || null;
    if (typeof body.senha === 'string' && body.senha) {
      if (body.senha.length < 6) { res.status(400).json({ error: 'Senha precisa ter 6+ caracteres.' }); return; }
      updates.senha_hash = hashPassword(body.senha);
    }
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'Nada para atualizar.' }); return; }
    let query = supabase.from('usuarios').update(updates).eq('id', id);
    if (!isAdmin) query = query.eq('criado_por_vendedora_id', session.uid);
    const { error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    if (!isAdmin) { res.status(403).json({ error: 'Só o admin pode excluir cadastros.' }); return; }
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    if (id === session.uid) { res.status(400).json({ error: 'Você não pode excluir sua própria conta.' }); return; }
    // Confere vínculos antes de tentar excluir, pra devolver uma mensagem clara em vez do erro cru
    // do banco — excluir uma conta com pedidos vinculados é bloqueado de propósito (perderia o
    // histórico). O caminho certo pra esses casos é bloquear o acesso, não excluir.
    const { count: pedidosCount, error: pedidosErr } = await supabase
      .from('pedidos').select('id', { count: 'exact', head: true })
      .or('cliente_id.eq.' + id + ',usuario_id.eq.' + id + ',vendedora_id.eq.' + id + ',aprovado_por.eq.' + id);
    if (pedidosErr) { res.status(500).json({ error: pedidosErr.message }); return; }
    if (pedidosCount > 0) {
      res.status(400).json({ error: 'Esse cadastro tem ' + pedidosCount + ' pedido(s) vinculado(s) — não é possível excluir. Bloqueie o acesso em vez de excluir.' });
      return;
    }
    const { count: clientesCriadosCount, error: clientesErr } = await supabase
      .from('usuarios').select('id', { count: 'exact', head: true }).eq('criado_por_vendedora_id', id);
    if (clientesErr) { res.status(500).json({ error: clientesErr.message }); return; }
    if (clientesCriadosCount > 0) {
      res.status(400).json({ error: 'Essa vendedora cadastrou ' + clientesCriadosCount + ' cliente(s) — não é possível excluir. Bloqueie o acesso em vez de excluir.' });
      return;
    }
    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    if (error) {
      const msg = /foreign key|violates/i.test(error.message)
        ? 'Não é possível excluir — esse cadastro ainda tem registros vinculados. Bloqueie o acesso em vez de excluir.'
        : error.message;
      res.status(400).json({ error: msg });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
