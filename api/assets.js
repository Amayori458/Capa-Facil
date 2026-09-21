const { getSupabase, requireAuth, readJsonBody } = require('./_auth');

const EXT_BY_MIME = {
  'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2',
  'application/font-woff': 'woff', 'application/x-font-ttf': 'ttf', 'application/octet-stream': 'bin',
};

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const session = requireAuth(req, res);
    if (!session) return;
    const supabase = getSupabase();
    const { data, error } = await supabase.from('ativos_padrao').select('id,tipo,nome,url,categoria,criado_em').order('criado_em', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ativos: data });
    return;
  }

  if (req.method === 'POST') {
    const session = requireAuth(req, res, { role: 'admin' });
    if (!session) return;
    const body = await readJsonBody(req);
    const tipo = body.tipo === 'fonte' ? 'fonte' : body.tipo === 'icone' ? 'icone' : null;
    const nome = (body.nome || '').trim().slice(0, 120);
    const categoria = (body.categoria || '').trim().slice(0, 60) || null;
    const dataUrl = body.dataUrl || '';
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!tipo || !nome || !match) { res.status(400).json({ error: 'Dados de upload inválidos.' }); return; }
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2.5 * 1024 * 1024) { res.status(400).json({ error: 'Arquivo muito grande (máx. 2,5MB).' }); return; }

    const path = tipo + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + (EXT_BY_MIME[mime] || 'bin');
    const supabase = getSupabase();
    const { error: upErr } = await supabase.storage.from('site-assets').upload(path, buffer, { contentType: mime, upsert: false });
    if (upErr) { res.status(500).json({ error: upErr.message }); return; }
    const { data: pub } = supabase.storage.from('site-assets').getPublicUrl(path);
    const { data, error } = await supabase.from('ativos_padrao')
      .insert({ tipo, nome, categoria, storage_path: path, url: pub.publicUrl, criado_por: session.uid })
      .select('id,tipo,nome,url,categoria,criado_em').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ativo: data });
    return;
  }

  if (req.method === 'PATCH') {
    const session = requireAuth(req, res, { role: 'admin' });
    if (!session) return;
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    const categoria = (body.categoria || '').trim().slice(0, 60) || null;
    const supabase = getSupabase();
    const { data, error } = await supabase.from('ativos_padrao')
      .update({ categoria }).eq('id', id)
      .select('id,tipo,nome,url,categoria,criado_em').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ativo: data });
    return;
  }

  if (req.method === 'DELETE') {
    const session = requireAuth(req, res, { role: 'admin' });
    if (!session) return;
    const body = await readJsonBody(req);
    const id = body.id;
    if (!id) { res.status(400).json({ error: 'ID obrigatório.' }); return; }
    const supabase = getSupabase();
    const { data: row } = await supabase.from('ativos_padrao').select('storage_path').eq('id', id).maybeSingle();
    if (row && row.storage_path) await supabase.storage.from('site-assets').remove([row.storage_path]);
    const { error } = await supabase.from('ativos_padrao').delete().eq('id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
