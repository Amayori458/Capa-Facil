const crypto = require('crypto');
const { getSupabase, requireAuth, readJsonBody } = require('./_auth');

const EXT_BY_MIME = {
  'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2',
  'application/font-woff': 'woff', 'application/x-font-ttf': 'ttf', 'application/octet-stream': 'bin',
};

const ICON_MIMES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'];
const TEAM_CATEGORY = 'Enviados pela equipe';

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
    // Admin envia ícone ou fonte pra biblioteca do site. Vendedora também pode enviar ÍCONE: o que ela
    // importa no editor fica guardado aqui, na seção "Enviados pela equipe", pra todos usarem depois.
    const session = requireAuth(req, res, { roles: ['admin', 'vendedora'] });
    if (!session) return;
    const isAdmin = session.role === 'admin';
    const body = await readJsonBody(req);
    const tipo = body.tipo === 'fonte' ? 'fonte' : body.tipo === 'icone' ? 'icone' : null;
    const nome = (body.nome || '').trim().slice(0, 120);
    const categoria = isAdmin ? ((body.categoria || '').trim().slice(0, 60) || null) : TEAM_CATEGORY;
    const dataUrl = body.dataUrl || '';
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!tipo || !nome || !match) { res.status(400).json({ error: 'Dados de upload inválidos.' }); return; }
    if (!isAdmin && tipo !== 'icone') { res.status(403).json({ error: 'Só o admin pode enviar fontes.' }); return; }
    const mime = match[1];
    if (tipo === 'icone' && !ICON_MIMES.includes(mime)) { res.status(400).json({ error: 'Ícone precisa ser SVG, PNG, WebP ou JPG.' }); return; }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 3 * 1024 * 1024) { res.status(400).json({ error: 'Arquivo muito grande (máx. 3MB).' }); return; }
    if (mime === 'image/svg+xml' && /<script|<foreignObject|<iframe|\son[a-z]+\s*=|javascript:/i.test(buffer.toString('utf8'))) {
      res.status(400).json({ error: 'Esse SVG tem script ou conteúdo embutido e não pode ir pra biblioteca.' }); return;
    }
    const supabase = getSupabase();
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    const { data: igual } = await supabase.from('ativos_padrao').select('id,tipo,nome,url,categoria,criado_em').eq('tipo', tipo).eq('sha1', sha1).limit(1).maybeSingle();
    if (igual) { res.status(200).json({ ativo: igual, duplicado: true }); return; }
    if (!isAdmin) {
      const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await supabase.from('ativos_padrao').select('id', { count: 'exact', head: true }).eq('criado_por', session.uid).gte('criado_em', desde);
      if (count >= 60) { res.status(429).json({ error: 'Limite diário de ícones enviados atingido.' }); return; }
    }

    const path = tipo + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + (EXT_BY_MIME[mime] || 'bin');
    const { error: upErr } = await supabase.storage.from('site-assets').upload(path, buffer, { contentType: mime, upsert: false });
    if (upErr) { res.status(500).json({ error: upErr.message }); return; }
    const { data: pub } = supabase.storage.from('site-assets').getPublicUrl(path);
    const { data, error } = await supabase.from('ativos_padrao')
      .insert({ tipo, nome, categoria, storage_path: path, url: pub.publicUrl, criado_por: session.uid, sha1 })
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
