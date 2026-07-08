'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { abrirTeste, encerrarTestes } = require('../db');
const { criarServidor } = require('../app-core');

let servidor, base;

before(async () => {
  const db = await abrirTeste();
  servidor = criarServidor(db);
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://localhost:${servidor.address().port}`;
});

after(() => servidor.close());

async function api(metodo, caminho, corpo, cookie) {
  const res = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: `aclame_sessao=${cookie}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const setCookie = res.headers.get('set-cookie');
  const token = setCookie ? (setCookie.match(/aclame_sessao=([^;]+)/) || [])[1] : null;
  return { status: res.status, json, token };
}

async function login(identificador, senha = '1234') {
  const r = await api('POST', '/api/auth/login', { identificador, senha });
  assert.equal(r.status, 200, `login de ${identificador} deve funcionar`);
  assert.ok(r.token, 'login devolve cookie de sessão');
  return { cookie: r.token, me: r.json };
}

test('autenticação, papéis e permissões', async (t) => {
  assert.equal((await api('POST', '/api/seed-demo')).status, 200);
  assert.equal((await api('POST', '/api/seed-demo')).status, 400, 'seed só roda em banco vazio');
  assert.equal((await api('GET', '/api/ocorrencias')).status, 401, 'sem sessão → 401');
  assert.equal((await api('POST', '/api/auth/login', { identificador: 'evandro@aclame.local', senha: 'errada' })).status, 401);

  const adm = await login('evandro@aclame.local');
  assert.equal(adm.me.papel, 'admin');
  const viv = await login('11999990002'); // Viviane por telefone — líder do Louvor
  assert.equal(viv.me.papel, 'lider');
  assert.ok(viv.me.ministerios_liderados.length >= 1);
  const kelly = await login('kelly@aclame.local');
  assert.equal(kelly.me.papel, 'membro');

  const me = await api('GET', '/api/auth/me', null, adm.cookie);
  assert.equal(me.json.nome, 'Evandro Silva');

  // Registro público: segundo usuário em diante nasce membro, com perfil de voluntário.
  const reg = await api('POST', '/api/auth/registrar', { nome: 'Novato Teste', telefone: '11999999999', senha: 'abcd' });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.papel, 'membro');
  assert.ok(reg.json.voluntario_id);
  assert.equal((await api('POST', '/api/auth/registrar', { nome: 'Dup', telefone: '11999999999', senha: 'abcd' })).status, 400);

  // Autorização por papel.
  assert.equal((await api('POST', '/api/ministerios', { nome: 'X' }, kelly.cookie)).status, 403, 'membro não cria ministério');
  assert.equal((await api('GET', '/api/usuarios', null, viv.cookie)).status, 403, 'gestão de usuários é só do admin');
  assert.equal((await api('GET', '/api/export', null, kelly.cookie)).status, 403);
  assert.ok((await api('GET', '/api/usuarios', null, adm.cookie)).json.length >= 5);

  // Logout invalida a sessão.
  const extra = await login('kelly@aclame.local');
  assert.equal((await api('POST', '/api/auth/logout', {}, extra.cookie)).status, 200);
  assert.equal((await api('GET', '/api/auth/me', null, extra.cookie)).status, 401);
});

test('bloqueio exige justificativa e respeita o dono da agenda', async () => {
  const kelly = await login('kelly@aclame.local');
  const clari = await login('clarianne@aclame.local');

  const semMotivo = await api('POST', '/api/bloqueios', { data: '2099-05-05' }, kelly.cookie);
  assert.equal(semMotivo.status, 400);
  assert.match(semMotivo.json.erro, /justificativa/i);

  const comMotivo = await api('POST', '/api/bloqueios', { data: '2099-05-05', motivo: 'Plantão no trabalho' }, kelly.cookie);
  assert.equal(comMotivo.status, 200);
  assert.equal(comMotivo.json.voluntario_id, kelly.me.voluntario_id);

  const alheio = await api('POST', '/api/bloqueios', { voluntario_id: clari.me.voluntario_id, data: '2099-05-05', motivo: 'x' }, kelly.cookie);
  assert.equal(alheio.status, 403, 'membro não bloqueia agenda alheia');
});

test('troca dirigida com prazo: Clarianne fica no lugar da Kelly', async () => {
  const adm = await login('evandro@aclame.local');
  const viv = await login('viviane@aclame.local');
  const kelly = await login('kelly@aclame.local');
  const clari = await login('clarianne@aclame.local');

  // Viviane (líder do Louvor) escala Kelly como Vocal no primeiro Culto de Doutrina.
  const ocs = await api('GET', '/api/ocorrencias', null, adm.cookie);
  const doutrina = ocs.json.find((o) => o.evento_nome === 'Culto de Doutrina');
  assert.ok(doutrina, 'seed gerou ocorrências do Culto de Doutrina');
  const det0 = await api('GET', `/api/ocorrencias/${doutrina.id}`, null, adm.cookie);
  const funcVocal = det0.json.necessidades.find((n) => n.funcao_nome === 'Vocal');
  assert.equal((await api('POST', `/api/ocorrencias/${doutrina.id}/escalar`,
    { voluntario_id: kelly.me.voluntario_id, funcao_id: funcVocal.funcao_id }, viv.cookie)).status, 200);

  const det1 = await api('GET', `/api/ocorrencias/${doutrina.id}`, null, adm.cookie);
  const linhaKelly = det1.json.escala.find((e) => e.voluntario_id === kelly.me.voluntario_id);

  // Só a dona (ou líder) mexe na escala.
  assert.equal((await api('POST', `/api/escala/${linhaKelly.id}/confirmar`, null, clari.cookie)).status, 403);
  assert.equal((await api('POST', `/api/escala/${linhaKelly.id}/confirmar`, null, kelly.cookie)).status, 200);

  // Kelly pede troca dirigida à Clarianne, com prazo até o dia do culto.
  const ped = await api('POST', `/api/escala/${linhaKelly.id}/solicitar-troca`,
    { motivo: 'Imprevisto em família', destinatario_id: clari.me.voluntario_id, prazo: doutrina.data }, kelly.cookie);
  assert.equal(ped.status, 200);

  const aguardando = await api('GET', '/api/trocas?status=aguardando', null, adm.cookie);
  const troca = aguardando.json.find((x) => x.id === ped.json.id);
  assert.equal(troca.solicitante_nome, 'Kelly Souza');
  assert.equal(troca.destinatario_nome, 'Clarianne Dias');
  assert.equal(troca.prazo, doutrina.data);
  assert.ok(troca.criada_em, 'data da solicitação registrada');

  // Um terceiro não pode aceitar troca dirigida; a destinatária pode.
  const novato = await api('POST', '/api/auth/login', { identificador: '11999999999', senha: 'abcd' });
  const tenta = await api('POST', `/api/trocas/${troca.id}/aceitar`, {}, novato.token);
  assert.ok(tenta.status >= 400);
  assert.match(tenta.json.erro, /dirigida/i);

  const aceite = await api('POST', `/api/trocas/${troca.id}/aceitar`, {}, clari.cookie);
  assert.equal(aceite.status, 200);
  assert.equal(aceite.json.status, 'aceita');
  assert.ok(aceite.json.resolvida_em, 'data da confirmação registrada');

  // A escala agora é da Clarianne, já confirmada — substituição clara.
  const det2 = await api('GET', `/api/ocorrencias/${doutrina.id}`, null, adm.cookie);
  const linhaAgora = det2.json.escala.find((e) => e.id === linhaKelly.id);
  assert.equal(linhaAgora.voluntario_nome, 'Clarianne Dias');
  assert.equal(linhaAgora.status, 'confirmado');

  // Candidatos ao mesmo culto sinalizam conflito de setor (mesmo_culto).
  const cands = await api('GET', `/api/ocorrencias/${doutrina.id}/candidatos?funcao_id=${funcVocal.funcao_id}`, null, viv.cookie);
  const clariCand = cands.json.find((c) => c.id === clari.me.voluntario_id);
  assert.equal(clariCand.mesmo_culto, true);

  // Kelly (solicitante) recebeu notificação com a frase de substituição.
  const notifs = await api('GET', `/api/voluntarios/${kelly.me.voluntario_id}/notificacoes`, null, kelly.cookie);
  assert.ok(notifs.json.some((n) => /Clarianne Dias fica no seu lugar/.test(n.mensagem)));
});

test('escala mensal por ministério respeita liderança', async () => {
  const viv = await login('viviane@aclame.local');
  const adm = await login('evandro@aclame.local');

  // Viviane não lidera a Mídia.
  const ministerios = await api('GET', '/api/ministerios', null, adm.cookie);
  const louvor = ministerios.json.find((m) => m.nome === 'Louvor');
  const midia = ministerios.json.find((m) => m.nome === 'Mídia');
  const proximoMes = new Date();
  proximoMes.setMonth(proximoMes.getMonth() + 1);
  const ano = proximoMes.getFullYear(), mes = proximoMes.getMonth() + 1;

  assert.equal((await api('POST', '/api/escala-mensal', { ministerio_id: midia.id, ano, mes }, viv.cookie)).status, 403);

  const r = await api('POST', '/api/escala-mensal', { ministerio_id: louvor.id, ano, mes }, viv.cookie);
  assert.equal(r.status, 200);
  assert.ok(r.json.ocorrencias > 0, 'materializou as ocorrências do mês');
  assert.ok(r.json.preenchidas > 0, 'preencheu vagas do Louvor');

  // Nenhuma função de outro ministério foi preenchida por essa geração no mês.
  const p = (n) => String(n).padStart(2, '0');
  const ocs = await api('GET', `/api/ocorrencias?de=${ano}-${p(mes)}-01&ate=${ano}-${p(mes)}-28`, null, adm.cookie);
  const det = await api('GET', `/api/ocorrencias/${ocs.json[0].id}`, null, adm.cookie);
  const ministeriosEscalados = new Set(det.json.escala.map((e) => e.ministerio_id));
  assert.ok([...ministeriosEscalados].every((m) => m === louvor.id), 'só Louvor');
});

test('roteiro do culto: oportunidades, louvores com tom, publicação no mural e texto WhatsApp', async () => {
  const adm = await login('evandro@aclame.local');

  // O seed publica um culto de domingo completo.
  const mural = await api('GET', '/api/mural', null, adm.cookie);
  assert.ok(mural.json.cultos.length >= 1, 'mural traz culto publicado');
  const culto = mural.json.cultos[0];
  assert.equal(culto.tema, 'Ceia do Senhor');
  assert.equal(culto.publicada_por_nome, 'Evandro Silva', 'autoria visível');

  const rot = await api('GET', `/api/ocorrencias/${culto.id}/whatsapp-roteiro`, null, adm.cookie);
  assert.match(rot.json.texto, /🛑 CULTO DIA \d{2}\/\d{2}-Domingo/);
  assert.match(rot.json.texto, /Oportunidades para o Culto/);
  assert.match(rot.json.texto, /1️⃣ Departamento Infantil/);
  assert.match(rot.json.texto, /2️⃣ Elielson: Devocional/);
  assert.match(rot.json.texto, /✅ Dízimos e Ofertas/);
  assert.match(rot.json.texto, /✅ Louvor/);
  assert.match(rot.json.texto, /Para que Entre o Rei da Glória \(G\)/);
  assert.match(rot.json.texto, /✅ Palavra: Pr\. Marciel/);

  // Editar roteiro + nova oportunidade + repertório com tom.
  assert.equal((await api('PUT', `/api/ocorrencias/${culto.id}`, { ministra: 'Irmã Sara' }, adm.cookie)).status, 200);
  const op = await api('POST', `/api/ocorrencias/${culto.id}/oportunidades`, { titulo: 'Testemunhos', responsavel: 'Aberto' }, adm.cookie);
  assert.equal(op.status, 200);

  const musicas = await api('GET', '/api/musicas', null, adm.cookie);
  const oceanos = musicas.json.find((m) => m.titulo === 'Oceanos');
  assert.equal((await api('POST', `/api/ocorrencias/${culto.id}/repertorio`, { musica_id: oceanos.id, tom: 'E' }, adm.cookie)).status, 200);
  const rot2 = await api('GET', `/api/ocorrencias/${culto.id}/whatsapp-roteiro`, null, adm.cookie);
  assert.match(rot2.json.texto, /Oceanos \(E\)/);
  assert.match(rot2.json.texto, /🎤 Ministração: Irmã Sara/);

  // Clonar culto para outra data: roteiro copiado, músicas referenciadas (não duplicadas).
  const totalMusicasAntes = (await api('GET', '/api/musicas', null, adm.cookie)).json.length;
  const clone = await api('POST', `/api/ocorrencias/${culto.id}/clonar`, { data: '2099-12-25' }, adm.cookie);
  assert.equal(clone.status, 200);
  const detClone = await api('GET', `/api/ocorrencias/${clone.json.id}`, null, adm.cookie);
  assert.equal(detClone.json.tema, 'Ceia do Senhor');
  assert.ok(detClone.json.repertorio.length >= 4);
  assert.equal((await api('GET', '/api/musicas', null, adm.cookie)).json.length, totalMusicasAntes, 'clonagem não duplica músicas');

  // Publicar o clone e conferir ordenação do mural (próximos antes dos distantes).
  assert.equal((await api('POST', `/api/ocorrencias/${clone.json.id}/publicar`, {}, adm.cookie)).status, 200);
  const mural2 = await api('GET', '/api/mural', null, adm.cookie);
  const datas = mural2.json.cultos.filter((c) => c.data >= '2026-01-01').map((c) => c.data);
  assert.deepEqual([...datas].sort(), datas, 'cultos futuros em ordem crescente de data');
});

test('estante: dedupe, convite WhatsApp e estatísticas', async () => {
  const adm = await login('evandro@aclame.local');
  const kelly = await login('kelly@aclame.local');

  // Dedupe por título+artista normalizados.
  const dup = await api('POST', '/api/musicas', { titulo: 'nao ha deus maior', artista: 'ADORACAO E ADORADORES' }, adm.cookie);
  assert.equal(dup.status, 400);
  assert.match(dup.json.erro, /já está na estante/i);
  assert.equal((await api('POST', '/api/musicas', { titulo: 'Canção Nova Única', artista: 'Teste' }, adm.cookie)).status, 200);
  assert.equal((await api('POST', '/api/musicas', { titulo: 'Outra', artista: 'X' }, kelly.cookie)).status, 403, 'membro não edita estante');

  // Convite WhatsApp de um escalado.
  const ocs = await api('GET', '/api/ocorrencias', null, adm.cookie);
  for (const oc of ocs.json) {
    const det = await api('GET', `/api/ocorrencias/${oc.id}`, null, adm.cookie);
    if (det.json.escala.length) {
      const conv = await api('GET', `/api/escala/${det.json.escala[0].id}/whatsapp`, null, adm.cookie);
      assert.equal(conv.status, 200);
      assert.match(conv.json.link, /^https:\/\/wa\.me\/55\d+\?text=/);
      break;
    }
  }

  // Estatísticas: tons e mais usadas alimentadas pelo repertório do seed.
  const est = await api('GET', '/api/estante/estatisticas', null, adm.cookie);
  assert.ok(est.json.tons.length >= 1);
  assert.ok(est.json.maisUsadas.some((m) => m.vezes >= 1));
  assert.ok(est.json.usoMensal.length >= 1);

  // Setlists.
  const sl = await api('POST', '/api/setlists', { nome: 'Ceia de Julho' }, adm.cookie);
  assert.equal(sl.status, 200);
  const musicas = await api('GET', '/api/musicas', null, adm.cookie);
  assert.equal((await api('POST', `/api/setlists/${sl.json.id}/musicas`, { musica_id: musicas.json[0].id, tom: 'G' }, adm.cookie)).status, 200);
  const itens = await api('GET', `/api/setlists/${sl.json.id}/musicas`, null, adm.cookie);
  assert.equal(itens.json.length, 1);
  assert.equal(itens.json[0].tom_execucao, 'G');

  // Dashboard continua respondendo.
  const dash = await api('GET', '/api/dashboard', null, adm.cookie);
  assert.ok(dash.json.kpis.voluntarios_ativos >= 17);
});

after(async () => { await encerrarTestes(); });
