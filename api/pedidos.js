const { getSupabase, requireAuth, readJsonBody } = require('./_auth');

const CLIENT_SAFE_COLUMNS = 'id,numero_pedido,gabarito_id,gabarito_label,criado_em,status,mockup_url,motivo_reprovacao,vendedora_id,cliente_id';

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const supabase = getSupabase();
    const id = req.query && req.query.id;

    if (session.role === 'admin') {
      if (id) {
        const { data, error } = await supabase.from('pedidos').select('*').eq('id', id).maybeSingle();
        if (error) { res.status(500).json({ error: error.message }); return; }
        if (!data) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }
        res.status(200).json({ pedido: data });
        return;
      }
      const { data, error } = await supabase.from('pedidos')
        .select('id,numero_pedido,gabarito_id,gabarito_label,nome_arquivo,usuario_nome,criado_em,precisa_ajuda,status,vendedora_id,cliente_id,mockup_url')
        .order('criado_em', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ pedidos: data });
      return;
    }

    if (session.role === 'vendedora') {
      if (id) {
        const { data, error } = await supabase.from('pedidos').select('*').eq('id', id).eq('vendedora_id', session.uid).maybeSingle();
        if (error) { res.status(500).json({ error: error.message }); return; }
        if (!data) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }
        res.status(200).json({ pedido: data });
        return;
      }
      const { data, error } = await supabase.from('pedidos')
        .select('id,numero_pedido,gabarito_id,gabarito_label,nome_arquivo,criado_em,status,mockup_url,motivo_reprovacao,cliente_id,aprovado_em')
        .eq('vendedora_id', session.uid)
        .order('criado_em', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ pedidos: data });
      return;
    }

    // cliente — nunca recebe design_json nem mockup_storage_path
    if (id) {
      const { data, error } = await supabase.from('pedidos').select(CLIENT_SAFE_COLUMNS).eq('id', id).eq('cliente_id', session.uid).maybeSingle();
      if (error) { res.status(500).json({ error: error.message }); return; }
      if (!data) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }
      res.status(200).json({ pedido: data });
      return;
    }
    const { data, error } = await supabase.from('pedidos')
      .select(CLIENT_SAFE_COLUMNS)
      .eq('cliente_id', session.uid)
      .order('criado_em', { ascending: false }).limit(500);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ pedidos: data });
    return;
  }

  if (req.method === 'POST') {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readJsonBody(req);
    const numero_pedido = (body.numeroPedido || '').trim().slice(0, 60);
    const gabarito_id = (body.gabaritoId || '').trim().slice(0, 60);
    const gabarito_label = (body.gabaritoLabel || '').trim().slice(0, 120);
    const nome_arquivo = (body.nomeArquivo || '').trim().slice(0, 200);
    const design_json = body.designJson && typeof body.designJson === 'object' ? body.designJson : null;
    const precisa_ajuda = body.precisaAjuda === true;
    if (!numero_pedido || !gabarito_id) { res.status(400).json({ error: 'Dados incompletos.' }); return; }
    const supabase = getSupabase();

    const insert = {
      numero_pedido, gabarito_id, gabarito_label, nome_arquivo, design_json, precisa_ajuda,
      usuario_id: session.uid, usuario_nome: session.nome,
    };

    // Fluxo de aprovação — só entra em jogo quando o cliente explicitamente pede pra enviar (submitForApproval).
    // "Falar com atendente" e a exportação normal do admin/cliente legado continuam sem status/aprovação.
    if (body.forApproval === true) {
      if (session.role === 'vendedora') {
        const clienteId = body.clienteId;
        if (!clienteId) { res.status(400).json({ error: 'Selecione o cliente para este pedido.' }); return; }
        const { data: cliente } = await supabase.from('usuarios').select('id').eq('id', clienteId).eq('criado_por_vendedora_id', session.uid).maybeSingle();
        if (!cliente) { res.status(400).json({ error: 'Cliente inválido.' }); return; }
        insert.vendedora_id = session.uid;
        insert.cliente_id = clienteId;
        insert.status = 'aguardando_aprovacao_cliente';
      } else if (session.role === 'cliente' && session.vendedoraId) {
        insert.cliente_id = session.uid;
        insert.vendedora_id = session.vendedoraId;
        insert.status = 'aguardando_aprovacao_vendedora';
      } else {
        res.status(400).json({ error: 'Esta conta não pode enviar pedidos para aprovação.' });
        return;
      }
    }

    // Todo pedido salvo ganha um mockup (não só o fluxo de aprovação) — alimenta a galeria
    // "Mockups e Artes" da vendedora e o reenvio por WhatsApp. Só o fluxo de aprovação EXIGE
    // um mockup válido (sem ele não há o que o outro lado aprovar); fora dele, é best-effort.
    const match = /^data:([^;]+);base64,(.+)$/.exec(body.mockupDataUrl || '');
    if (!match) {
      if (insert.status) { res.status(400).json({ error: 'Mockup não gerado corretamente.' }); return; }
    } else {
      const mime = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 4 * 1024 * 1024) {
        if (insert.status) { res.status(400).json({ error: 'Mockup muito grande.' }); return; }
      } else {
        const ext = mime === 'image/png' ? 'png' : 'jpg';
        const path = 'mockups/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        const { error: upErr } = await supabase.storage.from('site-assets').upload(path, buffer, { contentType: mime, upsert: false });
        if (upErr) {
          if (insert.status) { res.status(500).json({ error: upErr.message }); return; }
        } else {
          const { data: pub } = supabase.storage.from('site-assets').getPublicUrl(path);
          insert.mockup_url = pub.publicUrl;
          insert.mockup_storage_path = path;
        }
      }
    }

    const { data: inserted, error } = await supabase.from('pedidos').insert(insert).select('id').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true, id: inserted.id });
    return;
  }

  if (req.method === 'PATCH') {
    const session = requireAuth(req, res);
    if (!session) return;
    const body = await readJsonBody(req);
    const id = body.id;
    const action = body.action;
    if (!id || !['aprovar', 'reprovar', 'marcar_producao', 'gerar_mockup', 'excluir_mockup'].includes(action)) {
      res.status(400).json({ error: 'Ação inválida.' });
      return;
    }
    const supabase = getSupabase();
    const { data: row, error: findErr } = await supabase.from('pedidos').select('id,status,vendedora_id,cliente_id,mockup_storage_path').eq('id', id).maybeSingle();
    if (findErr) { res.status(500).json({ error: findErr.message }); return; }
    if (!row) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }

    if (action === 'excluir_mockup') {
      const isOwnerVendedora = session.role === 'vendedora' && row.vendedora_id === session.uid;
      if (session.role !== 'admin' && !isOwnerVendedora) { res.status(403).json({ error: 'Sem permissão.' }); return; }
      if (row.mockup_storage_path) {
        // Best-effort: se o arquivo já não existir por algum motivo, isso não deve travar a limpeza do registro.
        await supabase.storage.from('site-assets').remove([row.mockup_storage_path]).catch(() => {});
      }
      const { error: updErr } = await supabase.from('pedidos').update({ mockup_url: null, mockup_storage_path: null }).eq('id', id);
      if (updErr) { res.status(500).json({ error: updErr.message }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'gerar_mockup') {
      const isOwnerVendedora = session.role === 'vendedora' && row.vendedora_id === session.uid;
      if (session.role !== 'admin' && !isOwnerVendedora) { res.status(403).json({ error: 'Sem permissão.' }); return; }
      const match = /^data:([^;]+);base64,(.+)$/.exec(body.mockupDataUrl || '');
      if (!match) { res.status(400).json({ error: 'Mockup não gerado corretamente.' }); return; }
      const mime = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 4 * 1024 * 1024) { res.status(400).json({ error: 'Mockup muito grande.' }); return; }
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const path = 'mockups/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error: upErr } = await supabase.storage.from('site-assets').upload(path, buffer, { contentType: mime, upsert: false });
      if (upErr) { res.status(500).json({ error: upErr.message }); return; }
      const { data: pub } = supabase.storage.from('site-assets').getPublicUrl(path);
      const { error: updErr } = await supabase.from('pedidos').update({ mockup_url: pub.publicUrl, mockup_storage_path: path }).eq('id', id);
      if (updErr) { res.status(500).json({ error: updErr.message }); return; }
      res.status(200).json({ ok: true, mockupUrl: pub.publicUrl });
      return;
    }

    const updates = {};
    if (action === 'aprovar' || action === 'reprovar') {
      if (row.status === 'aguardando_aprovacao_cliente') {
        if (session.role !== 'cliente' || row.cliente_id !== session.uid) { res.status(403).json({ error: 'Sem permissão.' }); return; }
      } else if (row.status === 'aguardando_aprovacao_vendedora') {
        const isOwnerVendedora = session.role === 'vendedora' && row.vendedora_id === session.uid;
        if (!isOwnerVendedora && session.role !== 'admin') { res.status(403).json({ error: 'Sem permissão.' }); return; }
      } else {
        res.status(400).json({ error: 'Este pedido não está aguardando aprovação.' });
        return;
      }
      if (action === 'aprovar') {
        updates.status = 'aprovado';
        updates.aprovado_por = session.uid;
        updates.aprovado_em = new Date().toISOString();
        updates.motivo_reprovacao = null;
      } else {
        const motivo = (body.motivo || '').trim().slice(0, 500);
        if (!motivo) { res.status(400).json({ error: 'Descreva o que precisa ajustar.' }); return; }
        updates.status = 'reprovado';
        updates.motivo_reprovacao = motivo;
      }
    } else if (action === 'marcar_producao') {
      const isOwnerVendedora = session.role === 'vendedora' && row.vendedora_id === session.uid;
      if (session.role !== 'admin' && !isOwnerVendedora) { res.status(403).json({ error: 'Sem permissão.' }); return; }
      if (row.status !== 'aprovado') { res.status(400).json({ error: 'Pedido ainda não aprovado.' }); return; }
      updates.status = 'producao';
    }

    const { error } = await supabase.from('pedidos').update(updates).eq('id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    const session = requireAuth(req, res, { roles: ['admin'] });
    if (!session) return;
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    const supabase = getSupabase();
    const { data: row, error: findErr } = await supabase.from('pedidos').select('id,mockup_storage_path').eq('id', id).maybeSingle();
    if (findErr) { res.status(500).json({ error: findErr.message }); return; }
    if (!row) { res.status(404).json({ error: 'Pedido não encontrado.' }); return; }
    if (row.mockup_storage_path) {
      await supabase.storage.from('site-assets').remove([row.mockup_storage_path]).catch(() => {});
    }
    const { error } = await supabase.from('pedidos').delete().eq('id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
