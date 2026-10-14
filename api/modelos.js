const { getSupabase, requireAuth, readJsonBody } = require('./_auth');

module.exports = async (req, res) => {
  const session = requireAuth(req, res, { role: 'vendedora' });
  if (!session) return;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const id = req.query && req.query.id;
    if (id) {
      const { data, error } = await supabase.from('modelos').select('*').eq('id', id).eq('vendedora_id', session.uid).maybeSingle();
      if (error) { res.status(500).json({ error: error.message }); return; }
      if (!data) { res.status(404).json({ error: 'Modelo não encontrado.' }); return; }
      res.status(200).json({ modelo: data });
      return;
    }
    const { data, error } = await supabase.from('modelos')
      .select('id,nome,gabarito_id,gabarito_label,criado_em')
      .eq('vendedora_id', session.uid)
      .order('criado_em', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ modelos: data });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const nome = (body.nome || '').trim().slice(0, 120);
    const gabarito_id = (body.gabaritoId || '').trim().slice(0, 60);
    const gabarito_label = (body.gabaritoLabel || '').trim().slice(0, 120);
    const design_json = body.designJson && typeof body.designJson === 'object' ? body.designJson : null;
    if (!nome || !gabarito_id || !design_json) { res.status(400).json({ error: 'Dados incompletos.' }); return; }
    const { data, error } = await supabase.from('modelos')
      .insert({ vendedora_id: session.uid, nome, gabarito_id, gabarito_label, design_json })
      .select('id,nome,gabarito_id,gabarito_label,criado_em').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ modelo: data });
    return;
  }

  if (req.method === 'DELETE') {
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    const { error } = await supabase.from('modelos').delete().eq('id', id).eq('vendedora_id', session.uid);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
