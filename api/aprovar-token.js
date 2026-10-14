const { getSupabase, readJsonBody } = require('./_auth');

// Rota pública (sem login) por trás do link mágico do WhatsApp — a cliente aprova/pede ajuste
// direto pelo celular. Só enxerga o UM pedido dono do token, nos mesmos campos que o fluxo
// autenticado de cliente já expõe (nunca design_json/mockup_storage_path), e só age enquanto
// o pedido está 'aguardando_aprovacao_cliente' — depois disso o token vira, na prática, inerte.
const PUBLIC_COLUMNS = 'id,numero_pedido,gabarito_label,mockup_url,status,motivo_reprovacao';

function validPonto(p){
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.xPct), y = Number(p.yPct);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { xPct: Math.round(x * 10) / 10, yPct: Math.round(y * 10) / 10 };
}

module.exports = async (req, res) => {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const token = req.query && req.query.token;
    if (!token) { res.status(400).json({ error: 'Link inválido.' }); return; }
    const { data, error } = await supabase.from('pedidos').select(PUBLIC_COLUMNS).eq('approval_token', token).maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: 'Link inválido ou expirado.' }); return; }
    res.status(200).json({ pedido: data });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const token = body.token;
    const action = body.action;
    if (!token || !['aprovar', 'reprovar'].includes(action)) { res.status(400).json({ error: 'Requisição inválida.' }); return; }
    const { data: row, error: findErr } = await supabase.from('pedidos').select('id,status,cliente_id').eq('approval_token', token).maybeSingle();
    if (findErr) { res.status(500).json({ error: findErr.message }); return; }
    if (!row) { res.status(404).json({ error: 'Link inválido ou expirado.' }); return; }
    if (row.status !== 'aguardando_aprovacao_cliente') { res.status(400).json({ error: 'Esse pedido já foi respondido — abra o site pra ver o status atual.' }); return; }

    const updates = {};
    if (action === 'aprovar') {
      updates.status = 'aprovado';
      updates.aprovado_por = row.cliente_id;
      updates.aprovado_em = new Date().toISOString();
      updates.motivo_reprovacao = null;
      updates.motivo_reprovacao_ponto = null;
    } else {
      const motivo = (body.motivo || '').trim().slice(0, 500);
      if (!motivo) { res.status(400).json({ error: 'Descreva o que precisa ajustar.' }); return; }
      updates.status = 'reprovado';
      updates.motivo_reprovacao = motivo;
      updates.motivo_reprovacao_ponto = validPonto(body.ponto);
    }
    const { error } = await supabase.from('pedidos').update(updates).eq('id', row.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
