'use strict';
/* Aclame — SPA (vanilla JS, sem build). */

const estado = { me: null };

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// ===== Utilidades =====
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hojeISO(desloc = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desloc);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return `${DIAS_CURTOS[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}
function fmtDataHora(ts) {
  if (!ts) return '';
  const [data, hora] = ts.split(' ');
  const [a, m, d] = data.split('-');
  return `${d}/${m}/${a} ${(hora || '').slice(0, 5)}`;
}
function estrelas(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

// Cor de exibição dos acordes na cifra (preferência local do usuário).
const COR_ACORDE_PADRAO = '#ff9633'; // laranja estilo Cifra Club
function corAcordeAtual() { return localStorage.getItem('aclame_cor_acorde') || COR_ACORDE_PADRAO; }
function setCorAcorde(cor) {
  localStorage.setItem('aclame_cor_acorde', cor);
  document.documentElement.style.setProperty('--cor-acorde', cor);
}
const ehLider = () => estado.me && (estado.me.papel === 'lider' || estado.me.papel === 'admin');
const ehAdmin = () => estado.me && estado.me.papel === 'admin';
const meuVol = () => estado.me?.voluntario_id;

async function api(metodo, caminho, corpo) {
  const res = await fetch(caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { mostrarLogin(); const e = new Error(json.erro || 'Sessão expirada'); e.auth = true; throw e; }
  if (!res.ok) throw new Error(json.erro || `Erro ${res.status}`);
  return json;
}

function toast(msg, erro = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

async function tentar(fn, msgOk) {
  try {
    const r = await fn();
    if (msgOk) toast(msgOk);
    return r;
  } catch (e) {
    if (!e.auth) toast(e.message, true);
    return null;
  }
}

// ===== Modal / tooltip =====
function abrirModal(html) {
  const fundo = document.getElementById('modal-fundo');
  const modal = document.getElementById('modal');
  modal.innerHTML = html;
  fundo.classList.remove('oculto');
  return modal;
}
function fecharModal() { document.getElementById('modal-fundo').classList.add('oculto'); }
document.getElementById('modal-fundo').addEventListener('click', (e) => {
  if (e.target.id === 'modal-fundo') fecharModal();
});

const tooltip = document.getElementById('tooltip');
function ligarTooltip(elemento, texto) {
  elemento.addEventListener('mousemove', (e) => {
    tooltip.textContent = texto;
    tooltip.classList.remove('oculto');
    tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
  });
  elemento.addEventListener('mouseleave', () => tooltip.classList.add('oculto'));
}

// Gráfico de barras horizontais (dataviz): série única, rótulo direto por barra.
function grafBarras(titulo, dados, { classe = '', unidade = '' } = {}) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const div = document.createElement('div');
  div.className = 'grafico';
  div.innerHTML = `<h3>${esc(titulo)}</h3>`;
  if (!dados.length) div.innerHTML += '<p class="vazio">Sem dados ainda.</p>';
  for (const d of dados) {
    const linha = document.createElement('div');
    linha.className = 'linha-barra';
    linha.innerHTML = `
      <div class="nome">${esc(d.nome)}</div>
      <div class="trilha"><div class="barra ${classe}" style="width:${(d.valor / max) * 100}%"></div></div>
      <div class="num">${d.valor}</div>`;
    ligarTooltip(linha.querySelector('.trilha'), `${d.nome}: ${d.valor}${unidade}`);
    div.appendChild(linha);
  }
  return div;
}

function cabecalho(alvo, titulo, sub, botoesHtml = '') {
  alvo.innerHTML = `
    <div class="cabecalho-pagina">
      <div><h1>${titulo}</h1><p class="subtitulo">${sub}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${botoesHtml}</div>
    </div>`;
}

const autoria = (nome, quando, verbo = 'criado') =>
  nome ? `<span class="autoria">${verbo} por <strong>${esc(nome)}</strong>${quando ? ' · ' + fmtDataHora(quando) : ''}</span>` : '';

// ===== Login =====
function mostrarLogin() {
  estado.me = null;
  document.getElementById('tela-app').classList.add('oculto');
  document.getElementById('tela-login').classList.remove('oculto');
}
function mostrarApp() {
  document.getElementById('tela-login').classList.add('oculto');
  document.getElementById('tela-app').classList.remove('oculto');
  const iniciais = estado.me.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const PAPEIS = { admin: 'Administrador', lider: 'Líder', membro: 'Membro' };
  document.getElementById('usuario-chip').innerHTML =
    `<span class="avatar">${esc(iniciais)}</span> ${esc(estado.me.nome.split(' ')[0])} <span class="papel">· ${PAPEIS[estado.me.papel]}</span>`;
  renderNav();
  atualizarSino();
}

document.getElementById('li-ir-registro').onclick = (e) => {
  e.preventDefault();
  document.getElementById('login-form').classList.add('oculto');
  document.getElementById('registro-form').classList.remove('oculto');
};
document.getElementById('li-ir-login').onclick = (e) => {
  e.preventDefault();
  document.getElementById('registro-form').classList.add('oculto');
  document.getElementById('login-form').classList.remove('oculto');
};
document.getElementById('li-entrar').onclick = async () => {
  const r = await tentar(() => api('POST', '/api/auth/login', {
    identificador: document.getElementById('li-ident').value.trim(),
    senha: document.getElementById('li-senha').value,
  }));
  if (r) { estado.me = r; mostrarApp(); irParaInicio(); }
};
document.getElementById('li-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('li-entrar').click(); });
document.getElementById('re-criar').onclick = async () => {
  const r = await tentar(() => api('POST', '/api/auth/registrar', {
    nome: document.getElementById('re-nome').value.trim(),
    telefone: document.getElementById('re-fone').value.trim() || null,
    email: document.getElementById('re-email').value.trim() || null,
    senha: document.getElementById('re-senha').value,
    convite: estado.convite || null,
  }), 'Conta criada! Bem-vindo(a) ao Aclame 🙌');
  if (r) {
    estado.convite = null;
    history.replaceState(null, '', location.pathname + location.hash);
    estado.me = r; mostrarApp(); irParaInicio();
  }
};
document.getElementById('btn-sair').onclick = async () => {
  await tentar(() => api('POST', '/api/auth/logout', {}));
  location.hash = '';
  mostrarLogin();
};
document.getElementById('btn-sino').onclick = () => { location.hash = '#/notificacoes'; };

function irParaInicio() {
  const destino = ehLider() ? '#/dashboard' : '#/mural';
  if (location.hash === destino) navegar(); else location.hash = destino;
}

// ===== Navegação =====
// 4 abas mestres; as telas antigas viram sub-abas do grupo ativo (nenhuma rota
// foi removida — rotas de detalhe como #/culto/1 acendem o grupo via `prefixos`).
// Ícones Lucide embutidos como SVG (herdam cor via currentColor; app segue sem CDN).
const ICONES_NAV = {
  visao: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
  escalas: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
  voluntarios: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/><path d="m18 15-2-2"/><path d="m15 18-2-2"/></svg>',
  louvor: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><path d="m9 9 12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

function renderNav() {
  const grupos = [
    {
      icone: ICONES_NAV.visao, rotulo: 'Visão Geral',
      principal: ehLider() ? '#/dashboard' : '#/mural',
      prefixos: ['#/dashboard', '#/mural', '#/notificacoes', '#/feedbacks'],
      itens: [
        ['#/dashboard', 'Painel de indicadores', ehLider()],
        ['#/mural', 'Mural da igreja', true],
        ['#/notificacoes', 'Notificações', true],
        ['#/feedbacks', 'Feedbacks', ehLider()],
      ],
    },
    {
      icone: ICONES_NAV.escalas, rotulo: 'Escalas do Mês',
      principal: ehLider() ? '#/escala-mensal' : '#/agenda',
      prefixos: ['#/escala-mensal', '#/escalas', '#/agenda', '#/disponibilidade',
        '#/trocas', '#/indisponibilidades', '#/eventos', '#/culto/'],
      itens: [
        ['#/escala-mensal', 'Escala do mês', ehLider()],
        ['#/escalas', 'Cultos & escalas', ehLider()],
        ['#/agenda', 'Minha agenda', true],
        ['#/disponibilidade', 'Disponibilidade', true],
        ['#/trocas', 'Trocas', true],
        ['#/indisponibilidades', 'Indisponibilidades', ehLider()],
        ['#/eventos', 'Celebrações', ehLider()],
      ],
    },
    {
      icone: ICONES_NAV.voluntarios, rotulo: 'Gestão de Voluntários',
      principal: ehLider() ? '#/voluntarios' : '#/habilidades',
      prefixos: ['#/voluntarios', '#/voluntario/', '#/habilidades', '#/pontos',
        '#/ministerios', '#/usuarios'],
      itens: [
        ['#/voluntarios', 'Voluntários', ehLider()],
        ['#/habilidades', 'Habilidades', true],
        ['#/pontos', 'Pontos', true],
        ['#/ministerios', 'Ministérios', ehLider()],
        ['#/usuarios', 'Usuários & papéis', ehAdmin()],
      ],
    },
    {
      icone: ICONES_NAV.louvor, rotulo: 'Ministério de Louvor',
      principal: '#/estante',
      prefixos: ['#/estante', '#/setlists', '#/musica/'],
      itens: [
        ['#/estante', 'Estante musical', true],
        ['#/setlists', 'Setlists', true],
      ],
    },
  ];
  const hash = location.hash || '#/mural';
  document.getElementById('sidebar').innerHTML =
    '<div class="sidebar-marca"><img src="/logo.png" alt="Logo ACLAME"><span>IPR Cáceres - MT</span></div>' +
    grupos.map((g) => {
      const ativa = g.prefixos.some((p) => hash.startsWith(p));
      const subs = ativa
        ? `<div class="sub-abas">${g.itens.filter(([, , visivel]) => visivel).map(([h, rotulo]) =>
          `<a href="${h}" class="${hash.startsWith(h) ? 'ativa' : ''}">${rotulo}</a>`).join('')}</div>`
        : '';
      return `<a href="${g.principal}" class="aba-mestre ${ativa ? 'ativa' : ''}">${g.icone}<span>${g.rotulo}</span></a>${subs}`;
    }).join('');
}

async function atualizarSino() {
  const badge = document.getElementById('sino-badge');
  if (!meuVol()) { badge.classList.add('oculto'); return; }
  const notifs = await api('GET', `/api/voluntarios/${meuVol()}/notificacoes`).catch(() => []);
  const naoLidas = notifs.filter((n) => !n.lida).length;
  badge.textContent = naoLidas;
  badge.classList.toggle('oculto', naoLidas === 0);
}

// ===== Roteador =====
const ROTAS = [];
function rota(re, fn) { ROTAS.push({ re, fn }); }

async function navegar() {
  if (!estado.me) return;
  let hash = location.hash;
  if (!hash || hash === '#/') { irParaInicio(); return; }
  renderNav();
  atualizarSino();
  // Recria o contêiner para descartar listeners de views anteriores.
  const velho = document.getElementById('conteudo');
  const alvo = velho.cloneNode(false);
  velho.replaceWith(alvo);
  for (const r of ROTAS) {
    const m = hash.match(r.re);
    if (m) {
      alvo.innerHTML = '<p class="vazio">Carregando…</p>';
      try { await r.fn(alvo, ...m.slice(1)); } catch (e) { if (!e.auth) alvo.innerHTML = `<p class="vazio">Erro: ${esc(e.message)}</p>`; }
      return;
    }
  }
  alvo.innerHTML = '<p class="vazio">Página não encontrada.</p>';
}
window.addEventListener('hashchange', navegar);

// =====================================================================
// MURAL
// =====================================================================
rota(/^#\/mural$/, async (alvo) => {
  const mesAtual = Number(hojeISO().slice(5, 7));
  const [mural, ministerios, anivs] = await Promise.all([
    api('GET', '/api/mural'), api('GET', '/api/ministerios'),
    api('GET', `/api/aniversariantes?mes=${mesAtual}`).catch(() => []),
  ]);
  cabecalho(alvo, 'Mural', 'Escalas publicadas e avisos — tudo num só lugar.',
    ehLider() ? '<button class="botao primario" id="btn-aviso">+ Aviso</button>' : '');
  if (ehLider()) document.getElementById('btn-aviso').onclick = () => formAviso(ministerios);

  // Avisos primeiro (antes da grade de cultos).
  alvo.insertAdjacentHTML('beforeend', '<h2>Avisos</h2>');
  const nomeMin = (id) => ministerios.find((x) => x.id === id)?.nome;
  if (!mural.avisos.length) alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhum aviso.</p>');
  for (const a of mural.avisos) {
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><strong>${esc(a.titulo)}</strong>
          <span class="selo neutro">${a.ministerio_id ? esc(nomeMin(a.ministerio_id)) : 'Geral'}</span>
          <div style="margin-top:6px;white-space:pre-wrap">${esc(a.mensagem || '')}</div>
          <div class="autoria" style="margin-top:6px">por <strong>${esc(a.criado_por_nome || '—')}</strong> · ${fmtDataHora(a.criado_em)}</div></div>
        ${ehLider() ? `<button class="botao mini perigo" data-del-aviso="${a.id}">Excluir</button>` : ''}
      </div>`;
    alvo.appendChild(card);
  }
  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del-aviso]');
    if (!btn) return;
    if (await tentar(() => api('DELETE', `/api/avisos/${btn.dataset.delAviso}`), 'Aviso excluído.')) navegar();
  });

  // Aniversariantes do mês
  if (anivs.length) {
    const NOMES_MES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    alvo.insertAdjacentHTML('beforeend', `<h2>🎂 Aniversariantes de ${NOMES_MES[mesAtual]}</h2>
      <div class="cartao">${anivs.map((a) => `<div class="item-lista">
        <strong>${esc(a.nome)}</strong> — ${String(a.dia).padStart(2, '0')} de ${NOMES_MES[a.mes]}
        <span class="selo ${a.dias_ate === 0 ? 'confirmado' : 'neutro'}">${
          a.dias_ate === 0 ? '🎉 é hoje!' : a.dias_ate > 0 && a.dias_ate <= 60 ? `daqui a ${a.dias_ate} dia(s)` : 'já passou este ano'
        }</span></div>`).join('')}</div>`);
  }

  // Cultos — grade de calendário mensal (substitui a lista cronológica).
  alvo.insertAdjacentHTML('beforeend', '<h2>Escalas publicadas</h2>');
  if (!mural.cultos.length) {
    alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhum culto publicado ainda.</p>');
  } else {
    const contCal = document.createElement('div');
    alvo.appendChild(contCal);
    const mesBase = alvo.dataset.mesMural ? new Date(alvo.dataset.mesMural + '-15T12:00:00') : new Date();
    renderMuralCalendario(contCal, mesBase, mural.cultos, alvo);
  }
});

// A API de /api/mural não filtra por mês (devolve tudo já publicado); o
// filtro por mês é só client-side, sem refetch — os dados já estão em mãos.
function renderMuralCalendario(cont, mesBase, cultos, alvoPai) {
  const ano = mesBase.getFullYear(), mes = mesBase.getMonth();
  const nomeMes = mesBase.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const p2 = (n) => String(n).padStart(2, '0');
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const hoje = hojeISO();

  const porDia = {};
  for (const c of cultos) (porDia[c.data] ||= []).push(c);
  // Dentro do dia, o "mais recente" é o publicado por último (mais novo no mural).
  for (const lista of Object.values(porDia)) lista.sort((a, b) => (b.publicada_em || '').localeCompare(a.publicada_em || ''));

  let grade = DIAS.map((d) => `<div class="cal-dia-nome">${d.slice(0, 3)}</div>`).join('');
  for (let i = 0; i < primeiroDia; i++) grade += '<div class="cal-dia fora"></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const iso = `${ano}-${p2(mes + 1)}-${p2(d)}`;
    const doDia = porDia[iso] || [];
    const principal = doDia[0];
    const extra = doDia.length - 1;
    const passado = iso < hoje;
    grade += `<div class="cal-dia ${principal ? 'tem-culto' : ''} ${passado ? 'passado' : ''} ${iso === hoje ? 'hoje' : ''}"
      data-dia="${principal ? iso : ''}">
      ${d}
      ${principal ? `<span class="cal-culto-info">${principal.hora_inicio} ${esc(principal.evento_nome)}</span>` : ''}
      ${extra > 0 ? `<span class="cal-badge-mais">+${extra}</span>` : ''}
    </div>`;
  }
  cont.innerHTML = `<div class="cartao">
    <div class="cal-cab">
      <button class="botao mini" id="mural-cal-ant">← anterior</button>
      <strong style="text-transform:capitalize">${esc(nomeMes)}</strong>
      <button class="botao mini" id="mural-cal-prox">próximo →</button>
    </div>
    <div class="cal-grade">${grade}</div>
  </div>`;

  const trocarMes = (delta) => {
    const novo = new Date(ano, mes + delta, 15);
    alvoPai.dataset.mesMural = `${novo.getFullYear()}-${p2(novo.getMonth() + 1)}`;
    renderMuralCalendario(cont, novo, cultos, alvoPai);
  };
  cont.querySelector('#mural-cal-ant').onclick = () => trocarMes(-1);
  cont.querySelector('#mural-cal-prox').onclick = () => trocarMes(1);
  cont.querySelector('.cal-grade').addEventListener('click', (e) => {
    const dia = e.target.closest('.cal-dia');
    if (!dia || !dia.dataset.dia) return;
    abrirModalDiaMural(dia.dataset.dia, porDia[dia.dataset.dia]);
  });
}

function abrirModalDiaMural(iso, cultosDoDia) {
  const m = abrirModal(`<h2>${fmtData(iso)}</h2>
    ${cultosDoDia.map((c) => `<div class="cartao cartao-clicavel" data-ir-culto="${c.id}">
      <strong>${esc(c.evento_nome)}</strong> ${c.tema ? `<span class="selo destaque">${esc(c.tema)}</span>` : ''}
      <div class="meta">${esc(c.local_nome || '')} · ${c.hora_inicio} ${c.responsavel ? '· 🎯 ' + esc(c.responsavel) : ''} ${c.pregador ? '· 📖 ' + esc(c.pregador) : ''}</div>
      <span class="selo neutro">${c.escalados} escalado(s)</span>
      <div class="autoria">publicado por <strong>${esc(c.publicada_por_nome || '—')}</strong> · ${fmtDataHora(c.publicada_em)}</div>
    </div>`).join('')}
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button></div>`);
  m.querySelectorAll('[data-ir-culto]').forEach((el) => {
    el.onclick = () => { fecharModal(); location.hash = `#/culto/${el.dataset.irCulto}`; };
  });
}

function formAviso(ministerios) {
  const m = abrirModal(`<h2>Novo aviso</h2>
    <div class="form-linha"><label>Ministério</label><select id="a-min">
      <option value="">Todos (aviso geral)</option>
      ${ministerios.map((mi) => `<option value="${mi.id}">${esc(mi.nome)}</option>`).join('')}</select></div>
    <div class="form-linha"><label>Título</label><input id="a-titulo"></div>
    <div class="form-linha"><label>Mensagem</label><textarea id="a-msg"></textarea></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="a-ok">Publicar</button></div>`);
  m.querySelector('#a-ok').onclick = async () => {
    const titulo = m.querySelector('#a-titulo').value.trim();
    if (!titulo) return toast('Informe o título.', true);
    if (await tentar(() => api('POST', '/api/avisos', {
      ministerio_id: m.querySelector('#a-min').value ? Number(m.querySelector('#a-min').value) : null,
      titulo, mensagem: m.querySelector('#a-msg').value,
    }), 'Aviso publicado.')) { fecharModal(); navegar(); }
  };
}

// =====================================================================
// CULTO — roteiro (timeline) + escala
// =====================================================================
rota(/^#\/culto\/(\d+)$/, async (alvo, id) => {
  const oc = await api('GET', `/api/ocorrencias/${id}`);
  const fuiEscalado = oc.escala.some((e) => e.voluntario_id === meuVol() && e.status !== 'recusado');
  const btnAvaliar = fuiEscalado && oc.data <= hojeISO()
    ? `<button class="botao" id="btn-avaliar">⭐ ${oc.meu_feedback ? `Editar avaliação (${estrelas(oc.meu_feedback.nota)})` : 'Avaliar culto'}</button>` : '';
  const botoes = ehLider() ? `
    <button class="botao" id="btn-dados">✏️ Dados do culto</button>
    <button class="botao" id="btn-clonar">🧬 Clonar</button>
    <button class="botao" id="btn-gcal">📆 Google Agenda</button>
    <button class="botao" id="btn-zap">📋 Copiar p/ WhatsApp</button>
    ${oc.repertorio.length ? '<button class="botao" id="btn-setlist">🎶 Setlist p/ equipe</button>' : ''}
    ${btnAvaliar}
    <button class="botao ${oc.publicada_em ? '' : 'primario'}" id="btn-publicar">${oc.publicada_em ? 'Despublicar' : '📢 Publicar no mural'}</button>
    <button class="botao primario" id="btn-gerar">⚡ Gerar escala</button>` :
    `<button class="botao" id="btn-gcal">📆 Google Agenda</button>
     <button class="botao" id="btn-zap">📋 Copiar p/ WhatsApp</button>
     ${btnAvaliar}`;
  cabecalho(alvo, `${esc(oc.evento_nome)} ${oc.tema ? `<span class="selo destaque">${esc(oc.tema)}</span>` : ''}`,
    `${fmtData(oc.data)} às ${oc.hora_inicio} · ${esc(oc.local_nome || 'sem local')}` +
    ` &nbsp; ${autoria(oc.criado_por_nome, oc.criado_em)}` +
    (oc.publicada_em ? ` &nbsp; ${autoria(oc.publicada_por_nome, oc.publicada_em, '📢 publicado')}` : ''),
    botoes);

  // Alerta de pendências do culto (tratativas para o líder).
  if (ehLider() && oc.pendencias.length && oc.data >= hojeISO()) {
    alvo.insertAdjacentHTML('beforeend', `<div class="cartao" style="border-color:var(--critico)">
      <strong>⚠️ Pendências deste culto</strong>
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${
        oc.pendencias.map((pd) => `<span class="selo ${pd.tipo === 'vaga' || pd.tipo === 'louvores' ? 'recusado' : 'aviso'}">${esc(pd.texto)}</span>`).join(' ')
      }</div>
      <p class="meta" style="margin-top:6px">Tratativas: preencha as vagas em “+ Escalar” ou “⚡ Gerar escala”, adicione os louvores em “+ Louvor” e publique no mural quando estiver completo.</p>
    </div>`);
  }

  const btnAv = document.getElementById('btn-avaliar');
  if (btnAv) btnAv.onclick = () => abrirFeedback(oc.id, oc.meu_feedback);
  const btnSet = document.getElementById('btn-setlist');
  if (btnSet) btnSet.onclick = async () => {
    const r = await tentar(() => api('GET', `/api/ocorrencias/${id}/whatsapp-setlist`));
    if (!r) return;
    const m = abrirModal(`<h2>🎶 Setlist aprovada — enviar para a equipe</h2>
      <p class="meta">Cada escalado recebe a lista dos louvores para estudo com o <strong>tom fixado</strong> e os links de cifra e letra.</p>
      <pre class="letra" style="max-height:200px;overflow:auto">${esc(r.texto)}</pre>
      <div class="form-acoes" style="justify-content:flex-start"><button class="botao" id="sl-copiar">📋 Copiar texto (grupo)</button></div>
      <strong>Enviar individualmente:</strong>
      ${r.destinatarios.map((d) => `<div class="slot"><div>${esc(d.nome)} <span class="meta">${esc(d.funcoes)}</span></div>
        ${d.link ? `<a class="botao mini whatsapp" href="${esc(d.link)}" target="_blank">📲 WhatsApp</a>`
          : '<span class="selo neutro">sem telefone</span>'}</div>`).join('')}
      <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button></div>`);
    m.querySelector('#sl-copiar').onclick = async () => {
      try { await navigator.clipboard.writeText(r.texto); toast('Setlist copiada! Cole no grupo. 📲'); } catch { /* já visível no modal */ }
    };
  };

  document.getElementById('btn-gcal').onclick = async () => {
    const r = await tentar(() => api('GET', `/api/ocorrencias/${id}/google-agenda`));
    if (r) window.open(r.url, '_blank');
  };
  document.getElementById('btn-zap').onclick = async () => {
    const r = await tentar(() => api('GET', `/api/ocorrencias/${id}/whatsapp-roteiro`));
    if (r) {
      try { await navigator.clipboard.writeText(r.texto); toast('Roteiro copiado! Cole no grupo do WhatsApp. 📲'); }
      catch { abrirModal(`<h2>Roteiro</h2><pre class="letra">${esc(r.texto)}</pre><div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button></div>`); }
    }
  };
  if (ehLider()) {
    document.getElementById('btn-dados').onclick = () => formDadosCulto(oc);
    document.getElementById('btn-publicar').onclick = async () => {
      const acao = oc.publicada_em ? 'despublicar' : 'publicar';
      if (await tentar(() => api('POST', `/api/ocorrencias/${id}/${acao}`, {}), acao === 'publicar' ? 'Culto publicado no mural! 📢' : 'Culto despublicado.')) navegar();
    };
    document.getElementById('btn-clonar').onclick = () => {
      const m = abrirModal(`<h2>Clonar culto</h2>
        <p class="meta">Copia tema, roteiro, oportunidades e louvores (as músicas são referenciadas, nunca duplicadas).</p>
        <div class="form-linha"><label>Nova data</label><input type="date" id="cl-data"></div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="cl-ok">Clonar</button></div>`);
      m.querySelector('#cl-ok').onclick = async () => {
        const data = m.querySelector('#cl-data').value;
        if (!data) return toast('Escolha a data.', true);
        const r = await tentar(() => api('POST', `/api/ocorrencias/${id}/clonar`, { data }), 'Culto clonado!');
        if (r) { fecharModal(); location.hash = `#/culto/${r.id}`; }
      };
    };
    document.getElementById('btn-gerar').onclick = () => abrirGerarEscala(oc);
  }

  // ---------- Timeline do roteiro ----------
  const rot = document.createElement('div');
  rot.className = 'roteiro';
  rot.style.marginTop = '8px';
  const item = (ico, titulo, corpoHtml = '', acoesHtml = '') => `
    <div class="rot-item"><div class="rot-ico">${ico}</div>
      <div class="rot-corpo"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="flex:1"><div class="rot-titulo">${titulo}</div>${corpoHtml}</div>
        <div style="display:flex;gap:6px">${acoesHtml}</div>
      </div></div></div>`;
  const NUM = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  let html = '';
  html += item('🎤', 'Abertura', oc.abertura ? `<div>${esc(oc.abertura)}</div>` : '<div class="vazio">A definir</div>');
  const opsHtml = oc.oportunidades.map((op, i) =>
    `<li>${NUM[i + 1] || (i + 1) + '.'} ${op.responsavel ? `<strong>${esc(op.responsavel)}</strong>: ` : ''}${esc(op.titulo)}
     ${ehLider() ? `<button class="botao mini perigo" data-del-op="${op.id}">×</button>` : ''}</li>`).join('');
  html += item('📋', 'Oportunidades para o culto',
    oc.oportunidades.length ? `<ul class="rot-lista">${opsHtml}</ul>` : '<div class="vazio">Nenhuma oportunidade.</div>',
    ehLider() ? '<button class="botao mini" id="btn-add-op">+ Adicionar</button>' : '');
  html += item('💰', 'Dízimos e Ofertas');
  const louvHtml = oc.repertorio.map((mu, i) =>
    `<li>${NUM[i + 1] || (i + 1) + '.'} <a href="#/musica/${mu.id}">${esc(mu.titulo)}</a>
      ${mu.tom_execucao ? `<span class="selo destaque">Tom ${esc(mu.tom_execucao)}</span>` : ''}
      ${mu.ministro_nome ? `<span class="selo confirmado">🎤 min. ${esc(mu.ministro_nome.split(' ')[0])}</span>` : ''}
      <span class="meta">${esc(mu.artista || '')}</span>
      ${ehLider() ? `<button class="botao mini" data-tom-rep="${mu.repertorio_id}" data-tom-atual="${esc(mu.tom_execucao || mu.tom || '')}">tom</button>
      <button class="botao mini" data-min-rep="${mu.repertorio_id}" data-min-atual="${mu.ministro_voluntario_id || ''}">min.</button>
      <button class="botao mini perigo" data-del-rep="${mu.repertorio_id}">×</button>` : ''}</li>`).join('');
  html += item('🎵', 'Louvor',
    oc.repertorio.length ? `<ul class="rot-lista">${louvHtml}</ul>` : '<div class="vazio">Sem louvores definidos.</div>',
    ehLider() ? '<button class="botao mini" id="btn-add-louvor">+ Louvor</button>' : '');
  html += item('📖', 'Palavra', oc.pregador ? `<div><strong>${esc(oc.pregador)}</strong></div>` : '<div class="vazio">A definir</div>');
  if (oc.ministra) html += item('🙏', 'Ministração', `<div>${esc(oc.ministra)}</div>`);
  if (oc.responsavel) html += item('🎯', 'Responsabilidade do culto', `<div>${esc(oc.responsavel)}</div>`);
  if (oc.observacoes) html += item('📝', 'Observações', `<div style="white-space:pre-wrap">${esc(oc.observacoes)}</div>`);
  rot.innerHTML = html;
  alvo.appendChild(rot);

  // ---------- Escala por função ----------
  alvo.insertAdjacentHTML('beforeend', '<h2>Escala do culto</h2>');
  for (const need of oc.necessidades) {
    const linhas = oc.escala.filter((e) => e.funcao_id === need.funcao_id);
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <strong><span class="ponto-cor" style="background:${esc(need.cor)}"></span>${esc(need.funcao_nome)}
        <span class="meta">(${esc(need.ministerio_nome)} · ${linhas.filter((l) => l.status !== 'recusado').length}/${need.quantidade})</span></strong>
      ${ehLider() ? `<button class="botao mini" data-escalar="${need.funcao_id}">+ Escalar</button>` : ''}
    </div>`;
    const cultoPassado = oc.data <= hojeISO();
    for (const l of linhas) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `
        <div>${esc(l.voluntario_nome)}
          <span class="selo ${l.status}">${l.status}</span>
          ${l.checkin_em ? '<span class="selo confirmado">✔ check-in</span>' : ''}
          ${l.faltou ? '<span class="selo recusado">✗ faltou</span>' : ''}
          ${l.troca_aberta ? '<span class="selo aguardando">troca aguardando</span>' : ''}
          ${l.conflito ? '<span class="selo recusado">⚠ conflito de horário</span>' : ''}
          ${l.indisponivel ? '<span class="selo aviso">⚠ fora da disponibilidade</span>' : ''}
        </div>
        <div class="acoes">
          ${ehLider() && cultoPassado && !l.checkin_em && !l.faltou && l.status !== 'recusado' ? `<button class="botao mini perigo" data-falta="${l.id}">Registrar falta</button>` : ''}
          ${ehLider() && l.faltou ? `<button class="botao mini" data-desfalta="${l.id}">Desmarcar falta</button>` : ''}
          ${ehLider() && l.telefone ? `<button class="botao mini whatsapp" data-zap="${l.id}">📲</button>` : ''}
          ${ehLider() ? `<button class="botao mini perigo" data-remover="${l.id}">Remover</button>` : ''}
        </div>`;
      card.appendChild(slot);
    }
    if (!linhas.length) card.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhum voluntário escalado.</p>');
    alvo.appendChild(card);
  }

  // ---------- Comentários ----------
  alvo.insertAdjacentHTML('beforeend', `<h2>💬 Comentários (${oc.comentarios.length})</h2>`);
  const cardCom = document.createElement('div');
  cardCom.className = 'cartao';
  cardCom.innerHTML = `
    ${oc.comentarios.map((c) => `<div class="item-lista">
      <strong>${esc(c.usuario_nome)}</strong> <span class="quando">· ${fmtDataHora(c.criado_em)}</span>
      ${(ehLider() || c.usuario_id === estado.me.id) ? `<button class="botao mini perigo" style="float:right" data-del-com="${c.id}">×</button>` : ''}
      <div style="margin-top:4px;white-space:pre-wrap">${esc(c.texto)}</div>
    </div>`).join('') || '<p class="vazio">Nenhum comentário ainda.</p>'}
    <div style="display:flex;gap:8px;margin-top:12px">
      <input id="com-texto" placeholder="Escreva um comentário para a equipe…" style="flex:1">
      <button class="botao primario" id="com-enviar">Enviar</button>
    </div>`;
  alvo.appendChild(cardCom);

  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'com-enviar') {
      const texto = cardCom.querySelector('#com-texto').value.trim();
      if (!texto) return toast('Escreva o comentário.', true);
      if (await tentar(() => api('POST', `/api/ocorrencias/${oc.id}/comentarios`, { texto }), 'Comentário publicado.')) navegar();
    } else if (btn.dataset.delCom) {
      if (await tentar(() => api('DELETE', `/api/comentarios/${btn.dataset.delCom}`), 'Comentário excluído.')) navegar();
    } else if (btn.dataset.falta) {
      if (await tentar(() => api('POST', `/api/escala/${btn.dataset.falta}/falta`, {}), 'Falta registrada.')) navegar();
    } else if (btn.dataset.desfalta) {
      if (await tentar(() => api('POST', `/api/escala/${btn.dataset.desfalta}/desmarcar-falta`, {}), 'Falta desmarcada.')) navegar();
    } else if (btn.dataset.minRep) {
      const participantes = [...new Map(oc.escala.filter((x) => x.status !== 'recusado')
        .map((x) => [x.voluntario_id, x.voluntario_nome])).entries()];
      const atual = btn.dataset.minAtual;
      const m = abrirModal(`<h2>🎤 Destacar ministro da música</h2>
        <p class="meta">Escolha, entre os escalados do culto, quem ficará em destaque nesta música.</p>
        <div class="form-linha"><label>Ministro</label><select id="min-sel">
          <option value="">— sem destaque —</option>
          ${participantes.map(([vid, nome]) => `<option value="${vid}" ${String(vid) === atual ? 'selected' : ''}>${esc(nome)}</option>`).join('')}
        </select></div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="min-ok">Salvar</button></div>`);
      m.querySelector('#min-ok').onclick = async () => {
        const v = m.querySelector('#min-sel').value;
        if (await tentar(() => api('PUT', `/api/repertorio/${btn.dataset.minRep}`, { ministro_voluntario_id: v ? Number(v) : null }), 'Destaque salvo.')) { fecharModal(); navegar(); }
      };
    } else if (btn.dataset.remover) {
      if (await tentar(() => api('DELETE', `/api/escala/${btn.dataset.remover}`), 'Removido da escala.')) navegar();
    } else if (btn.dataset.zap) {
      const r = await tentar(() => api('GET', `/api/escala/${btn.dataset.zap}/whatsapp`));
      if (r && r.link) window.open(r.link, '_blank');
      else if (r) toast('Este voluntário não tem telefone cadastrado.', true);
    } else if (btn.dataset.escalar) {
      abrirEscalarManual(oc, Number(btn.dataset.escalar));
    } else if (btn.dataset.delOp) {
      if (await tentar(() => api('DELETE', `/api/oportunidades/${btn.dataset.delOp}`), 'Oportunidade removida.')) navegar();
    } else if (btn.dataset.delRep) {
      if (await tentar(() => api('DELETE', `/api/repertorio/${btn.dataset.delRep}`), 'Louvor removido.')) navegar();
    } else if (btn.dataset.tomRep) {
      const tom = prompt('Tom para este culto (ex.: G, D, Em):', btn.dataset.tomAtual || '');
      if (tom === null) return;
      if (await tentar(() => api('PUT', `/api/repertorio/${btn.dataset.tomRep}`, { tom: tom.trim() || null }), 'Tom atualizado.')) navegar();
    } else if (btn.id === 'btn-add-op') {
      const m = abrirModal(`<h2>Nova oportunidade</h2>
        <div class="form-linha"><label>Título</label><input id="op-titulo" placeholder="Ex.: Devocional, Departamento Infantil"></div>
        <div class="form-linha"><label>Responsável (opcional)</label><input id="op-resp" placeholder="Ex.: Elielson"></div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="op-ok">Adicionar</button></div>`);
      m.querySelector('#op-ok').onclick = async () => {
        const titulo = m.querySelector('#op-titulo').value.trim();
        if (!titulo) return toast('Informe o título.', true);
        if (await tentar(() => api('POST', `/api/ocorrencias/${oc.id}/oportunidades`,
          { titulo, responsavel: m.querySelector('#op-resp').value.trim() || null }), 'Oportunidade adicionada.')) { fecharModal(); navegar(); }
      };
    } else if (btn.id === 'btn-add-louvor') {
      const musicas = await api('GET', '/api/musicas');
      const m = abrirModal(`<h2>Adicionar louvor</h2>
        <div class="form-linha"><label>Música</label>
        <select id="lv-musica">${musicas.map((x) => `<option value="${x.id}" data-tom="${esc(x.tom || '')}">${esc(x.titulo)} — ${esc(x.artista || '')}</option>`).join('')}</select></div>
        <div class="form-linha"><label>Tom neste culto</label><input id="lv-tom" placeholder="Ex.: G (vazio = tom original)"></div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="lv-ok">Adicionar</button></div>`);
      const selM = m.querySelector('#lv-musica');
      const preencherTom = () => { m.querySelector('#lv-tom').value = selM.selectedOptions[0]?.dataset.tom || ''; };
      selM.onchange = preencherTom; preencherTom();
      m.querySelector('#lv-ok').onclick = async () => {
        if (await tentar(() => api('POST', `/api/ocorrencias/${oc.id}/repertorio`, {
          musica_id: Number(selM.value), tom: m.querySelector('#lv-tom').value.trim() || null,
        }), 'Louvor adicionado.')) { fecharModal(); navegar(); }
      };
    }
  });
});

function formDadosCulto(oc) {
  const m = abrirModal(`<h2>Dados do culto</h2>
    <div class="form-grade">
      <div class="form-linha"><label>Tema (ex.: Ceia)</label><input id="c-tema" value="${esc(oc.tema || '')}"></div>
      <div class="form-linha"><label>Responsabilidade (ex.: Dep. Masculino)</label><input id="c-resp" value="${esc(oc.responsavel || '')}"></div>
      <div class="form-linha"><label>Palavra (pregador)</label><input id="c-pregador" value="${esc(oc.pregador || '')}"></div>
      <div class="form-linha"><label>Ministração</label><input id="c-ministra" value="${esc(oc.ministra || '')}"></div>
    </div>
    <div class="form-linha"><label>Abertura (quem abre e o louvor/hino)</label><input id="c-abertura" value="${esc(oc.abertura || '')}" placeholder="Ex.: Viviane — Abertura e Louvor (hino: Atrai o Meu Coração)"></div>
    <div class="form-linha"><label>Observações (até 500 caracteres)</label><textarea id="c-obs" maxlength="500">${esc(oc.observacoes || '')}</textarea></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="c-ok">Salvar</button></div>`);
  m.querySelector('#c-ok').onclick = async () => {
    if (await tentar(() => api('PUT', `/api/ocorrencias/${oc.id}`, {
      tema: m.querySelector('#c-tema').value.trim() || null,
      responsavel: m.querySelector('#c-resp').value.trim() || null,
      pregador: m.querySelector('#c-pregador').value.trim() || null,
      ministra: m.querySelector('#c-ministra').value.trim() || null,
      abertura: m.querySelector('#c-abertura').value.trim() || null,
      observacoes: m.querySelector('#c-obs').value.trim() || null,
    }), 'Dados salvos.')) { fecharModal(); navegar(); }
  };
}

async function abrirGerarEscala(oc) {
  const ministerios = await api('GET', '/api/ministerios');
  const meus = ehAdmin() ? ministerios : ministerios.filter((mi) => estado.me.ministerios_liderados.includes(mi.id));
  if (!meus.length) return toast('Você não lidera nenhum ministério.', true);
  const m = abrirModal(`<h2>⚡ Gerar escala automática</h2>
    <p class="meta">O motor considera disponibilidades, evita conflitos entre locais e no mesmo culto (multi-setor) e balanceia quem serviu menos.</p>
    <div class="form-linha"><label>Ministério</label><select id="g-min">
      ${ehAdmin() ? '<option value="">Todos os ministérios</option>' : ''}
      ${meus.map((mi) => `<option value="${mi.id}">${esc(mi.nome)}</option>`).join('')}</select></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="g-ok">Gerar</button></div>`);
  m.querySelector('#g-ok').onclick = async () => {
    const v = m.querySelector('#g-min').value;
    const r = await tentar(() => api('POST', `/api/ocorrencias/${oc.id}/gerar-escala`, v ? { ministerio_id: Number(v) } : {}));
    if (r) {
      toast(`${r.preenchidas} vaga(s) preenchida(s).` + (r.semCandidato.length ? ` Sem candidato: ${r.semCandidato.join(', ')}.` : ''));
      fecharModal(); navegar();
    }
  };
}

async function abrirEscalarManual(oc, funcaoId) {
  const cands = await api('GET', `/api/ocorrencias/${oc.id}/candidatos?funcao_id=${funcaoId}`);
  const linhas = cands.map((c) => `
    <div class="slot">
      <div>${esc(c.nome)}
        ${c.mesmo_culto ? '<span class="selo recusado">já neste culto</span>' : ''}
        ${c.conflito && !c.mesmo_culto ? '<span class="selo recusado">conflito</span>' : ''}
        ${!c.disponivel ? '<span class="selo aviso">indisponível</span>' : ''}
        <span class="meta">${c.recentes} escala(s) em 60d</span>
      </div>
      <button class="botao mini primario" data-vol="${c.id}">Escalar</button>
    </div>`).join('');
  const m = abrirModal(`<h2>Escalar voluntário</h2>
    <p class="meta">O motor avisa sobre indisponibilidade e conflitos (inclusive de setor), mas a decisão final é do líder.</p>
    ${linhas || '<p class="vazio">Ninguém exerce esta função ainda.</p>'}
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button></div>`);
  m.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-vol]');
    if (!btn) return;
    const r = await tentar(() => api('POST', `/api/ocorrencias/${oc.id}/escalar`, { voluntario_id: Number(btn.dataset.vol), funcao_id: funcaoId }));
    if (r) {
      const NOMES = { indisponivel: 'fora da disponibilidade', conflito: 'conflito de horário', mesmo_culto: 'já está neste culto' };
      toast(r.avisos.length ? `Escalado com avisos: ${r.avisos.map((a) => NOMES[a] || a).join(', ')}` : 'Escalado!');
      fecharModal(); navegar();
    }
  });
}

// =====================================================================
// CULTOS & ESCALAS (lista) e ESCALA DO MÊS
// =====================================================================
rota(/^#\/escalas$/, async (alvo) => {
  const ocs = await api('GET', '/api/ocorrencias');
  cabecalho(alvo, 'Cultos & escalas', 'Celebrações dos próximos 60 dias. Clique para abrir o roteiro e a escala.',
    '<button class="botao" id="btn-gerar-ocs">Gerar ocorrências (4 semanas)</button>');
  document.getElementById('btn-gerar-ocs').onclick = async () => {
    const r = await tentar(() => api('POST', '/api/ocorrencias/gerar', {}));
    if (r) { toast(`${r.criadas} ocorrência(s) criada(s).`); navegar(); }
  };
  if (!ocs.length) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma ocorrência futura. Cadastre celebrações e gere as ocorrências.</p>'); return; }
  let dataAtual = '';
  for (const oc of ocs) {
    if (oc.data !== dataAtual) {
      dataAtual = oc.data;
      alvo.insertAdjacentHTML('beforeend', `<h2>${fmtData(oc.data)}</h2>`);
    }
    const cheia = oc.preenchidas >= oc.vagas;
    const card = document.createElement('div');
    card.className = 'cartao cartao-clicavel';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <strong>${esc(oc.evento_nome)}</strong>
          ${oc.tema ? `<span class="selo destaque">${esc(oc.tema)}</span>` : ''}
          <span class="selo neutro">${esc(oc.local_nome || 'sem local')}</span>
          ${oc.publicada_em ? '<span class="selo confirmado">no mural</span>' : ''}
          <div class="meta">${oc.hora_inicio} · ${oc.duracao_min} min</div>
        </div>
        <div>
          <span class="selo ${cheia ? 'confirmado' : 'aviso'}">${oc.preenchidas}/${oc.vagas} vagas</span>
          <span class="selo neutro">${oc.confirmadas} confirmada(s)</span>
        </div>
      </div>`;
    card.onclick = () => { location.hash = `#/culto/${oc.id}`; };
    alvo.appendChild(card);
  }
});

rota(/^#\/escala-mensal$/, async (alvo) => {
  const ministerios = await api('GET', '/api/ministerios');
  const meus = ehAdmin() ? ministerios : ministerios.filter((mi) => estado.me.ministerios_liderados.includes(mi.id));
  cabecalho(alvo, '⚡ Escala do mês', 'Gere a escala mensal do seu ministério usando as disponibilidades informadas pelos membros.');
  if (!meus.length) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Você não lidera nenhum ministério. Peça ao administrador.</p>'); return; }
  const prox = new Date(); prox.setMonth(prox.getMonth() + 1);
  const mesPadrao = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;
  const card = document.createElement('div');
  card.className = 'cartao';
  card.innerHTML = `
    <div class="form-grade">
      <div class="form-linha"><label>Ministério</label><select id="em-min">
        ${meus.map((mi) => `<option value="${mi.id}">${esc(mi.nome)}</option>`).join('')}</select></div>
      <div class="form-linha"><label>Mês</label><input type="month" id="em-mes" value="${mesPadrao}"></div>
    </div>
    <button class="botao primario" id="em-gerar">⚡ Gerar escala do mês</button>
    <div id="em-resultado" style="margin-top:14px"></div>`;
  alvo.appendChild(card);
  card.querySelector('#em-gerar').onclick = async () => {
    const [ano, mes] = card.querySelector('#em-mes').value.split('-').map(Number);
    if (!ano) return toast('Escolha o mês.', true);
    const r = await tentar(() => api('POST', '/api/escala-mensal', {
      ministerio_id: Number(card.querySelector('#em-min').value), ano, mes,
    }));
    if (r) {
      card.querySelector('#em-resultado').innerHTML = `
        <div class="kpis">
          <div class="kpi"><div class="rotulo">Cultos no mês</div><div class="valor">${r.ocorrencias}</div></div>
          <div class="kpi"><div class="rotulo">Vagas preenchidas</div><div class="valor">${r.preenchidas}</div></div>
          <div class="kpi"><div class="rotulo">Sem candidato</div><div class="valor">${r.semCandidato.length}</div></div>
        </div>
        ${r.semCandidato.length ? `<div class="cartao"><strong>Vagas sem candidato:</strong><br>${r.semCandidato.map(esc).join('<br>')}</div>` : ''}
        <a href="#/escalas" class="botao primario" style="text-decoration:none;display:inline-block">Ver cultos e escalas →</a>`;
      toast('Escala do mês gerada! Os escalados foram notificados. 🎉');
    }
  };
});

// ---------- Indisponibilidades do ministério (líder) ----------
rota(/^#\/indisponibilidades$/, async (alvo) => {
  const ministerios = await api('GET', '/api/ministerios');
  const meus = ehAdmin() ? ministerios : ministerios.filter((mi) => estado.me.ministerios_liderados.includes(mi.id));
  cabecalho(alvo, '🚫 Indisponibilidades do ministério',
    'Quem não pode servir, quando e por quê — a base para montar a escala do mês.');
  if (!meus.length) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Você não lidera nenhum ministério.</p>'); return; }

  const barra = document.createElement('div');
  barra.className = 'cartao';
  const mesAtual = hojeISO().slice(0, 7);
  barra.innerHTML = `<div class="form-grade">
    <div class="form-linha"><label>Ministério</label><select id="in-min">
      ${meus.map((mi) => `<option value="${mi.id}">${esc(mi.nome)}</option>`).join('')}</select></div>
    <div class="form-linha"><label>Mês</label><input type="month" id="in-mes" value="${mesAtual}"></div>
  </div><div id="in-corpo"></div>`;
  alvo.appendChild(barra);

  const ICONE = { dia: '🚫', matutino: '🌅', vespertino: '🌤️', noturno: '🌙' };
  async function carregar() {
    const minId = barra.querySelector('#in-min').value;
    const mes = barra.querySelector('#in-mes').value;
    const bloqueios = await tentar(() => api('GET', `/api/ministerios/${minId}/indisponibilidades?mes=${mes}`)) || [];
    // Expande intervalos em dias dentro do mês.
    const porDia = new Map();
    const [ano, m] = mes.split('-').map(Number);
    const diasNoMes = new Date(ano, m, 0).getDate();
    for (const b of bloqueios) {
      for (let d = 1; d <= diasNoMes; d++) {
        const iso = `${mes}-${String(d).padStart(2, '0')}`;
        if (b.data <= iso && (b.data_fim || b.data) >= iso) {
          if (!porDia.has(iso)) porDia.set(iso, []);
          porDia.get(iso).push(b);
        }
      }
    }
    const dias = [...porDia.keys()].sort();
    barra.querySelector('#in-corpo').innerHTML = dias.length
      ? dias.map((iso) => `<div class="item-lista"><strong>${fmtData(iso)}</strong>${
          porDia.get(iso).map((b) => `<div style="margin-top:4px">${ICONE[b.periodo] || '🚫'} ${esc(b.voluntario_nome)}
            <span class="selo neutro">${b.periodo}</span> <span class="meta">— ${esc(b.motivo)}</span></div>`).join('')
        }</div>`).join('')
      : '<p class="vazio" style="margin-top:14px">Nenhuma indisponibilidade neste mês. 🎉</p>';
  }
  barra.querySelector('#in-min').onchange = carregar;
  barra.querySelector('#in-mes').onchange = carregar;
  carregar();
});

// =====================================================================
// MINHA ÁREA
// =====================================================================
rota(/^#\/agenda$/, async (alvo) => {
  if (!meuVol()) { cabecalho(alvo, 'Minha agenda', 'Seu usuário não tem perfil de voluntário vinculado.'); return; }
  const [agenda, v] = await Promise.all([
    api('GET', `/api/voluntarios/${meuVol()}/agenda`),
    api('GET', `/api/voluntarios/${meuVol()}/detalhe`),
  ]);
  cabecalho(alvo, `Olá, ${esc(estado.me.nome.split(' ')[0])}! 👋`, 'Suas próximas escalas. Confirme, faça check-in ou peça troca.');
  if (!v.termo_aceito_em) {
    const aviso = document.createElement('div');
    aviso.className = 'cartao';
    aviso.innerHTML = `<strong>📄 Termo de voluntariado pendente</strong>
      <p class="meta">Ao aceitar, você concorda com o termo de voluntariado digital e o tratamento dos seus dados (LGPD).</p>
      <button class="botao primario" id="btn-termo">Aceitar termo</button>`;
    alvo.appendChild(aviso);
    aviso.querySelector('#btn-termo').onclick = async () => {
      if (await tentar(() => api('POST', `/api/voluntarios/${meuVol()}/termo`), 'Termo aceito. Obrigado por servir!')) navegar();
    };
  }
  if (!agenda.length) alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Você não tem escalas futuras.</p>');
  const hoje = hojeISO();
  for (const a of agenda) {
    const ehHoje = a.data === hoje;
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <strong><span class="ponto-cor" style="background:${esc(a.cor)}"></span>${esc(a.funcao_nome)}</strong> em ${esc(a.evento_nome)}
          <span class="selo neutro">${esc(a.local_nome || '')}</span>
          <div class="meta">${fmtData(a.data)} às ${a.hora_inicio} ${ehHoje ? '· <strong>É HOJE!</strong>' : ''}</div>
        </div>
        <div class="acoes">
          <span class="selo ${a.status}">${a.status}</span>
          ${a.checkin_em ? '<span class="selo confirmado">✔ check-in</span>' : ''}
          ${a.status === 'convidado' ? `<button class="botao mini primario" data-confirmar="${a.escala_id}">Confirmar</button>
            <button class="botao mini" data-recusar="${a.escala_id}">Recusar</button>` : ''}
          ${a.status === 'confirmado' && !a.checkin_em && ehHoje ? `<button class="botao mini primario" data-checkin="${a.escala_id}">📍 Check-in</button>` : ''}
          ${a.status !== 'recusado' && !a.troca_aberta ? `<button class="botao mini" data-troca="${a.escala_id}" data-oc="${a.ocorrencia_id}" data-funcao="${a.funcao_id}" data-data="${a.data}">Pedir troca</button>` : ''}
          ${a.troca_aberta ? '<span class="selo aguardando">troca aguardando</span>' : ''}
          ${ehHoje ? `<button class="botao mini" data-feedback="${a.ocorrencia_id}">⭐ Avaliar</button>` : ''}
          <button class="botao mini" data-roteiro="${a.ocorrencia_id}">📋 Roteiro</button>
        </div>
      </div>`;
    alvo.appendChild(card);
  }
  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.confirmar) {
      if (await tentar(() => api('POST', `/api/escala/${btn.dataset.confirmar}/confirmar`), 'Presença confirmada! +5 pontos 🏆')) navegar();
    } else if (btn.dataset.recusar) {
      if (await tentar(() => api('POST', `/api/escala/${btn.dataset.recusar}/recusar`), 'Escala recusada.')) navegar();
    } else if (btn.dataset.checkin) {
      const r = await tentar(() => api('POST', `/api/escala/${btn.dataset.checkin}/checkin`));
      if (r) { toast(r.streak ? 'Check-in! +10 pontos e BÔNUS de sequência +20! 🔥' : 'Check-in feito! +10 pontos 🏆'); navegar(); }
    } else if (btn.dataset.troca) {
      abrirPedidoTroca(btn.dataset.troca, btn.dataset.oc, btn.dataset.funcao, btn.dataset.data);
    } else if (btn.dataset.feedback) {
      abrirFeedback(Number(btn.dataset.feedback));
    } else if (btn.dataset.roteiro) {
      location.hash = `#/culto/${btn.dataset.roteiro}`;
    }
  });
});

async function abrirPedidoTroca(escalaId, ocorrenciaId, funcaoId, dataCulto) {
  const cands = await api('GET', `/api/ocorrencias/${ocorrenciaId}/candidatos?funcao_id=${funcaoId}`);
  const aptos = cands.filter((c) => c.id !== meuVol() && c.disponivel && !c.conflito && !c.mesmo_culto);
  const m = abrirModal(`<h2>🔄 Pedir troca</h2>
    <div class="form-linha"><label>Tipo</label><select id="tr-tipo">
      <option value="aberta">Aberta — qualquer colega da função pode assumir</option>
      <option value="dirigida" ${aptos.length ? '' : 'disabled'}>Dirigida — pedir a uma pessoa específica</option>
    </select></div>
    <div class="form-linha oculto" id="tr-grupo-dest"><label>Quem você quer que fique no seu lugar?</label>
      <select id="tr-dest">${aptos.map((c) => `<option value="${c.id}">${esc(c.nome)} (${c.recentes} escalas em 60d)</option>`).join('')}</select></div>
    <div class="form-linha"><label>Prazo para resposta (até o dia do culto)</label>
      <input type="date" id="tr-prazo" max="${dataCulto}" value="${dataCulto}"></div>
    <div class="form-linha"><label>Motivo (opcional)</label><textarea id="tr-motivo" placeholder="Ex.: viagem de trabalho"></textarea></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="tr-ok">Solicitar</button></div>`);
  const selTipo = m.querySelector('#tr-tipo');
  selTipo.onchange = () => m.querySelector('#tr-grupo-dest').classList.toggle('oculto', selTipo.value !== 'dirigida');
  m.querySelector('#tr-ok').onclick = async () => {
    const dirigida = selTipo.value === 'dirigida';
    if (await tentar(() => api('POST', `/api/escala/${escalaId}/solicitar-troca`, {
      motivo: m.querySelector('#tr-motivo').value.trim(),
      destinatario_id: dirigida ? Number(m.querySelector('#tr-dest').value) : null,
      prazo: m.querySelector('#tr-prazo').value || null,
    }), dirigida ? 'Pedido enviado! A pessoa foi notificada.' : 'Troca aberta! Os colegas da função foram avisados.')) { fecharModal(); navegar(); }
  };
}

function abrirFeedback(ocorrenciaId, atual = null) {
  const m = abrirModal(`<h2>⭐ Como foi servir?</h2>
    <div class="form-linha"><label>Nota</label><select id="fb-nota">
      ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${atual && atual.nota === n ? 'selected' : ''}>${estrelas(n)} (${n})</option>`).join('')}</select></div>
    <div class="form-linha"><label>Comentário (opcional)</label><textarea id="fb-coment">${esc(atual?.comentario || '')}</textarea></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="fb-ok">${atual ? 'Atualizar' : 'Enviar'}</button></div>`);
  m.querySelector('#fb-ok').onclick = async () => {
    if (await tentar(() => api('POST', '/api/feedback', {
      ocorrencia_id: ocorrenciaId, nota: Number(m.querySelector('#fb-nota').value),
      comentario: m.querySelector('#fb-coment').value,
    }), 'Feedback enviado. Obrigado! 💜')) { fecharModal(); navegar(); }
  };
}

// ---------- Disponibilidade (janelas + calendário com justificativa) ----------
rota(/^#\/disponibilidade$/, async (alvo) => {
  if (!meuVol()) { cabecalho(alvo, 'Disponibilidade', 'Seu usuário não tem perfil de voluntário.'); return; }
  const mesBase = alvo.dataset.mes ? new Date(alvo.dataset.mes + '-15T12:00:00') : new Date();
  await renderDisponibilidade(alvo, mesBase);
});

async function renderDisponibilidade(alvo, mesBase) {
  const [janelas, bloqueios] = await Promise.all([api('GET', '/api/disponibilidade'), api('GET', '/api/bloqueios')]);
  cabecalho(alvo, '🗓️ Minha disponibilidade',
    'Os líderes usam estas informações para gerar as escalas do mês. Dias indisponíveis exigem justificativa.');

  // Janelas semanais
  const cardJ = document.createElement('div');
  cardJ.className = 'cartao';
  cardJ.innerHTML = `<strong>Janelas semanais em que posso servir</strong>
    <p class="meta">Sem janelas cadastradas = disponível sempre. Com janelas, você só é escalado dentro delas.</p>
    ${janelas.map((d) => `<div class="slot"><div>${DIAS[d.dia_semana]} das ${d.hora_inicio} às ${d.hora_fim}</div>
      <button class="botao mini perigo" data-del-jan="${d.id}">Remover</button></div>`).join('') || '<p class="vazio">Disponível em qualquer dia/horário.</p>'}
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      <select id="d-dia">${DIAS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
      <input type="time" id="d-ini" value="00:00"><input type="time" id="d-fim" value="23:59">
      <button class="botao mini" id="btn-add-jan">Adicionar janela</button>
    </div>`;
  alvo.appendChild(cardJ);

  // Calendário do mês
  const ano = mesBase.getFullYear(), mes = mesBase.getMonth();
  const nomeMes = mesBase.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const cardC = document.createElement('div');
  cardC.className = 'cartao';
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const hoje = hojeISO();
  const p2 = (n) => String(n).padStart(2, '0');
  let grade = DIAS.map((d) => `<div class="cal-dia-nome">${d.slice(0, 3)}</div>`).join('');
  for (let i = 0; i < primeiroDia; i++) grade += '<div class="cal-dia fora"></div>';
  const ICONE_PERIODO = { dia: '🚫', matutino: '🌅', vespertino: '🌤️', noturno: '🌙' };
  const NOME_PERIODO = { dia: 'dia inteiro', matutino: 'matutino', vespertino: 'vespertino', noturno: 'noturno' };
  for (let d = 1; d <= diasNoMes; d++) {
    const iso = `${ano}-${p2(mes + 1)}-${p2(d)}`;
    const bloq = bloqueios.find((b) => b.data <= iso && (b.data_fim || b.data) >= iso);
    const passado = iso < hoje;
    const rotulo = bloq ? `${NOME_PERIODO[bloq.periodo] || ''}: ${bloq.motivo}` : '';
    grade += `<div class="cal-dia ${bloq ? 'bloqueado' : ''} ${passado ? 'passado' : ''} ${iso === hoje ? 'hoje' : ''}"
      data-dia="${passado ? '' : iso}" data-bloq="${bloq ? bloq.id : ''}" title="${esc(rotulo)}">
      ${d}${bloq ? `<span class="cal-motivo">${ICONE_PERIODO[bloq.periodo] || '🚫'} ${esc(bloq.motivo)}</span>` : ''}</div>`;
  }
  cardC.innerHTML = `
    <div class="cal-cab">
      <button class="botao mini" id="cal-ant">← anterior</button>
      <strong style="text-transform:capitalize">${esc(nomeMes)}</strong>
      <button class="botao mini" id="cal-prox">próximo →</button>
    </div>
    <div class="cal-grade">${grade}</div>
    <div class="cal-legenda">
      <span><span class="cx" style="background:color-mix(in srgb, var(--critico) 12%, var(--superficie));border:1px solid var(--critico)"></span>Indisponível (com justificativa)</span>
      <span>Clique num dia para marcar/desmarcar indisponibilidade</span>
    </div>`;
  alvo.appendChild(cardC);

  const trocarMes = (delta) => {
    const novo = new Date(ano, mes + delta, 15);
    alvo.dataset.mes = `${novo.getFullYear()}-${p2(novo.getMonth() + 1)}`;
    renderDisponibilidade(alvo, novo);
  };
  cardC.querySelector('#cal-ant').onclick = () => trocarMes(-1);
  cardC.querySelector('#cal-prox').onclick = () => trocarMes(1);

  cardC.querySelector('.cal-grade').addEventListener('click', async (e) => {
    const dia = e.target.closest('.cal-dia');
    if (!dia || !dia.dataset.dia) return;
    if (dia.dataset.bloq) {
      const b = bloqueios.find((x) => x.id === Number(dia.dataset.bloq));
      const m = abrirModal(`<h2>Indisponibilidade</h2>
        <p><strong>${fmtData(b.data)}${b.data_fim && b.data_fim !== b.data ? ' até ' + fmtData(b.data_fim) : ''}</strong>
        · ${ICONE_PERIODO[b.periodo]} ${NOME_PERIODO[b.periodo]}</p>
        <p>Justificativa: <em>${esc(b.motivo)}</em></p>
        <p class="meta">A justificativa é visível apenas para você e para os líderes.</p>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button>
        <button class="botao perigo" id="bl-remover">Remover (ficar disponível)</button></div>`);
      m.querySelector('#bl-remover').onclick = async () => {
        if (await tentar(() => api('DELETE', `/api/bloqueios/${b.id}`), 'Disponibilidade restaurada.')) { fecharModal(); renderDisponibilidade(alvo, mesBase); }
      };
    } else {
      const m = abrirModal(`<h2>Nova indisponibilidade</h2>
        <div class="form-linha"><label>Justificativa (obrigatória — visível só para os líderes)</label>
        <textarea id="bl-motivo" placeholder="Ex.: plantão no trabalho, viagem, consulta médica…"></textarea></div>
        <div class="form-linha"><label>Período do dia</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="bl-periodos">
            <button class="botao mini primario" data-per="dia">📅 Dia inteiro</button>
            <button class="botao mini" data-per="matutino">🌅 Matutino</button>
            <button class="botao mini" data-per="vespertino">🌤️ Vespertino</button>
            <button class="botao mini" data-per="noturno">🌙 Noturno</button>
          </div></div>
        <div class="form-grade">
          <div class="form-linha"><label>Início</label><input type="date" id="bl-ini" value="${dia.dataset.dia}"></div>
          <div class="form-linha"><label>Término (opcional, p/ intervalo)</label><input type="date" id="bl-fim" min="${dia.dataset.dia}"></div>
        </div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="bl-ok">Marcar indisponível</button></div>`);
      let periodo = 'dia';
      m.querySelector('#bl-periodos').addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-per]');
        if (!b) return;
        periodo = b.dataset.per;
        m.querySelectorAll('#bl-periodos button').forEach((x) => x.classList.toggle('primario', x === b));
      });
      m.querySelector('#bl-ok').onclick = async () => {
        const motivo = m.querySelector('#bl-motivo').value.trim();
        if (motivo.length < 3) return toast('A justificativa é obrigatória.', true);
        if (await tentar(() => api('POST', '/api/bloqueios', {
          data: m.querySelector('#bl-ini').value, data_fim: m.querySelector('#bl-fim').value || null,
          periodo, motivo,
        }), 'Indisponibilidade registrada.')) { fecharModal(); renderDisponibilidade(alvo, mesBase); }
      };
    }
  });

  cardJ.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btn-add-jan') {
      if (await tentar(() => api('POST', '/api/disponibilidade', {
        dia_semana: Number(cardJ.querySelector('#d-dia').value),
        hora_inicio: cardJ.querySelector('#d-ini').value, hora_fim: cardJ.querySelector('#d-fim').value,
      }), 'Janela adicionada.')) renderDisponibilidade(alvo, mesBase);
    } else if (btn.dataset.delJan) {
      if (await tentar(() => api('DELETE', `/api/disponibilidade/${btn.dataset.delJan}`), 'Janela removida.')) renderDisponibilidade(alvo, mesBase);
    }
  });
}

// ---------- Habilidades (multi-setor) ----------
rota(/^#\/habilidades$/, async (alvo) => {
  if (!meuVol()) { cabecalho(alvo, 'Habilidades', 'Seu usuário não tem perfil de voluntário.'); return; }
  const [v, ministerios] = await Promise.all([
    api('GET', `/api/voluntarios/${meuVol()}/detalhe`),
    api('GET', '/api/ministerios'),
  ]);
  const todasFuncoes = (await Promise.all(ministerios.map((mi) => api('GET', `/api/funcoes?ministerio_id=${mi.id}`)))).flat();
  cabecalho(alvo, '🎯 Minhas habilidades, dons e talentos',
    'Você pode servir em mais de um ministério. Informe tudo o que exerce — o motor de escalas usa isso (sem conflito de setor no mesmo culto).');

  for (const mi of ministerios) {
    const minhas = v.funcoes.filter((f) => f.ministerio_id === mi.id);
    if (!minhas.length) continue;
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `<strong><span class="ponto-cor" style="background:${esc(mi.cor)}"></span>${esc(mi.nome)}</strong>
      ${minhas.map((f) => `<div class="slot"><div>${esc(f.nome)} ${f.preferencia ? '<span class="selo confirmado">preferida</span>' : ''}</div>
        <button class="botao mini perigo" data-del-f="${f.id}">Remover</button></div>`).join('')}`;
    alvo.appendChild(card);
  }
  if (!v.funcoes.length) alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma habilidade cadastrada ainda.</p>');

  const add = document.createElement('div');
  add.className = 'cartao';
  add.innerHTML = `<strong>Adicionar habilidade</strong>
    <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <select id="add-funcao" style="flex:1;min-width:220px">${todasFuncoes.map((f) => {
        const mi = ministerios.find((x) => x.id === f.ministerio_id);
        return `<option value="${f.id}">${esc(mi?.nome)} — ${esc(f.nome)}</option>`;
      }).join('')}</select>
      <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="add-pref">é minha preferida</label>
      <button class="botao mini primario" id="btn-add-f">Adicionar</button>
    </div>`;
  alvo.appendChild(add);

  const cardNasc = document.createElement('div');
  cardNasc.className = 'cartao';
  cardNasc.innerHTML = `<strong>🎂 Meu aniversário</strong>
    <p class="meta">Aparece no mural para a igreja celebrar com você.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="date" id="meu-nasc" value="${esc(v.nascimento && v.nascimento.length === 10 ? v.nascimento : '')}">
      <button class="botao mini primario" id="btn-nasc">Salvar</button>
      ${v.nascimento ? `<span class="meta">registrado: ${esc(v.nascimento.slice(-5).split('-').reverse().join('/'))}</span>` : ''}
    </div>`;
  alvo.appendChild(cardNasc);

  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btn-add-f') {
      if (await tentar(() => api('POST', `/api/voluntarios/${meuVol()}/funcoes`, {
        funcao_id: Number(add.querySelector('#add-funcao').value),
        preferencia: add.querySelector('#add-pref').checked,
      }), 'Habilidade adicionada.')) navegar();
    } else if (btn.dataset.delF) {
      if (await tentar(() => api('DELETE', `/api/voluntarios/${meuVol()}/funcoes/${btn.dataset.delF}`), 'Habilidade removida.')) navegar();
    } else if (btn.id === 'btn-nasc') {
      const nasc = cardNasc.querySelector('#meu-nasc').value;
      if (!nasc) return toast('Escolha a data.', true);
      if (await tentar(() => api('POST', `/api/voluntarios/${meuVol()}/nascimento`, { nascimento: nasc }), 'Aniversário salvo! 🎂')) navegar();
    }
  });
});

// ---------- Trocas ----------
// Status do painel: 🟡 Pendente · 🟢 Troca confirmada · 🔴 Troca indisponível.
const TROCA_STATUS = {
  aguardando: ['🟡 Pendente', 'aguardando'],
  aceita: ['🟢 Troca confirmada', 'aceita'],
  recusada: ['🔴 Troca indisponível (recusada)', 'recusada'],
  cancelada: ['🔴 Troca indisponível (cancelada)', 'recusada'],
  expirada: ['🔴 Troca indisponível (expirada)', 'recusada'],
};
const seloTroca = (status) => {
  const [rotulo, classe] = TROCA_STATUS[status] || [status, 'neutro'];
  return `<span class="selo ${classe}">${rotulo}</span>`;
};

rota(/^#\/trocas$/, async (alvo) => {
  const eu = meuVol();
  const [trocas, resumo] = await Promise.all([
    api('GET', '/api/trocas'),
    eu ? api('GET', '/api/trocas/resumo').catch(() => null) : Promise.resolve(null),
  ]);
  cabecalho(alvo, '🔄 Trocas', 'Painel de controle: solicite, edite, acompanhe e conclua trocas de escala.',
    eu ? '<button class="botao primario" id="btn-nova-troca">➕ Solicitar troca</button>' : '');
  if (eu) document.getElementById('btn-nova-troca').onclick = abrirNovaTroca;

  // Quantidades de trocas (minhas solicitações).
  if (resumo) {
    alvo.insertAdjacentHTML('beforeend', `<div class="kpis">
      <div class="kpi"><div class="rotulo">Minhas solicitações</div><div class="valor">${resumo.total}</div></div>
      <div class="kpi"><div class="rotulo">🟡 Pendentes</div><div class="valor">${resumo.pendentes}</div></div>
      <div class="kpi"><div class="rotulo">🟢 Confirmadas</div><div class="valor">${resumo.confirmadas}</div></div>
      <div class="kpi"><div class="rotulo">🔴 Indisponíveis</div><div class="valor">${resumo.indisponiveis}</div></div>
    </div>`);
    if (resumo.quem_assume.length) {
      alvo.insertAdjacentHTML('beforeend', `<div class="cartao"><strong>🤝 Quem assume minhas solicitações de troca</strong>
        <div style="margin-top:6px">${resumo.quem_assume.map((q) =>
          `<span class="selo aceita" style="margin:2px">${esc(q.nome)} — ${q.vezes} vez(es)</span>`).join(' ')}</div></div>`);
    }
  }

  // Pedidos dirigidos a mim (ação rápida).
  const paraMim = trocas.filter((t) => t.status === 'aguardando' && t.destinatario_id === eu);
  if (paraMim.length) {
    alvo.insertAdjacentHTML('beforeend', '<h2>📩 Pedidos para você responder</h2>');
    for (const t of paraMim) {
      alvo.insertAdjacentHTML('beforeend', `<div class="cartao">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><strong>${esc(t.solicitante_nome)}</strong> pediu para você ficar no lugar como
            <strong>${esc(t.funcao_nome)}</strong> em ${esc(t.evento_nome)}, ${fmtData(t.data)} às ${t.hora_inicio}
            ${t.motivo ? `<div class="meta">“${esc(t.motivo)}”</div>` : ''}
            ${t.prazo ? `<div class="meta">⏳ responder até ${fmtData(t.prazo)}</div>` : ''}</div>
          <div class="acoes">
            <button class="botao mini primario" data-aceitar="${t.id}">Aceitar e assumir</button>
            <button class="botao mini perigo" data-recusar="${t.id}">Recusar</button>
          </div>
        </div></div>`);
    }
  }

  // Painel: todas as trocas em tabela, com filtro por status.
  const filtro = alvo.dataset.filtroTroca || 'todas';
  const grupoDe = (t) => t.status === 'aguardando' ? 'pendente' : t.status === 'aceita' ? 'confirmada' : 'indisponivel';
  const visiveis = trocas.filter((t) => filtro === 'todas' || grupoDe(t) === filtro);
  alvo.insertAdjacentHTML('beforeend', `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
      <h2 style="margin:0">Painel de trocas (${visiveis.length})</h2>
      <select id="filtro-troca">
        <option value="todas" ${filtro === 'todas' ? 'selected' : ''}>Todas</option>
        <option value="pendente" ${filtro === 'pendente' ? 'selected' : ''}>🟡 Pendentes</option>
        <option value="confirmada" ${filtro === 'confirmada' ? 'selected' : ''}>🟢 Confirmadas</option>
        <option value="indisponivel" ${filtro === 'indisponivel' ? 'selected' : ''}>🔴 Indisponíveis</option>
      </select>
    </div>`);
  document.getElementById('filtro-troca').onchange = (e) => { alvo.dataset.filtroTroca = e.target.value; navegar(); };

  if (!visiveis.length) {
    alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma troca neste filtro.</p>');
  } else {
    const linhas = visiveis.map((t) => {
      const pendente = t.status === 'aguardando';
      const minha = t.solicitante_id === eu;
      const acoes = [];
      if (pendente && t.destinatario_id === eu) {
        acoes.push(`<button class="botao mini primario" data-aceitar="${t.id}">Aceitar</button>`,
          `<button class="botao mini perigo" data-recusar="${t.id}">Recusar</button>`);
      } else if (pendente && !t.destinatario_id && !minha) {
        acoes.push(`<button class="botao mini primario" data-aceitar="${t.id}">Assumir</button>`);
      }
      if (pendente && (minha || ehLider())) {
        acoes.push(`<button class="botao mini" data-editar="${t.id}">✏️ Editar</button>`,
          `<button class="botao mini perigo" data-cancelar="${t.id}">Cancelar</button>`);
      }
      if (!pendente && (minha || ehLider())) {
        acoes.push(`<button class="botao mini perigo" data-excluir="${t.id}">🗑 Excluir</button>`);
      }
      return `<tr>
        <td><strong>${esc(t.solicitante_nome)}</strong>
          ${t.motivo ? `<div class="meta">“${esc(t.motivo)}”</div>` : ''}</td>
        <td>${t.aceitou_nome ? `<strong>${esc(t.aceitou_nome)}</strong>`
          : t.destinatario_nome ? esc(t.destinatario_nome)
          : '<span class="meta">aberta — qualquer colega da função</span>'}</td>
        <td>${esc(t.evento_nome)}<div class="meta">${esc(t.funcao_nome)} · ${esc(t.local_nome || '')}</div></td>
        <td>${fmtData(t.data)}<div class="meta">${t.hora_inicio}</div></td>
        <td>${seloTroca(t.status)}
          <div class="meta">criada em ${fmtDataHora(t.criada_em)}${t.prazo ? ` · ⏳ ${fmtData(t.prazo)}` : ''}${t.resolvida_em ? `<br>resolvida em ${fmtDataHora(t.resolvida_em)}` : ''}</div></td>
        <td><div class="acoes" style="flex-wrap:wrap">${acoes.join(' ')}</div></td>
      </tr>`;
    }).join('');
    alvo.insertAdjacentHTML('beforeend', `<div class="rolagem-x"><table class="tabela">
      <thead><tr><th>Pedido de troca</th><th>Substituto</th><th>Evento/Culto</th><th>Data do culto</th><th>Status</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`);
  }

  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.aceitar) {
      const r = await tentar(() => api('POST', `/api/trocas/${btn.dataset.aceitar}/aceitar`, {}));
      if (r) { toast('Você assumiu a vaga! +5 pontos 🏆'); navegar(); }
    } else if (btn.dataset.recusar) {
      if (await tentar(() => api('POST', `/api/trocas/${btn.dataset.recusar}/recusar`, {}), 'Pedido recusado.')) navegar();
    } else if (btn.dataset.cancelar) {
      if (await tentar(() => api('POST', `/api/trocas/${btn.dataset.cancelar}/cancelar`, {}), 'Troca cancelada.')) navegar();
    } else if (btn.dataset.excluir) {
      if (!confirm('Excluir esta troca do histórico?')) return;
      if (await tentar(() => api('DELETE', `/api/trocas/${btn.dataset.excluir}`), 'Troca excluída.')) navegar();
    } else if (btn.dataset.editar) {
      const t = trocas.find((x) => x.id === Number(btn.dataset.editar));
      if (t) abrirEditarTroca(t);
    }
  });
});

// Nova solicitação a partir do painel: escolhe uma das minhas escalas futuras.
async function abrirNovaTroca() {
  const agenda = await api('GET', `/api/voluntarios/${meuVol()}/agenda`);
  const elegiveis = agenda.filter((a) => a.status !== 'recusado' && !a.troca_aberta);
  if (!elegiveis.length) return toast('Você não tem escalas futuras sem troca pendente.', true);
  const m = abrirModal(`<h2>➕ Solicitar troca</h2>
    <div class="form-linha"><label>Qual escala você quer trocar?</label>
      <select id="nt-escala">${elegiveis.map((a) =>
        `<option value="${a.escala_id}" data-oc="${a.ocorrencia_id}" data-funcao="${a.funcao_id}" data-data="${a.data}">
          ${esc(a.funcao_nome)} — ${esc(a.evento_nome)}, ${fmtData(a.data)} às ${a.hora_inicio}</option>`).join('')}</select></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="nt-ok">Continuar</button></div>`);
  m.querySelector('#nt-ok').onclick = () => {
    const op = m.querySelector('#nt-escala').selectedOptions[0];
    abrirPedidoTroca(op.value, op.dataset.oc, op.dataset.funcao, op.dataset.data);
  };
}

// Edição de troca pendente: substituto, prazo e motivo.
async function abrirEditarTroca(t) {
  const cands = await api('GET', `/api/ocorrencias/${t.ocorrencia_id}/candidatos?funcao_id=${t.funcao_id}`);
  const aptos = cands.filter((c) => c.id !== t.solicitante_id && (c.id === t.destinatario_id || (c.disponivel && !c.conflito && !c.mesmo_culto)));
  const m = abrirModal(`<h2>✏️ Editar troca</h2>
    <p class="meta">${esc(t.funcao_nome)} em ${esc(t.evento_nome)}, ${fmtData(t.data)} às ${t.hora_inicio}</p>
    <div class="form-linha"><label>Tipo</label><select id="et-tipo">
      <option value="aberta" ${t.destinatario_id ? '' : 'selected'}>Aberta — qualquer colega da função pode assumir</option>
      <option value="dirigida" ${t.destinatario_id ? 'selected' : ''} ${aptos.length ? '' : 'disabled'}>Dirigida — pedir a uma pessoa específica</option>
    </select></div>
    <div class="form-linha ${t.destinatario_id ? '' : 'oculto'}" id="et-grupo-dest"><label>Substituto</label>
      <select id="et-dest">${aptos.map((c) =>
        `<option value="${c.id}" ${c.id === t.destinatario_id ? 'selected' : ''}>${esc(c.nome)} (${c.recentes} escalas em 60d)</option>`).join('')}</select></div>
    <div class="form-linha"><label>Prazo para resposta (até o dia do culto)</label>
      <input type="date" id="et-prazo" max="${t.data}" value="${t.prazo || ''}"></div>
    <div class="form-linha"><label>Motivo</label><textarea id="et-motivo">${esc(t.motivo || '')}</textarea></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="et-ok">Salvar alterações</button></div>`);
  const selTipo = m.querySelector('#et-tipo');
  selTipo.onchange = () => m.querySelector('#et-grupo-dest').classList.toggle('oculto', selTipo.value !== 'dirigida');
  m.querySelector('#et-ok').onclick = async () => {
    const dirigida = selTipo.value === 'dirigida';
    if (await tentar(() => api('PUT', `/api/trocas/${t.id}`, {
      motivo: m.querySelector('#et-motivo').value.trim(),
      destinatario_id: dirigida ? Number(m.querySelector('#et-dest').value) : null,
      prazo: m.querySelector('#et-prazo').value || null,
    }), 'Troca atualizada.')) { fecharModal(); navegar(); }
  };
}

// ---------- Pontos e notificações ----------
// Ranking da igreja — Servindo, referência e compromisso.
const STATUS_AVALIACAO = {
  compromissado: ['🟢 Compromissado em servir', 'confirmado'],
  precisa_melhorar: ['🟡 Precisa melhorar', 'aviso'],
  alerta: ['🔴 Alerta negativo', 'recusado'],
  sem_escala: ['sem escala no período', 'neutro'],
};
const seloAvaliacao = (status) => {
  const [rotulo, classe] = STATUS_AVALIACAO[status] || [status, 'neutro'];
  return `<span class="selo ${classe}">${rotulo}</span>`;
};

rota(/^#\/pontos$/, async (alvo) => {
  if (!meuVol()) { cabecalho(alvo, 'Pontos', 'Seu usuário não tem perfil de voluntário.'); return; }
  const dias = Number(alvo.dataset.dias || 90);
  const [p, ranking, av] = await Promise.all([
    api('GET', `/api/voluntarios/${meuVol()}/pontos`),
    api('GET', '/api/ranking'),
    api('GET', `/api/avaliacao?de=${hojeISO(-dias)}&ate=${hojeISO(30)}`),
  ]);
  const posicao = ranking.findIndex((r) => r.id === meuVol()) + 1;
  cabecalho(alvo, '🏆 Pontos & Ranking da igreja', 'Servindo, referência e compromisso — escalado +5 · confirmação +5 · check-in +10 · sequência de 4 semanas +20.',
    `<select id="av-dias">${[[30, 'Últimos 30 dias'], [90, 'Últimos 90 dias'], [180, 'Últimos 180 dias'], [365, 'Último ano']]
      .map(([v, r]) => `<option value="${v}" ${v === dias ? 'selected' : ''}>${r}</option>`).join('')}</select>`);
  document.getElementById('av-dias').onchange = (e) => { alvo.dataset.dias = e.target.value; navegar(); };

  const meuAv = av.membros.find((m) => m.voluntario_id === meuVol());
  alvo.insertAdjacentHTML('beforeend', `<div class="kpis">
    <div class="kpi"><div class="rotulo">Total de pontos</div><div class="valor">${p.total}</div></div>
    <div class="kpi"><div class="rotulo">Posição no ranking</div><div class="valor">${posicao || '–'}º</div></div>
    <div class="kpi"><div class="rotulo">Nota geral da igreja 🥇</div><div class="valor">${av.nota_geral ?? '–'}<span class="unidade">/10</span></div></div>
    <div class="kpi"><div class="rotulo">🟢 Compromissados</div><div class="valor">${av.compromissados}<span class="unidade">/${av.avaliados}</span></div></div>
  </div>`);
  if (meuAv && meuAv.status !== 'sem_escala') {
    alvo.insertAdjacentHTML('beforeend', `<div class="cartao"><strong>Meu status no período:</strong>
      ${seloAvaliacao(meuAv.status)} <span class="meta">índice de compromisso ${meuAv.indice}/100 ·
      confirmação ${meuAv.taxa_confirmacao ?? '–'}% · presença ${meuAv.taxa_presenca ?? '–'}% ·
      ${meuAv.faltas} falta(s) · ${meuAv.trocas_assumidas} troca(s) assumida(s)</span></div>`);
  }

  // Pódio: 1º, 2º e 3º entre os 🟢 Compromissados.
  if (av.podio.length) {
    const MEDALHAS = ['🥇', '🥈', '🥉'];
    alvo.insertAdjacentHTML('beforeend', `<h2>Pódio do compromisso</h2><div class="podio">${
      av.podio.map((m, i) => `<div class="lugar">
        <div class="medalha">${MEDALHAS[i]}</div>
        <strong>${i + 1}º — ${esc(m.nome)}</strong>
        <div class="meta">índice ${m.indice}/100 · ${m.pontos} pts no período</div>
        ${seloAvaliacao(m.status)}
      </div>`).join('')}</div>`);
  }

  // Ranking completo com métricas.
  const avaliados = av.membros.filter((m) => m.status !== 'sem_escala');
  if (avaliados.length) {
    alvo.insertAdjacentHTML('beforeend', `<h2>Ranking da igreja — Servindo, referência e compromisso</h2>
      <div class="rolagem-x"><table class="tabela">
      <thead><tr><th>#</th><th>Membro</th><th>Escalas</th><th>Confirmação</th><th>Presença</th><th>Faltas</th><th>Trocas assumidas</th><th>Pontos</th><th>Índice</th><th>Status</th></tr></thead>
      <tbody>${avaliados.map((m) => `<tr ${m.voluntario_id === meuVol() ? 'style="font-weight:600"' : ''}>
        <td>${m.posicao}º</td><td>${esc(m.nome)}</td><td>${m.escalacoes}</td>
        <td>${m.taxa_confirmacao ?? '–'}%</td><td>${m.taxa_presenca ?? '–'}%</td>
        <td>${m.faltas}</td><td>${m.trocas_assumidas}</td><td>${m.pontos}</td>
        <td><strong>${m.indice}</strong></td><td>${seloAvaliacao(m.status)}</td>
      </tr>`).join('')}</tbody></table></div>`);
  }

  // Transparência: métricas e parâmetros da avaliação automática.
  alvo.insertAdjacentHTML('beforeend', `<div class="cartao">
    <strong>⚖️ Como a avaliação funciona</strong>
    <ul style="margin:8px 0 8px 18px;line-height:1.7">${av.criterios.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="meta">A pontuação e os status são gerados <strong>automaticamente</strong> pelo sistema, a partir dos registros
    de escala — sem favoritismo — com a intenção de incentivar cada um a buscar servir com excelência no Reino de Deus. 🙌</p>
  </div>`);

  alvo.appendChild(grafBarras('Ranking por pontos (geral)', ranking.slice(0, 10).map((r) => ({ nome: r.nome, valor: r.pontos })), { classe: 'serie-2', unidade: ' pts' }));
  const MOTIVOS = { escalado: 'Escalado(a)', confirmou: 'Confirmou presença', checkin: 'Check-in', streak: 'Sequência de 4 semanas 🔥', aceitou_troca: 'Assumiu troca' };
  alvo.insertAdjacentHTML('beforeend', `<h2>Histórico</h2><div class="cartao">${
    p.historico.map((h) => `<div class="item-lista"><strong>+${h.valor}</strong> — ${MOTIVOS[h.motivo] || esc(h.motivo)}
      <span class="quando">${fmtDataHora(h.criado_em)}</span></div>`).join('') || '<p class="vazio">Nenhum ponto ainda.</p>'
  }</div>`);
});

rota(/^#\/notificacoes$/, async (alvo) => {
  const notifs = meuVol() ? await api('GET', `/api/voluntarios/${meuVol()}/notificacoes`) : [];
  cabecalho(alvo, '🔔 Notificações', 'Escalas, trocas e avisos — e alertas de pendências para os líderes.',
    notifs.some((n) => !n.lida) ? '<button class="botao" id="btn-ler">Marcar todas como lidas</button>' : '');
  const btnLer = document.getElementById('btn-ler');
  if (btnLer) btnLer.onclick = async () => {
    if (await tentar(() => api('POST', `/api/voluntarios/${meuVol()}/notificacoes/ler`, {}))) navegar();
  };

  // Alerta de cultos com pendências (líder): vaga incompleta, louvores não
  // informados, sem confirmação etc. — com a tratativa a um clique.
  if (ehLider()) {
    const pend = await api('GET', '/api/pendencias').catch(() => []);
    alvo.insertAdjacentHTML('beforeend', `<h2>⚠️ Cultos com pendências (próximos 35 dias)</h2>`);
    if (!pend.length) {
      alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma pendência — tudo em ordem. ✅</p>');
    } else {
      for (const oc of pend) {
        alvo.insertAdjacentHTML('beforeend', `<div class="cartao">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div><strong>${esc(oc.evento_nome)}</strong> — ${fmtData(oc.data)} às ${oc.hora_inicio}
              <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${
                oc.pendencias.map((pd) => `<span class="selo ${pd.tipo === 'vaga' || pd.tipo === 'louvores' ? 'recusado' : 'aviso'}">${esc(pd.texto)}</span>`).join(' ')
              }</div></div>
            <a class="botao mini primario" href="#/culto/${oc.id}">Tratar →</a>
          </div></div>`);
      }
    }
  }

  alvo.insertAdjacentHTML('beforeend', '<h2>Minhas notificações</h2>');
  if (!meuVol()) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Seu usuário não tem perfil de voluntário.</p>'); return; }
  if (!notifs.length) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma notificação.</p>'); return; }
  alvo.insertAdjacentHTML('beforeend', `<div class="cartao">${
    notifs.map((n) => `<div class="item-lista ${n.lida ? '' : 'nao-lida'}">${n.lida ? '' : '🔵 '}${esc(n.mensagem)}
      <div class="quando">${fmtDataHora(n.criada_em)}</div></div>`).join('')
  }</div>`);
});

// =====================================================================
// ESTANTE MUSICAL
// =====================================================================
rota(/^#\/estante$/, async (alvo) => {
  const [musicas, est] = await Promise.all([api('GET', '/api/musicas'), api('GET', '/api/estante/estatisticas')]);
  const artistas = [...new Set(musicas.map((m) => m.artista).filter(Boolean))].sort();
  cabecalho(alvo, '🎵 Estante musical',
    `<strong>${musicas.length}</strong> música(s) · <strong>${artistas.length}</strong> artista(s) — letra, cifra, tons e estatísticas.`,
    ehLider() ? '<button class="botao" id="btn-setlists">Setlists</button><button class="botao primario" id="btn-nova">+ Nova música</button>' : '');
  if (ehLider()) {
    document.getElementById('btn-nova').onclick = () => formMusica(null);
    document.getElementById('btn-setlists').onclick = () => { location.hash = '#/setlists'; };
  }

  const busca = document.createElement('div');
  busca.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px';
  busca.innerHTML = `
    <input id="est-busca" placeholder="🔍 Buscar por título ou artista…" style="flex:1;min-width:240px;max-width:420px">
    <select id="est-artista"><option value="">Todos os artistas</option>
      ${artistas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>`;
  alvo.appendChild(busca);

  const grade = document.createElement('div');
  grade.className = 'grade-cartoes';
  const renderLista = () => {
    const f = busca.querySelector('#est-busca').value.toLowerCase();
    const art = busca.querySelector('#est-artista').value;
    grade.innerHTML = '';
    for (const mu of musicas.filter((x) =>
      (!f || x.titulo.toLowerCase().includes(f) || (x.artista || '').toLowerCase().includes(f)) &&
      (!art || x.artista === art))) {
      const card = document.createElement('div');
      card.className = 'cartao cartao-clicavel';
      card.style.marginBottom = '0';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <strong style="min-width:0">${esc(mu.titulo)}</strong>
          ${ehLider() ? `<button class="botao mini" data-add-setlist title="Salvar numa setlist">📋+</button>` : ''}
        </div>
        <div class="meta">${esc(mu.artista || '')}${mu.classificacao ? ' · ' + esc(mu.classificacao) : ''}</div>
        <div style="margin-top:8px">
          ${mu.tom ? `<span class="selo destaque">Tom ${esc(mu.tom)}</span>` : ''}
          ${mu.bpm ? `<span class="selo neutro">${mu.bpm} BPM</span>` : ''}
          <span class="selo neutro">${mu.vezes_usada}x usada</span>
          ${mu.versoes ? `<span class="selo destaque" title="Esta música tem versões salvas">🗂 ${mu.versoes} versão(ões)</span>` : ''}
        </div>`;
      card.onclick = (e) => {
        if (e.target.closest('[data-add-setlist]')) { abrirSalvarEmSetlist(mu); return; }
        location.hash = `#/musica/${mu.id}`;
      };
      grade.appendChild(card);
    }
    if (!grade.children.length) grade.innerHTML = '<p class="vazio">Nenhuma música encontrada.</p>';
  };
  renderLista();
  alvo.appendChild(grade);
  busca.querySelector('#est-busca').addEventListener('input', renderLista);
  busca.querySelector('#est-artista').addEventListener('change', renderLista);

  // Estatísticas (dataviz)
  alvo.insertAdjacentHTML('beforeend', '<h2>Estatísticas</h2>');
  const gg = document.createElement('div');
  gg.className = 'grade-graficos';
  gg.appendChild(grafBarras('Louvores mais usados', est.maisUsadas.filter((m) => m.vezes > 0).slice(0, 8)
    .map((m) => ({ nome: m.titulo + (m.tom_mais_usado ? ` (${m.tom_mais_usado})` : ''), valor: m.vezes })), { unidade: 'x' }));
  gg.appendChild(grafBarras('Tons mais usados nos cultos', est.tons.slice(0, 8)
    .map((t) => ({ nome: 'Tom ' + t.tom, valor: t.vezes })), { classe: 'serie-2', unidade: 'x' }));
  alvo.appendChild(gg);

  // Uso mensal (tabela simples)
  if (est.usoMensal.length) {
    const meses = [...new Set(est.usoMensal.map((u) => u.mes))].slice(0, 3);
    let html = '<h2>Classificação mensal</h2>';
    for (const mes of meses) {
      const doMes = est.usoMensal.filter((u) => u.mes === mes);
      html += `<div class="cartao"><strong>${mes.split('-').reverse().join('/')}</strong>${
        doMes.map((u) => `<div class="item-lista">${esc(u.titulo)} — <strong>${u.vezes}x</strong></div>`).join('')}</div>`;
    }
    alvo.insertAdjacentHTML('beforeend', html);
  }
});

// Salva uma música numa setlist existente ou numa lista nova, com tom opcional.
async function abrirSalvarEmSetlist(mu) {
  const setlists = await api('GET', '/api/setlists').catch(() => []);
  const m = abrirModal(`<h2>📋 Salvar “${esc(mu.titulo)}” numa setlist</h2>
    <div class="form-linha"><label>Setlist</label><select id="ss-sel">
      ${setlists.map((s) => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}
      <option value="nova" ${setlists.length ? '' : 'selected'}>➕ Nova lista…</option></select></div>
    <div class="form-linha ${setlists.length ? 'oculto' : ''}" id="ss-grupo-nome"><label>Nome da nova setlist</label>
      <input id="ss-nome" placeholder="Ex.: Culto de domingo 12/07"></div>
    <div class="form-linha"><label>Tom nesta lista (opcional)</label><input id="ss-tom" value="${esc(mu.tom || '')}" placeholder="Ex.: G"></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="ss-ok">Salvar</button></div>`);
  const sel = m.querySelector('#ss-sel');
  sel.onchange = () => m.querySelector('#ss-grupo-nome').classList.toggle('oculto', sel.value !== 'nova');
  m.querySelector('#ss-ok').onclick = async () => {
    let setlistId = sel.value;
    let nomeLista = setlists.find((s) => String(s.id) === setlistId)?.nome;
    if (setlistId === 'nova') {
      nomeLista = m.querySelector('#ss-nome').value.trim();
      if (!nomeLista) return toast('Dê um nome à nova setlist.', true);
      const nova = await tentar(() => api('POST', '/api/setlists', { nome: nomeLista }));
      if (!nova) return;
      setlistId = nova.id;
    }
    if (await tentar(() => api('POST', `/api/setlists/${setlistId}/musicas`, {
      musica_id: mu.id, tom: m.querySelector('#ss-tom').value.trim() || null,
    }), `Salva na setlist “${nomeLista}”. 📋`)) fecharModal();
  };
}

// Botões de marcador de região para um textarea: clique insere a tag na posição
// do cursor (linha própria); se a tag já existe no texto, o clique a remove —
// nunca duplica. O botão fica aceso enquanto o marcador estiver presente.
const MARCADORES_REGIAO = ['INTRO', 'VERSO', 'PRÉ-REFRÃO', 'REFRÃO', 'SOLO', 'FINAL'];
function ligarMarcadores(m, barra) {
  const ta = m.querySelector('#' + barra.dataset.marcadores);
  if (!ta) return;
  barra.innerHTML = MARCADORES_REGIAO.map((x) => `<button type="button" class="botao mini" data-marca="${x}">[${x}]</button>`).join('');
  const tem = (x) => ta.value.includes(`[${x}]`);
  const atualizar = () => barra.querySelectorAll('[data-marca]').forEach((b) =>
    b.classList.toggle('primario', tem(b.dataset.marca)));
  barra.querySelectorAll('[data-marca]').forEach((b) => b.onclick = () => {
    const tag = `[${b.dataset.marca}]`;
    if (tem(b.dataset.marca)) {
      // Remove todas as ocorrências: linhas só com a tag somem; tags no meio de linha são apagadas.
      ta.value = ta.value.split('\n').filter((l) => l.trim() !== tag).join('\n').split(tag).join('');
    } else {
      const pos = ta.selectionStart ?? ta.value.length;
      const antes = ta.value.slice(0, pos), depois = ta.value.slice(pos);
      const ins = (antes && !antes.endsWith('\n') ? '\n' : '') + tag + (depois.startsWith('\n') || !depois ? '' : '\n');
      ta.value = antes + ins + depois;
      const novo = (antes + ins).length;
      ta.focus();
      ta.setSelectionRange(novo, novo);
    }
    atualizar();
  });
  ta.addEventListener('input', atualizar);
  atualizar();
}

function formMusica(mu) {
  const m = abrirModal(`<h2>${mu ? 'Editar' : 'Nova'} música</h2>
    <div class="form-grade">
      <div class="form-linha"><label>Título</label><input id="mu-titulo" value="${esc(mu?.titulo || '')}"></div>
      <div class="form-linha"><label>Artista</label><input id="mu-artista" value="${esc(mu?.artista || '')}"></div>
    </div>
    <div class="form-grade">
      <div class="form-linha"><label>Tom original</label>
        <select id="mu-tom">${['', ...MusicaUtils.TONS].map((t) => `<option value="${t}" ${mu?.tom === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}</select></div>
      <div class="form-linha"><label>Classificação</label>
        <select id="mu-classif">${['', 'Louvor', 'Adoração', 'Hinário', 'Ceia', 'Infantil', 'Ofertório'].map((c) =>
          `<option value="${c}" ${mu?.classificacao === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}</select></div>
      <div class="form-linha"><label>BPM</label><input type="number" id="mu-bpm" value="${mu?.bpm || ''}" placeholder="Ex.: 72"></div>
      <div class="form-linha"><label>Duração</label><input id="mu-duracao" value="${esc(mu?.duracao || '')}" placeholder="Ex.: 5:32"></div>
    </div>
    <div class="form-linha"><label>Observações gerais</label><input id="mu-obs" value="${esc(mu?.observacoes || '')}" maxlength="130" placeholder="Ex.: começar só com teclado"></div>
    <div class="form-linha"><label>Buscar na internet (gratuito) — preenche letra e links de cifra, letra, YouTube e Spotify</label>
      <button class="botao" id="mu-buscar">🔍 Buscar na internet</button></div>
    <div class="form-linha"><label>Letra — clique num marcador para inserir na posição do cursor (clique de novo para remover)</label>
      <div class="marcadores" data-marcadores="mu-letra"></div>
      <textarea id="mu-letra" style="min-height:140px">${esc(mu?.letra || '')}</textarea></div>
    <div class="form-linha"><label>Cifra (texto — linhas de acordes acima da letra)</label>
      <div class="marcadores" data-marcadores="mu-cifra"></div>
      <textarea id="mu-cifra" style="min-height:140px">${esc(mu?.cifra || '')}</textarea></div>
    <div class="links-musica" id="mu-links-busca"></div>
    <div class="form-grade">
      <div class="form-linha"><label>Referência: Letra (URL)</label><input id="mu-letra-url" value="${esc(mu?.link_letra || '')}"></div>
      <div class="form-linha"><label>Referência: Cifra (URL)</label><input id="mu-cifraclub" value="${esc(mu?.link_cifraclub || '')}"></div>
      <div class="form-linha"><label>Referência: Áudio/Spotify (URL)</label><input id="mu-spotify" value="${esc(mu?.link_spotify || '')}"></div>
      <div class="form-linha"><label>Referência: Vídeo/YouTube (URL)</label><input id="mu-youtube" value="${esc(mu?.link_youtube || '')}"></div>
    </div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="mu-ok">Salvar</button></div>`);

  const atualizarLinksBusca = () => {
    const t = m.querySelector('#mu-titulo').value.trim(), a = m.querySelector('#mu-artista').value.trim();
    const q = encodeURIComponent(`${t} ${a}`.trim());
    m.querySelector('#mu-links-busca').innerHTML = t ? `
      <a href="https://www.cifraclub.com.br/?q=${q}" target="_blank">🎸 Cifra no Cifra Club</a>
      <a href="https://www.letras.mus.br/?q=${q}" target="_blank">📝 Letras.mus.br</a>
      <a href="https://open.spotify.com/search/${q}" target="_blank">▶ Spotify</a>` : '';
  };
  m.querySelector('#mu-titulo').addEventListener('input', atualizarLinksBusca);
  m.querySelector('#mu-artista').addEventListener('input', atualizarLinksBusca);
  atualizarLinksBusca();

  // Marcadores interativos: insere a tag na posição do cursor; clicar de novo remove.
  m.querySelectorAll('.marcadores').forEach((barra) => ligarMarcadores(m, barra));

  m.querySelector('#mu-buscar').onclick = async () => {
    const titulo = m.querySelector('#mu-titulo').value.trim();
    const artista = m.querySelector('#mu-artista').value.trim();
    if (!titulo || !artista) return toast('Preencha título e artista para buscar.', true);
    toast('Buscando na internet…');
    const preenchidos = [];

    // Letra completa (lyrics.ovh, gratuito) — não sobrescreve sem confirmar.
    const r = await tentar(() => api('GET', `/api/buscar-letra?titulo=${encodeURIComponent(titulo)}&artista=${encodeURIComponent(artista)}`));
    const taLetra = m.querySelector('#mu-letra');
    if (r?.encontrada && (!taLetra.value.trim() || confirm('Substituir a letra atual pela encontrada na internet?'))) {
      taLetra.value = r.letra;
      preenchidos.push('letra');
    }

    // Links de referência (letra, cifra, YouTube, Spotify) — só preenche campos vazios.
    const q = encodeURIComponent(`${titulo} ${artista}`.trim());
    const links = [
      ['#mu-letra-url', `https://www.letras.mus.br/?q=${q}`, 'link da letra'],
      ['#mu-cifraclub', `https://www.cifraclub.com.br/?q=${q}`, 'link da cifra'],
      ['#mu-youtube', `https://www.youtube.com/results?search_query=${q}`, 'link do YouTube'],
      ['#mu-spotify', `https://open.spotify.com/search/${q}`, 'link do Spotify'],
    ];
    for (const [sel, url, nome] of links) {
      const campo = m.querySelector(sel);
      if (!campo.value.trim()) { campo.value = url; preenchidos.push(nome); }
    }
    if (preenchidos.length) toast(`Preenchido: ${preenchidos.join(', ')}. ✅ Ajuste os links para a página exata se quiser.`);
    else toast(r?.erro || 'Nada novo para preencher — os campos já estavam completos.', !r?.encontrada);
  };

  m.querySelector('#mu-ok').onclick = async () => {
    const corpo = {
      titulo: m.querySelector('#mu-titulo').value.trim(),
      artista: m.querySelector('#mu-artista').value.trim(),
      tom: m.querySelector('#mu-tom').value || null,
      classificacao: m.querySelector('#mu-classif').value || null,
      bpm: Number(m.querySelector('#mu-bpm').value) || null,
      duracao: m.querySelector('#mu-duracao').value.trim() || null,
      observacoes: m.querySelector('#mu-obs').value.trim() || null,
      letra: m.querySelector('#mu-letra').value,
      cifra: m.querySelector('#mu-cifra').value,
      link_spotify: m.querySelector('#mu-spotify').value.trim(),
      link_cifraclub: m.querySelector('#mu-cifraclub').value.trim(),
      link_letra: m.querySelector('#mu-letra-url').value.trim(),
      link_youtube: m.querySelector('#mu-youtube').value.trim(),
    };
    if (!corpo.titulo) return toast('Informe o título.', true);
    const ok = await tentar(() => mu ? api('PUT', `/api/musicas/${mu.id}`, corpo) : api('POST', '/api/musicas', corpo), 'Música salva.');
    if (ok) { fecharModal(); if (!mu) location.hash = `#/musica/${ok.id}`; else navegar(); }
  };
}

// ---------- Música: letra/cifra/regiões/transposição/editor ----------
rota(/^#\/musica\/(\d+)$/, async (alvo, id) => {
  const musicas = await api('GET', '/api/musicas');
  const mu = musicas.find((x) => x.id === Number(id));
  if (!mu) { alvo.innerHTML = '<p class="vazio">Música não encontrada.</p>'; return; }
  const versoes = await api('GET', `/api/musicas/${id}/versoes`).catch(() => []);

  cabecalho(alvo, esc(mu.titulo),
    `${esc(mu.artista || '')} ${mu.classificacao ? `· <span class="selo destaque">${esc(mu.classificacao)}</span>` : ''} · usada ${mu.vezes_usada}x
     ${versoes.length ? `· <span class="selo destaque" title="Versões salvas desta música">🗂 ${versoes.length} versão(ões)</span>` : ''}
     &nbsp; ${autoria(mu.criado_por_nome, mu.criado_em)}`,
    ehLider() ? `<button class="botao" id="btn-setlist-mu">📋 Salvar em setlist</button>
      <button class="botao" id="btn-editar-meta">✏️ Dados</button>
      <button class="botao perigo" id="btn-excluir">Excluir</button>` : '');
  if (ehLider()) {
    document.getElementById('btn-setlist-mu').onclick = () => abrirSalvarEmSetlist(mu);
    document.getElementById('btn-editar-meta').onclick = () => formMusica(mu);
    document.getElementById('btn-excluir').onclick = async () => {
      if (confirm('Excluir esta música da estante?') && await tentar(() => api('DELETE', `/api/musicas/${mu.id}`), 'Música excluída.')) location.hash = '#/estante';
    };
  }

  // Tiles Tom · BPM · Duração (como no app de referência).
  alvo.insertAdjacentHTML('beforeend', `<div class="kpis" style="max-width:420px;grid-template-columns:repeat(3,1fr)">
    <div class="kpi"><div class="rotulo">Tom</div><div class="valor">${esc(mu.tom || '–')}</div></div>
    <div class="kpi"><div class="rotulo">BPM</div><div class="valor">${mu.bpm || '–'}</div></div>
    <div class="kpi"><div class="rotulo">Duração</div><div class="valor" style="font-size:22px">${esc(mu.duracao || '–')}</div></div>
  </div>
  ${mu.observacoes ? `<p class="meta" style="margin:-8px 0 14px">📝 ${esc(mu.observacoes)}</p>` : ''}`);

  const painel = document.createElement('div');
  painel.className = 'musica-painel';
  // A aba Cifra abre na visão Original (transponível e com acordes coloridos);
  // a "Versão editada" (HTML do editor, com as cores aplicadas à mão) fica a um clique.
  const estadoM = { modo: 'letra', tom: mu.tom || 'C', versaoEditada: false, versaoSel: null };

  const links = [
    mu.link_letra && `<a href="${esc(mu.link_letra)}" target="_blank">📝 Letra</a>`,
    mu.link_cifraclub && `<a href="${esc(mu.link_cifraclub)}" target="_blank">🎸 Cifra Club</a>`,
    mu.link_spotify && `<a href="${esc(mu.link_spotify)}" target="_blank">▶ Spotify</a>`,
    mu.link_youtube && `<a href="${esc(mu.link_youtube)}" target="_blank">📺 YouTube</a>`,
    mu.link_deezer && `<a href="${esc(mu.link_deezer)}" target="_blank">▶ Deezer</a>`,
  ].filter(Boolean).join('');

  function render() {
    const semitons = MusicaUtils.semitonsEntre(mu.tom || 'C', estadoM.tom);
    const textoBase = estadoM.modo === 'letra' ? (mu.letra || 'Sem letra cadastrada.') : (mu.cifra || 'Sem cifra cadastrada.');
    const textoTransposto = estadoM.modo === 'cifra' ? MusicaUtils.transporCifra(textoBase, semitons, estadoM.tom) : textoBase;
    const regioes = MusicaUtils.extrairRegioes(textoTransposto);
    const div = MusicaUtils.divisaoVocal(estadoM.tom);

    // Acordes coloridos na cifra (como no Cifra Club) — cor escolhida pelo usuário.
    const corpoLinhas = textoTransposto.split('\n').map((linha, i) => {
      const reg = regioes.find((r) => r.linha === i);
      if (reg) return `<span class="marca-regiao" id="reg-${i}">${esc(linha)}</span>`;
      if (estadoM.modo === 'cifra' && MusicaUtils.ehLinhaDeAcordes(linha)) {
        return linha.split(/(\s+)/).map((seg) =>
          /\S/.test(seg) && MusicaUtils.parseAcorde(seg) ? `<span class="acorde">${esc(seg)}</span>` : esc(seg)).join('');
      }
      return esc(linha);
    }).join('\n');

    const versaoSel = versoes.find((v) => v.id === estadoM.versaoSel) || null;
    painel.innerHTML = `
      <div class="barra-musica">
        <div class="abas" style="border:none;margin:0">
          <button class="aba ${estadoM.modo === 'letra' ? 'ativa' : ''}" data-modo="letra">Letra</button>
          <button class="aba ${estadoM.modo === 'cifra' ? 'ativa' : ''}" data-modo="cifra">Cifra</button>
          ${ehLider() ? `<button class="aba ${estadoM.modo === 'editor' ? 'ativa' : ''}" data-modo="editor">✏️ Editor</button>` : ''}
        </div>
        <span style="flex:1"></span>
        ${estadoM.modo === 'cifra' ? `<label class="meta" title="Cor de exibição dos acordes">🎨 Acordes
          <input type="color" id="cor-acorde" value="${corAcordeAtual()}" style="width:36px;height:26px;padding:2px;vertical-align:middle">
        </label>` : ''}
        <label class="meta">Tom
          <select id="sel-tom">${MusicaUtils.TONS.map((t) => `<option value="${t}" ${t === estadoM.tom ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <button class="botao mini" id="btn-cheia">⛶ Tela cheia</button>
      </div>
      ${versoes.length && estadoM.modo !== 'editor' ? `<div class="regioes">🗂
        <button class="regiao-chip ${!estadoM.versaoSel ? 'ativa' : ''}" data-versao="0">Original</button>
        ${versoes.map((v) => `<button class="regiao-chip ${estadoM.versaoSel === v.id ? 'ativa' : ''}" data-versao="${v.id}">${esc(v.nome)}</button>`).join('')}
      </div>` : ''}
      ${regioes.length && estadoM.modo !== 'editor' && !versaoSel ? `<div class="regioes">${
        regioes.map((r) => `<button class="regiao-chip" data-reg="reg-${r.linha}">${esc(r.nome)}</button>`).join('')}</div>` : ''}
      ${estadoM.modo === 'letra' && div && !versaoSel ? `
        <div class="divisao-vocal">🎙️ Divisão vocal em <strong>${esc(estadoM.tom)}</strong>:
          ${div.divisoes.map((d) => `<span class="voz">${d.voz}<span class="nota">${esc(d.nota)}</span></span>`).join('')}
          <span class="meta">(tônica · ${div.divisoes[1].papel} · 5ª)</span>
        </div>` : ''}
      ${estadoM.modo === 'cifra' && mu.cifra_html && !versaoSel ? `
        <div style="margin-bottom:10px">
          <button class="botao mini ${estadoM.versaoEditada ? 'primario' : ''}" id="btn-ver-editada">Versão editada</button>
          <button class="botao mini ${!estadoM.versaoEditada ? 'primario' : ''}" id="btn-ver-original">Original (transponível)</button>
        </div>` : ''}
      ${estadoM.modo === 'editor' ? renderEditor() :
        versaoSel
          ? `<p class="meta">🗂 Exibindo a versão “${esc(versaoSel.nome)}” (salva como está — a transposição vale só para a original).</p>
             <pre class="letra">${versaoSel.cifra_html || esc(versaoSel.letra || 'Versão sem conteúdo.')}</pre>`
          : (estadoM.modo === 'cifra' && mu.cifra_html && estadoM.versaoEditada
            ? `<pre class="letra">${mu.cifra_html}</pre>`
            : `<pre class="letra">${corpoLinhas}</pre>`)}
      ${estadoM.modo !== 'editor' ? `<div class="links-musica">${links}</div>` : ''}
    `;

    painel.querySelectorAll('.aba').forEach((a) => a.onclick = () => { estadoM.modo = a.dataset.modo; render(); });
    painel.querySelectorAll('[data-versao]').forEach((b) => b.onclick = () => {
      estadoM.versaoSel = Number(b.dataset.versao) || null;
      render();
    });
    const corSel = painel.querySelector('#cor-acorde');
    if (corSel) corSel.onchange = (e) => setCorAcorde(e.target.value);
    painel.querySelector('#sel-tom').onchange = (e) => { estadoM.tom = e.target.value; render(); };
    painel.querySelector('#btn-cheia').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else painel.requestFullscreen().catch(() => toast('Tela cheia não suportada.', true));
    };
    // Só os chips de região rolam a página — os de versão têm o próprio clique.
    painel.querySelectorAll('.regiao-chip[data-reg]').forEach((c) => c.onclick = () => {
      painel.querySelector('#' + c.dataset.reg)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const be = painel.querySelector('#btn-ver-editada'), bo = painel.querySelector('#btn-ver-original');
    if (be) be.onclick = () => { estadoM.versaoEditada = true; render(); };
    if (bo) bo.onclick = () => { estadoM.versaoEditada = false; render(); };
    if (estadoM.modo === 'editor') ligarEditor();
  }

  function renderEditor() {
    const conteudo = mu.cifra_html || esc(mu.cifra || '');
    return `
      <p class="meta">Ajuste fino da cifra: selecione um trecho e aplique negrito ou cor; insira marcadores de região. A versão editada fica salva no banco de louvores.</p>
      <div class="editor-toolbar">
        <button class="botao mini" data-cmd="bold"><strong>B</strong></button>
        <button class="botao mini" data-cor="#d03b3b" style="color:#d03b3b">■ vermelho</button>
        <button class="botao mini" data-cor="#2a78d6" style="color:#2a78d6">■ azul</button>
        <button class="botao mini" data-cor="#0ca30c" style="color:#0ca30c">■ verde</button>
        <button class="botao mini" id="ed-regiao">+ [REGIÃO]</button>
        <span style="flex:1"></span>
        <button class="botao mini" id="ed-versao">Salvar como versão…</button>
        <button class="botao mini primario" id="ed-salvar">💾 Salvar edição</button>
      </div>
      <div class="editor-cifra" id="editor" contenteditable="true">${conteudo}</div>
      ${versoes.length ? `<h2>Versões salvas</h2>${versoes.map((v) => `
        <div class="slot"><div><strong>${esc(v.nome)}</strong> <span class="autoria">por ${esc(v.criado_por_nome || '—')} · ${fmtDataHora(v.criado_em)}</span></div>
        <div class="acoes"><button class="botao mini" data-ver-versao="${v.id}">Ver</button>
        <button class="botao mini perigo" data-del-versao="${v.id}">Excluir</button></div></div>`).join('')}` : ''}`;
  }

  function ligarEditor() {
    const editor = painel.querySelector('#editor');
    painel.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => { document.execCommand(b.dataset.cmd); editor.focus(); });
    painel.querySelectorAll('[data-cor]').forEach((b) => b.onclick = () => { document.execCommand('foreColor', false, b.dataset.cor); editor.focus(); });
    painel.querySelector('#ed-regiao').onclick = () => {
      const nome = prompt('Nome da região (ex.: INTRO, PRÉ-REFRÃO, REFRÃO, SOLO, FINAL):', 'REFRÃO');
      if (nome) document.execCommand('insertText', false, `\n[${nome.toUpperCase()}]\n`);
      editor.focus();
    };
    painel.querySelector('#ed-salvar').onclick = async () => {
      mu.cifra_html = editor.innerHTML;
      if (await tentar(() => api('PUT', `/api/musicas/${mu.id}`, { cifra_html: mu.cifra_html }), 'Edição salva no banco de louvores. 💾')) {
        estadoM.versaoEditada = true;
      }
    };
    painel.querySelector('#ed-versao').onclick = async () => {
      const nome = prompt('Nome da versão (ex.: Versão acústica, Trecho ceia):');
      if (!nome) return;
      if (await tentar(() => api('POST', `/api/musicas/${mu.id}/versoes`, { nome, cifra_html: editor.innerHTML }), 'Versão salva.')) {
        const nv = await api('GET', `/api/musicas/${id}/versoes`);
        versoes.length = 0; versoes.push(...nv); render();
      }
    };
    painel.querySelectorAll('[data-ver-versao]').forEach((b) => b.onclick = () => {
      const v = versoes.find((x) => x.id === Number(b.dataset.verVersao));
      abrirModal(`<h2>${esc(v.nome)}</h2><pre class="letra">${v.cifra_html || esc(v.letra || '')}</pre>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button></div>`);
    });
    painel.querySelectorAll('[data-del-versao]').forEach((b) => b.onclick = async () => {
      if (await tentar(() => api('DELETE', `/api/versoes/${b.dataset.delVersao}`), 'Versão excluída.')) {
        const i = versoes.findIndex((x) => x.id === Number(b.dataset.delVersao));
        if (i >= 0) versoes.splice(i, 1);
        render();
      }
    });
  }

  render();
  alvo.appendChild(painel);
});

// ---------- Setlists ----------
rota(/^#\/setlists$/, async (alvo) => {
  const setlists = await api('GET', '/api/setlists');
  cabecalho(alvo, '📋 Setlists', 'Listas de louvores para ensaios e cultos.',
    ehLider() ? '<button class="botao primario" id="btn-nova-sl">+ Nova setlist</button>' : '');
  if (ehLider()) document.getElementById('btn-nova-sl').onclick = async () => {
    const nome = prompt('Nome da setlist (ex.: Ceia de Julho):');
    if (!nome) return;
    if (await tentar(() => api('POST', '/api/setlists', { nome }), 'Setlist criada.')) navegar();
  };
  if (!setlists.length) { alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma setlist.</p>'); return; }
  for (const sl of setlists) {
    const itens = await api('GET', `/api/setlists/${sl.id}/musicas`);
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <strong>${esc(sl.nome)}</strong>
      <div>${autoria(sl.criado_por_nome, sl.criado_em)}
        ${ehLider() ? `<button class="botao mini" data-add-sl="${sl.id}">+ Música</button>
        <button class="botao mini perigo" data-del-sl="${sl.id}">Excluir</button>` : ''}</div></div>
      ${itens.map((it, i) => `<div class="slot"><div>${i + 1}. <a href="#/musica/${it.id}">${esc(it.titulo)}</a>
        ${it.tom_execucao ? `<span class="selo destaque">Tom ${esc(it.tom_execucao)}</span>` : ''}
        <span class="meta">${esc(it.artista || '')}</span></div>
        ${ehLider() ? `<button class="botao mini perigo" data-del-item="${it.item_id}">×</button>` : ''}</div>`).join('') ||
      '<p class="vazio">Setlist vazia.</p>'}`;
    alvo.appendChild(card);
  }
  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.addSl) {
      const musicas = await api('GET', '/api/musicas');
      const m = abrirModal(`<h2>Adicionar música</h2>
        <div class="form-linha"><label>Música</label><select id="sl-mus">${
          musicas.map((x) => `<option value="${x.id}" data-tom="${esc(x.tom || '')}">${esc(x.titulo)}</option>`).join('')}</select></div>
        <div class="form-linha"><label>Tom</label><input id="sl-tom"></div>
        <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
        <button class="botao primario" id="sl-ok">Adicionar</button></div>`);
      const sel = m.querySelector('#sl-mus');
      const pre = () => { m.querySelector('#sl-tom').value = sel.selectedOptions[0]?.dataset.tom || ''; };
      sel.onchange = pre; pre();
      m.querySelector('#sl-ok').onclick = async () => {
        if (await tentar(() => api('POST', `/api/setlists/${btn.dataset.addSl}/musicas`, {
          musica_id: Number(sel.value), tom: m.querySelector('#sl-tom').value.trim() || null,
        }), 'Música adicionada.')) { fecharModal(); navegar(); }
      };
    } else if (btn.dataset.delSl) {
      if (confirm('Excluir esta setlist?') && await tentar(() => api('DELETE', `/api/setlists/${btn.dataset.delSl}`), 'Setlist excluída.')) navegar();
    } else if (btn.dataset.delItem) {
      if (await tentar(() => api('DELETE', `/api/setlist-musicas/${btn.dataset.delItem}`), 'Removida.')) navegar();
    }
  });
});

// =====================================================================
// GESTÃO (líder) — dashboard, celebrações, ministérios, voluntários, feedbacks
// =====================================================================
rota(/^#\/dashboard$/, async (alvo) => {
  const hoje = hojeISO();
  const [ano, mes] = hoje.split('-').map(Number);
  const p2 = (n) => String(n).padStart(2, '0');
  const FILTROS = [
    ['Últimos 7 dias', hojeISO(-7), hoje],
    ['Mês atual', `${ano}-${p2(mes)}-01`, `${ano}-${p2(mes)}-${p2(new Date(ano, mes, 0).getDate())}`],
    ['± 30 dias', hojeISO(-30), hojeISO(30)],
    ['Últimos 90 dias', hojeISO(-90), hoje],
  ];
  cabecalho(alvo, '📊 Visão geral', 'Indicadores do voluntariado no período selecionado.');
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px';
  const corpo = document.createElement('div');
  alvo.appendChild(chips);
  alvo.appendChild(corpo);

  let ativo = 2; // padrão: ± 30 dias
  async function render() {
    chips.innerHTML = FILTROS.map(([rotulo], i) =>
      `<button class="botao mini ${i === ativo ? 'primario' : ''}" data-filtro="${i}">${rotulo}</button>`).join('') +
      `<span class="meta" style="align-self:center">· ${fmtData(FILTROS[ativo][1])} → ${fmtData(FILTROS[ativo][2])}</span>`;
    const d = await api('GET', `/api/dashboard?de=${FILTROS[ativo][1]}&ate=${FILTROS[ativo][2]}`);
    const k = d.kpis;
    const tile = (rotulo, valor, unidade = '') =>
      `<div class="kpi"><div class="rotulo">${rotulo}</div><div class="valor">${valor ?? '–'}<span class="unidade">${unidade}</span></div></div>`;
    corpo.innerHTML = `<div class="kpis">${
      tile('Cultos no período', k.escalas_periodo) +
      tile('Total de escalações', k.total_escalacoes) +
      tile('Membros escalados', `${k.membros_escalados}<span class="unidade">/${k.voluntarios_ativos}</span>`) +
      tile('Confirmação', k.taxa_confirmacao, k.taxa_confirmacao == null ? '' : '%') +
      tile('Check-in', k.taxa_checkin, k.taxa_checkin == null ? '' : '%') +
      tile('Faltas', k.faltas) +
      tile('Indisponibilidades', k.indisponibilidades) +
      tile('Louvores selecionados', k.musicas_selecionadas) +
      tile('Trocas aguardando', k.trocas_abertas) +
      tile('Vagas em aberto (7 dias)', Math.max(0, k.vagas_abertas_7d)) +
      tile('Nota média', k.nota_media ?? '–')
    }</div>`;
    const grade = document.createElement('div');
    grade.className = 'grade-graficos';
    grade.appendChild(grafBarras('Distribuição de escalas por voluntário', d.distribuicao.map((x) => ({ nome: x.nome, valor: x.escalas })), { unidade: ' escala(s)' }));
    grade.appendChild(grafBarras('Ranking de pontos', d.ranking.map((x) => ({ nome: x.nome, valor: x.pontos })), { classe: 'serie-2', unidade: ' pts' }));
    corpo.appendChild(grade);
    corpo.insertAdjacentHTML('beforeend', `<div class="cartao" style="margin-top:14px">
      <h3 style="margin:0 0 10px;font-size:14px">Voluntários por ministério</h3>${
      d.porMinisterio.map((m) => `<div class="item-lista"><span class="ponto-cor" style="background:${esc(m.cor)}"></span>${esc(m.nome)} — <strong>${m.voluntarios}</strong> voluntário(s)</div>`).join('')
    }</div>`);
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filtro]');
    if (!b) return;
    ativo = Number(b.dataset.filtro);
    render();
  });
  render();
});

rota(/^#\/eventos$/, async (alvo) => {
  const [eventos, locais] = await Promise.all([api('GET', '/api/eventos'), api('GET', '/api/locais')]);
  cabecalho(alvo, '⛪ Celebrações', 'Cultos e eventos recorrentes ou avulsos — a base das ocorrências.',
    '<button class="botao" id="btn-locais">Locais</button><button class="botao primario" id="btn-novo">+ Nova celebração</button>');
  const nomeLocal = (id) => locais.find((l) => l.id === id)?.nome || '—';
  const tabela = document.createElement('table');
  tabela.className = 'tabela';
  tabela.innerHTML = `<thead><tr><th>Nome</th><th>Local</th><th>Quando</th><th>Criada por</th><th></th></tr></thead><tbody>${
    eventos.map((ev) => `<tr>
      <td><strong>${esc(ev.nome)}</strong> ${ev.ativo ? '' : '<span class="selo neutro">inativa</span>'}</td>
      <td>${esc(nomeLocal(ev.local_id))}</td>
      <td>${ev.recorrente ? `Toda ${DIAS[ev.dia_semana]?.toLowerCase()} às ${ev.hora_inicio}` : `${fmtData(ev.data)} às ${ev.hora_inicio}`}</td>
      <td class="meta">${esc(ev.criado_por_nome || '—')}</td>
      <td style="text-align:right">
        <button class="botao mini" data-vagas="${ev.id}">Vagas</button>
        <button class="botao mini" data-editar="${ev.id}">Editar</button>
        <button class="botao mini perigo" data-excluir="${ev.id}">Excluir</button>
      </td></tr>`).join('')}</tbody>`;
  alvo.appendChild(tabela);
  if (!eventos.length) alvo.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhuma celebração cadastrada.</p>');

  document.getElementById('btn-novo').onclick = () => formEvento(null, locais);
  document.getElementById('btn-locais').onclick = () => gerirLocais(locais);
  tabela.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.editar) formEvento(eventos.find((x) => x.id === Number(btn.dataset.editar)), locais);
    if (btn.dataset.vagas) formNecessidades(Number(btn.dataset.vagas));
    if (btn.dataset.excluir && confirm('Excluir esta celebração e suas ocorrências?')) {
      if (await tentar(() => api('DELETE', `/api/eventos/${btn.dataset.excluir}`), 'Celebração excluída.')) navegar();
    }
  });
});

function formEvento(ev, locais) {
  const m = abrirModal(`<h2>${ev ? 'Editar' : 'Nova'} celebração</h2>
    <div class="form-linha"><label>Nome</label><input id="f-nome" value="${esc(ev?.nome || '')}"></div>
    <div class="form-grade">
      <div class="form-linha"><label>Local</label><select id="f-local">
        ${locais.map((l) => `<option value="${l.id}" ${ev?.local_id === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></div>
      <div class="form-linha"><label>Tipo</label><select id="f-rec">
        <option value="1" ${ev?.recorrente !== 0 ? 'selected' : ''}>Semanal</option>
        <option value="0" ${ev?.recorrente === 0 ? 'selected' : ''}>Data única</option></select></div>
      <div class="form-linha" id="grupo-dia"><label>Dia da semana</label><select id="f-dia">
        ${DIAS.map((d, i) => `<option value="${i}" ${ev?.dia_semana === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="form-linha oculto" id="grupo-data"><label>Data</label><input type="date" id="f-data" value="${esc(ev?.data || '')}"></div>
      <div class="form-linha"><label>Hora de início</label><input type="time" id="f-hora" value="${esc(ev?.hora_inicio || '19:00')}"></div>
      <div class="form-linha"><label>Duração (min)</label><input type="number" id="f-dur" value="${ev?.duracao_min || 120}"></div>
      <div class="form-linha" id="grupo-intervalo"><label>Repete a cada (semanas)</label>
        <input type="number" id="f-intervalo" min="1" max="8" value="${ev?.intervalo_semanas || 1}"></div>
      <div class="form-linha" id="grupo-termino"><label>Término</label><select id="f-termino">
        <option value="nunca" ${!ev?.termina_em && !ev?.max_ocorrencias ? 'selected' : ''}>Nunca</option>
        <option value="data" ${ev?.termina_em ? 'selected' : ''}>Em uma data</option>
        <option value="apos" ${ev?.max_ocorrencias ? 'selected' : ''}>Após N ocorrências</option></select></div>
      <div class="form-linha oculto" id="grupo-termina-data"><label>Termina em</label>
        <input type="date" id="f-termina-em" value="${esc(ev?.termina_em || '')}"></div>
      <div class="form-linha oculto" id="grupo-termina-apos"><label>Nº de ocorrências</label>
        <input type="number" id="f-max" min="1" value="${ev?.max_ocorrencias || 10}"></div>
    </div>
    <div class="meta" id="f-preview" style="margin-bottom:10px"></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="f-ok">Salvar</button></div>`);
  const atualizarTipo = () => {
    const rec = m.querySelector('#f-rec').value === '1';
    m.querySelector('#grupo-dia').classList.toggle('oculto', !rec);
    m.querySelector('#grupo-data').classList.toggle('oculto', rec);
    m.querySelector('#grupo-intervalo').classList.toggle('oculto', !rec);
    m.querySelector('#grupo-termino').classList.toggle('oculto', !rec);
    const termino = m.querySelector('#f-termino').value;
    m.querySelector('#grupo-termina-data').classList.toggle('oculto', !rec || termino !== 'data');
    m.querySelector('#grupo-termina-apos').classList.toggle('oculto', !rec || termino !== 'apos');
    atualizarPreview();
  };
  async function atualizarPreview() {
    const rec = m.querySelector('#f-rec').value === '1';
    const alvoPrev = m.querySelector('#f-preview');
    if (!rec) { alvoPrev.textContent = ''; return; }
    const r = await api('POST', '/api/eventos/preview-ocorrencias', {
      recorrente: 1,
      dia_semana: Number(m.querySelector('#f-dia').value),
      intervalo_semanas: Number(m.querySelector('#f-intervalo').value) || 1,
      termina_em: m.querySelector('#f-termino').value === 'data' ? m.querySelector('#f-termina-em').value || null : null,
    }).catch(() => null);
    if (r) alvoPrev.innerHTML = '📅 Próximas ocorrências: ' + (r.datas.map(fmtData).join(' · ') || '—');
  }
  ['#f-rec', '#f-dia', '#f-intervalo', '#f-termino', '#f-termina-em'].forEach((s) => {
    m.querySelector(s).addEventListener('change', atualizarTipo);
  });
  atualizarTipo();
  m.querySelector('#f-ok').onclick = async () => {
    const termino = m.querySelector('#f-termino').value;
    const corpo = {
      nome: m.querySelector('#f-nome').value.trim(),
      local_id: Number(m.querySelector('#f-local').value),
      recorrente: Number(m.querySelector('#f-rec').value),
      dia_semana: Number(m.querySelector('#f-dia').value),
      data: m.querySelector('#f-data').value || null,
      hora_inicio: m.querySelector('#f-hora').value,
      duracao_min: Number(m.querySelector('#f-dur').value),
      intervalo_semanas: Number(m.querySelector('#f-intervalo').value) || 1,
      termina_em: termino === 'data' ? m.querySelector('#f-termina-em').value || null : null,
      max_ocorrencias: termino === 'apos' ? Number(m.querySelector('#f-max').value) || null : null,
    };
    if (!corpo.nome) return toast('Informe o nome.', true);
    const ok = await tentar(() => ev ? api('PUT', `/api/eventos/${ev.id}`, corpo) : api('POST', '/api/eventos', corpo), 'Celebração salva.');
    if (ok) { fecharModal(); navegar(); }
  };
}

async function formNecessidades(eventoId) {
  const [needs, ministerios] = await Promise.all([
    api('GET', `/api/eventos/${eventoId}/necessidades`),
    api('GET', '/api/ministerios'),
  ]);
  const funcoes = (await Promise.all(ministerios.map((mi) => api('GET', `/api/funcoes?ministerio_id=${mi.id}`)))).flat();
  const m = abrirModal(`<h2>Vagas por função</h2>
    ${needs.map((n) => `<div class="slot"><div>${esc(n.funcao_nome)} <span class="meta">(${esc(n.ministerio_nome)})</span> — <strong>${n.quantidade}</strong> vaga(s)</div>
      <button class="botao mini perigo" data-del="${n.funcao_id}">Remover</button></div>`).join('') || '<p class="vazio">Nenhuma vaga definida.</p>'}
    <div class="form-grade" style="margin-top:14px">
      <div class="form-linha"><label>Função</label><select id="n-funcao">
        ${funcoes.map((f) => {
          const mi = ministerios.find((x) => x.id === f.ministerio_id);
          return `<option value="${f.id}">${esc(mi?.nome)} — ${esc(f.nome)}</option>`;
        }).join('')}</select></div>
      <div class="form-linha"><label>Quantidade</label><input type="number" id="n-qtd" value="1" min="1"></div>
    </div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button>
    <button class="botao primario" id="n-ok">Adicionar/atualizar</button></div>`);
  m.querySelector('#n-ok').onclick = async () => {
    if (await tentar(() => api('POST', `/api/eventos/${eventoId}/necessidades`, {
      funcao_id: Number(m.querySelector('#n-funcao').value),
      quantidade: Number(m.querySelector('#n-qtd').value),
    }), 'Vaga salva.')) formNecessidades(eventoId);
  };
  m.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del]');
    if (!btn) return;
    if (await tentar(() => api('DELETE', `/api/eventos/${eventoId}/necessidades/${btn.dataset.del}`), 'Vaga removida.')) formNecessidades(eventoId);
  });
}

function gerirLocais(locais) {
  const m = abrirModal(`<h2>Locais</h2>
    ${locais.map((l) => `<div class="slot"><div>${esc(l.nome)} <span class="selo neutro">${l.tipo}</span></div>
      <button class="botao mini perigo" data-del="${l.id}">Excluir</button></div>`).join('') || '<p class="vazio">Nenhum local.</p>'}
    <div class="form-grade" style="margin-top:14px">
      <div class="form-linha"><label>Nome</label><input id="l-nome" placeholder="Ex.: Capela Santa Rita"></div>
      <div class="form-linha"><label>Tipo</label><select id="l-tipo"><option value="matriz">Matriz</option><option value="capela">Capela</option></select></div>
    </div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Fechar</button>
    <button class="botao primario" id="l-ok">Adicionar</button></div>`);
  m.querySelector('#l-ok').onclick = async () => {
    const nome = m.querySelector('#l-nome').value.trim();
    if (!nome) return toast('Informe o nome.', true);
    if (await tentar(() => api('POST', '/api/locais', { nome, tipo: m.querySelector('#l-tipo').value }), 'Local criado.')) { fecharModal(); navegar(); }
  };
  m.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del]');
    if (!btn) return;
    if (await tentar(() => api('DELETE', `/api/locais/${btn.dataset.del}`), 'Local excluído.')) { fecharModal(); navegar(); }
  });
}

rota(/^#\/ministerios$/, async (alvo) => {
  const ministerios = await api('GET', '/api/ministerios');
  cabecalho(alvo, '🏛️ Ministérios', 'Departamentos, suas funções e líderes.',
    '<button class="botao primario" id="btn-novo">+ Novo ministério</button>');
  document.getElementById('btn-novo').onclick = () => formMinisterio(null);
  const grade = document.createElement('div');
  grade.className = 'grade-cartoes';
  for (const mi of ministerios) {
    const funcoes = await api('GET', `/api/funcoes?ministerio_id=${mi.id}`);
    const card = document.createElement('div');
    card.className = 'cartao';
    card.style.marginBottom = '0';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="min-width:0;overflow-wrap:anywhere"><span class="ponto-cor" style="background:${esc(mi.cor)}"></span>${esc(mi.nome)}</strong>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="botao mini" data-editar="${mi.id}">Editar</button>
          <button class="botao mini perigo" data-excluir="${mi.id}">Excluir</button>
        </div>
      </div>
      ${funcoes.map((f) => `<div class="slot"><div style="min-width:0;overflow-wrap:anywhere">${esc(f.nome)}</div>
        <button class="botao mini perigo" style="flex-shrink:0" data-del-funcao="${f.id}">Remover</button></div>`).join('')}
      <div style="display:flex;gap:6px;margin-top:10px">
        <input placeholder="Nova função…" data-input-funcao="${mi.id}" style="flex:1;min-width:0">
        <button class="botao mini" style="flex-shrink:0;white-space:nowrap" data-add-funcao="${mi.id}">Adicionar</button>
      </div>`;
    grade.appendChild(card);
  }
  alvo.appendChild(grade);
  grade.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.inputFuncao)
      grade.querySelector(`button[data-add-funcao="${e.target.dataset.inputFuncao}"]`)?.click();
  });
  grade.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.editar) formMinisterio(ministerios.find((x) => x.id === Number(btn.dataset.editar)));
    if (btn.dataset.excluir && confirm('Excluir ministério, funções e vínculos?')) {
      if (await tentar(() => api('DELETE', `/api/ministerios/${btn.dataset.excluir}`), 'Ministério excluído.')) navegar();
    }
    if (btn.dataset.delFuncao && confirm('Remover esta função?')) {
      if (await tentar(() => api('DELETE', `/api/funcoes/${btn.dataset.delFuncao}`), 'Função removida.')) navegar();
    }
    if (btn.dataset.addFuncao) {
      const input = grade.querySelector(`input[data-input-funcao="${btn.dataset.addFuncao}"]`);
      const nome = input.value.trim();
      if (!nome) return toast('Digite o nome da função.', true);
      if (await tentar(() => api('POST', '/api/funcoes', { ministerio_id: Number(btn.dataset.addFuncao), nome }), 'Função criada.')) navegar();
    }
  });
});

function formMinisterio(mi) {
  const m = abrirModal(`<h2>${mi ? 'Editar' : 'Novo'} ministério</h2>
    <div class="form-linha"><label>Nome</label><input id="mi-nome" value="${esc(mi?.nome || '')}"></div>
    <div class="form-linha"><label>Cor</label><input type="color" id="mi-cor" value="${esc(mi?.cor || '#7c5cd6')}"></div>
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="mi-ok">Salvar</button></div>`);
  m.querySelector('#mi-ok').onclick = async () => {
    const corpo = { nome: m.querySelector('#mi-nome').value.trim(), cor: m.querySelector('#mi-cor').value };
    if (!corpo.nome) return toast('Informe o nome.', true);
    const ok = await tentar(() => mi ? api('PUT', `/api/ministerios/${mi.id}`, corpo) : api('POST', '/api/ministerios', corpo), 'Ministério salvo.');
    if (ok) { fecharModal(); navegar(); }
  };
}

rota(/^#\/voluntarios$/, async (alvo) => {
  const vols = await api('GET', '/api/voluntarios');
  cabecalho(alvo, '🧑‍🤝‍🧑 Voluntários', 'A equipe da sua igreja.',
    '<button class="botao primario" id="btn-novo">+ Novo voluntário</button>');
  document.getElementById('btn-novo').onclick = () => formVoluntario(null);
  const tabela = document.createElement('table');
  tabela.className = 'tabela';
  tabela.innerHTML = `<thead><tr><th>Nome</th><th>Contato</th><th>Termo</th><th>Status</th></tr></thead><tbody>${
    vols.map((v) => `<tr class="linha-clicavel" data-id="${v.id}">
      <td><strong>${esc(v.nome)}</strong></td>
      <td class="meta">${esc(v.telefone || '')} ${esc(v.email || '')}</td>
      <td>${v.termo_aceito_em ? '<span class="selo confirmado">aceito</span>' : '<span class="selo aviso">pendente</span>'}</td>
      <td>${v.ativo ? '<span class="selo confirmado">ativo</span>' : '<span class="selo neutro">inativo</span>'}</td>
    </tr>`).join('')}</tbody>`;
  tabela.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/voluntario/${tr.dataset.id}`;
  });
  alvo.appendChild(tabela);
});

function formVoluntario(v) {
  const m = abrirModal(`<h2>${v ? 'Editar' : 'Novo'} voluntário</h2>
    <div class="form-linha"><label>Nome</label><input id="v-nome" value="${esc(v?.nome || '')}"></div>
    <div class="form-grade">
      <div class="form-linha"><label>Telefone (WhatsApp)</label><input id="v-tel" value="${esc(v?.telefone || '')}"></div>
      <div class="form-linha"><label>E-mail</label><input id="v-email" value="${esc(v?.email || '')}"></div>
      <div class="form-linha"><label>Aniversário</label><input type="date" id="v-nasc" value="${esc(v?.nascimento && v.nascimento.length === 10 ? v.nascimento : '')}"></div>
    </div>
    ${v ? `<div class="form-linha"><label>Status</label><select id="v-ativo">
      <option value="1" ${v.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${!v.ativo ? 'selected' : ''}>Inativo</option></select></div>` : ''}
    <div class="form-acoes"><button class="botao" onclick="fecharModal()">Cancelar</button>
    <button class="botao primario" id="v-ok">Salvar</button></div>`);
  m.querySelector('#v-ok').onclick = async () => {
    const corpo = {
      nome: m.querySelector('#v-nome').value.trim(),
      telefone: m.querySelector('#v-tel').value.trim(),
      email: m.querySelector('#v-email').value.trim(),
      nascimento: m.querySelector('#v-nasc').value || null,
    };
    if (v) corpo.ativo = Number(m.querySelector('#v-ativo').value);
    if (!corpo.nome) return toast('Informe o nome.', true);
    const ok = await tentar(() => v ? api('PUT', `/api/voluntarios/${v.id}`, corpo) : api('POST', '/api/voluntarios', corpo), 'Voluntário salvo.');
    if (ok) { fecharModal(); navegar(); }
  };
}

rota(/^#\/voluntario\/(\d+)$/, async (alvo, id) => {
  const v = await api('GET', `/api/voluntarios/${id}/detalhe`);
  cabecalho(alvo, esc(v.nome),
    `${esc(v.telefone || '')} ${esc(v.email || '')} · <strong>${v.pontos} pontos</strong>`,
    `<button class="botao" id="btn-editar">Editar</button>
     ${v.termo_aceito_em ? '' : '<button class="botao primario" id="btn-termo">Registrar aceite do termo</button>'}`);
  document.getElementById('btn-editar').onclick = () => formVoluntario(v);
  const btnTermo = document.getElementById('btn-termo');
  if (btnTermo) btnTermo.onclick = async () => {
    if (await tentar(() => api('POST', `/api/voluntarios/${id}/termo`), 'Termo registrado (LGPD).')) navegar();
  };

  const ministerios = await api('GET', '/api/ministerios');
  const todasFuncoes = (await Promise.all(ministerios.map((mi) => api('GET', `/api/funcoes?ministerio_id=${mi.id}`)))).flat();
  const cardF = document.createElement('div');
  cardF.className = 'cartao';
  cardF.innerHTML = `<strong>Habilidades (funções por ministério)</strong>
    ${v.funcoes.map((f) => `<div class="slot"><div><span class="ponto-cor" style="background:${esc(f.cor)}"></span>${esc(f.ministerio_nome)} — ${esc(f.nome)}
      ${f.preferencia ? '<span class="selo confirmado">preferida</span>' : ''}</div>
      <button class="botao mini perigo" data-del-f="${f.id}">Remover</button></div>`).join('') || '<p class="vazio">Nenhuma função.</p>'}
    <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <select id="add-funcao" style="flex:1;min-width:200px">${todasFuncoes.map((f) => {
        const mi = ministerios.find((x) => x.id === f.ministerio_id);
        return `<option value="${f.id}">${esc(mi?.nome)} — ${esc(f.nome)}</option>`;
      }).join('')}</select>
      <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="add-pref">preferida</label>
      <button class="botao mini" id="btn-add-f">Adicionar</button>
    </div>`;
  alvo.appendChild(cardF);

  const cardD = document.createElement('div');
  cardD.className = 'cartao';
  cardD.innerHTML = `<strong>Disponibilidade semanal</strong>
    ${v.disponibilidade.map((d) => `<div class="slot"><div>${DIAS[d.dia_semana]} das ${d.hora_inicio} às ${d.hora_fim}</div>
      <button class="botao mini perigo" data-del-d="${d.id}">Remover</button></div>`).join('') || '<p class="vazio">Sempre disponível.</p>'}
    <strong style="display:block;margin-top:14px">Indisponibilidades justificadas</strong>
    ${v.bloqueios.map((b) => `<div class="slot"><div>${fmtData(b.data)} — <em>${esc(b.motivo)}</em></div>
      <button class="botao mini perigo" data-del-b="${b.id}">Remover</button></div>`).join('') || '<p class="vazio">Nenhuma.</p>'}`;
  alvo.appendChild(cardD);

  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btn-add-f') {
      if (await tentar(() => api('POST', `/api/voluntarios/${id}/funcoes`, {
        funcao_id: Number(cardF.querySelector('#add-funcao').value),
        preferencia: cardF.querySelector('#add-pref').checked,
      }), 'Função vinculada.')) navegar();
    } else if (btn.dataset.delF) {
      if (await tentar(() => api('DELETE', `/api/voluntarios/${id}/funcoes/${btn.dataset.delF}`), 'Função removida.')) navegar();
    } else if (btn.dataset.delD) {
      if (await tentar(() => api('DELETE', `/api/disponibilidade/${btn.dataset.delD}`), 'Janela removida.')) navegar();
    } else if (btn.dataset.delB) {
      if (await tentar(() => api('DELETE', `/api/bloqueios/${btn.dataset.delB}`), 'Bloqueio removido.')) navegar();
    }
  });
});

rota(/^#\/feedbacks$/, async (alvo) => {
  const fbs = await api('GET', '/api/feedback');
  cabecalho(alvo, '⭐ Feedbacks', 'Avaliações dos voluntários após os cultos — agradeça e acompanhe o clima da equipe.');
  if (!fbs.length) {
    alvo.insertAdjacentHTML('beforeend', `<p class="vazio">Nenhum feedback ainda. Os membros avaliam pelo botão
      “⭐ Avaliar culto” na página do culto (a partir do dia do culto) ou pela agenda.</p>`);
    return;
  }
  const media = (fbs.reduce((s, f) => s + f.nota, 0) / fbs.length).toFixed(1);
  alvo.insertAdjacentHTML('beforeend', `<div class="kpis">
    <div class="kpi"><div class="rotulo">Nota média</div><div class="valor">${media}<span class="unidade">/5</span></div></div>
    <div class="kpi"><div class="rotulo">Avaliações</div><div class="valor">${fbs.length}</div></div>
    <div class="kpi"><div class="rotulo">Com comentário</div><div class="valor">${fbs.filter((f) => f.comentario).length}</div></div>
  </div>`);
  alvo.appendChild(grafBarras('Distribuição das notas',
    [5, 4, 3, 2, 1].map((n) => ({ nome: estrelas(n), valor: fbs.filter((f) => f.nota === n).length }))));
  for (const f of fbs) {
    alvo.insertAdjacentHTML('beforeend', `<div class="cartao">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <span class="estrelas">${estrelas(f.nota)}</span> <strong>${esc(f.voluntario_nome)}</strong>
          <span class="meta">— ${esc(f.evento_nome)}, ${fmtData(f.data)} · enviado em ${fmtDataHora(f.criado_em)}</span>
          ${f.comentario ? `<div style="margin-top:6px">“${esc(f.comentario)}”</div>` : ''}
        </div>
        <div class="acoes">
          <button class="botao mini" data-agradecer="${f.id}">🙏 Agradecer</button>
          <button class="botao mini perigo" data-del-fb="${f.id}">Excluir</button>
        </div>
      </div>
    </div>`);
  }
  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.agradecer) {
      await tentar(() => api('POST', `/api/feedback/${btn.dataset.agradecer}/agradecer`, {}), 'Agradecimento enviado — o membro foi notificado. 🙏');
    } else if (btn.dataset.delFb) {
      if (await tentar(() => api('DELETE', `/api/feedback/${btn.dataset.delFb}`), 'Feedback excluído.')) navegar();
    }
  });
});

// =====================================================================
// ADMIN — usuários e papéis
// =====================================================================
rota(/^#\/usuarios$/, async (alvo) => {
  const [usuarios, ministerios, convites] = await Promise.all([
    api('GET', '/api/usuarios'), api('GET', '/api/ministerios'), api('GET', '/api/convites').catch(() => []),
  ]);
  cabecalho(alvo, '🔐 Usuários & papéis', 'Defina quem é admin, líder (e de quais ministérios) ou membro.',
    '<button class="botao primario" id="btn-convite">🔗 Gerar convite</button>');
  // Mensagem personalizada do convite (explica o objetivo do link).
  const msgConvite = (url, expiraEm) =>
    `🙌 Olá! Você foi convidado(a) para entrar no *Aclame*, o app de escalas e louvor da nossa igreja. ` +
    `É por ele que combinamos escalas, confirmações, trocas e repertório.\n\n` +
    `Crie sua conta por este link (uso único, válido até ${fmtDataHora(expiraEm)}):\n${url}\n\nQualquer dúvida, me chame!`;
  const zapConvite = (url, expiraEm) => `https://wa.me/?text=${encodeURIComponent(msgConvite(url, expiraEm))}`;
  const copiarConvite = async (url, expiraEm) => {
    try { await navigator.clipboard.writeText(msgConvite(url, expiraEm)); toast('Convite copiado com a mensagem pronta! 📋'); }
    catch { toast('Não consegui copiar automaticamente — selecione o texto do modal.', true); }
  };

  document.getElementById('btn-convite').onclick = async () => {
    const r = await tentar(() => api('POST', '/api/convites', {}));
    if (r) {
      const m = abrirModal(`<h2>🔗 Convite gerado</h2>
        <p>Link de <strong>uso único</strong>, válido por <strong>${r.validade_dias} dias</strong> (até ${fmtDataHora(r.expira_em)}).
        A mensagem já explica o objetivo do link para quem recebe.</p>
        <pre class="letra" style="user-select:all;white-space:pre-wrap">${esc(msgConvite(r.url, r.expira_em))}</pre>
        <div class="form-acoes" style="justify-content:flex-start;flex-wrap:wrap">
          <button class="botao" id="cv-copiar">📋 Copiar mensagem</button>
          <a class="botao whatsapp" href="${esc(zapConvite(r.url, r.expira_em))}" target="_blank">📲 Enviar por WhatsApp</a>
          <span style="flex:1"></span>
          <button class="botao" onclick="fecharModal()">Fechar</button>
        </div>`);
      m.querySelector('#cv-copiar').onclick = () => copiarConvite(r.url, r.expira_em);
      setTimeout(navegar, 400);
    }
  };
  if (convites.length) {
    alvo.insertAdjacentHTML('beforeend', `<div class="cartao"><strong>Convites gerados</strong>
      <p class="meta">Cada convite é de uso único e expira em 7 dias.</p>${
      convites.map((c) => `<div class="item-lista" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span><code>…${esc(c.token.slice(-8))}</code> · criado por ${esc(c.criado_por_nome || '—')} em ${fmtDataHora(c.criado_em)}
        ${c.usado_em ? `<span class="selo confirmado">usado por ${esc(c.usado_por_nome)}</span>`
          : c.expirado ? '<span class="selo recusado">expirado</span>'
          : `<span class="selo aguardando">disponível até ${fmtDataHora(c.expira_em)}</span>`}</span>
        ${!c.usado_em && !c.expirado ? `<span style="display:flex;gap:6px">
          <button class="botao mini" data-cv-copiar="${esc(c.url)}" data-cv-exp="${esc(c.expira_em)}">📋 Copiar</button>
          <a class="botao mini whatsapp" href="${esc(zapConvite(c.url, c.expira_em))}" target="_blank">📲 WhatsApp</a>
        </span>` : ''}
      </div>`).join('')}</div>`);
    alvo.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cv-copiar]');
      if (b) copiarConvite(b.dataset.cvCopiar, b.dataset.cvExp);
    });
  }
  for (const u of usuarios) {
    const card = document.createElement('div');
    card.className = 'cartao';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <strong>${esc(u.nome)}</strong>
          <div class="meta">${esc(u.telefone || '')} ${esc(u.email || '')} · desde ${fmtDataHora(u.criado_em)}</div>
          <div style="margin-top:6px">
            ${u.ministerios_liderados.map((l) => `<span class="selo destaque">lidera ${esc(l.nome)}
              <button class="botao mini perigo" style="padding:0 6px" data-del-lid="${u.id}:${l.ministerio_id}">×</button></span>`).join(' ')}
          </div>
        </div>
        <div class="acoes">
          <select data-papel="${u.id}">
            ${['membro', 'lider', 'admin'].map((p) => `<option value="${p}" ${u.papel === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <select data-add-lid="${u.id}">
            <option value="">+ liderança…</option>
            ${ministerios.map((mi) => `<option value="${mi.id}">${esc(mi.nome)}</option>`).join('')}
          </select>
          <button class="botao mini" data-senha="${u.id}">Redefinir senha</button>
        </div>
      </div>`;
    alvo.appendChild(card);
  }
  alvo.addEventListener('change', async (e) => {
    const sel = e.target;
    if (sel.dataset.papel) {
      if (await tentar(() => api('PUT', `/api/usuarios/${sel.dataset.papel}`, { papel: sel.value }), 'Papel atualizado.')) navegar();
    } else if (sel.dataset.addLid && sel.value) {
      if (await tentar(() => api('POST', `/api/usuarios/${sel.dataset.addLid}/lideranca`, { ministerio_id: Number(sel.value) }), 'Liderança atribuída.')) navegar();
    }
  });
  alvo.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.delLid) {
      const [uid, mid] = btn.dataset.delLid.split(':');
      if (await tentar(() => api('DELETE', `/api/usuarios/${uid}/lideranca/${mid}`), 'Liderança removida.')) navegar();
    } else if (btn.dataset.senha) {
      const senha = prompt('Nova senha para este usuário:');
      if (!senha) return;
      await tentar(() => api('PUT', `/api/usuarios/${btn.dataset.senha}`, { senha }), 'Senha redefinida.');
    }
  });
});

// ===== Inicialização =====
(async function iniciar() {
  document.getElementById('login-dica').textContent = 'Entre com seu telefone ou e-mail e a sua senha.';
  document.documentElement.style.setProperty('--cor-acorde', corAcordeAtual());
  // Convite de onboarding: ?convite=TOKEN abre direto no formulário de registro.
  const convite = new URLSearchParams(location.search).get('convite');
  if (convite) {
    estado.convite = convite;
    document.getElementById('login-form').classList.add('oculto');
    document.getElementById('registro-form').classList.remove('oculto');
    document.getElementById('login-dica').textContent = '🎉 Você foi convidado(a)! Crie sua conta para entrar na equipe.';
  }
  // Atalho de demonstração/teste: ?entrar=identificador:senha faz login automático.
  const entrar = new URLSearchParams(location.search).get('entrar');
  if (entrar) {
    const [identificador, senha] = entrar.split(':');
    const hashDesejado = location.hash;
    try {
      estado.me = await api('POST', '/api/auth/login', { identificador, senha });
      history.replaceState(null, '', location.pathname + hashDesejado);
    } catch { /* cai no fluxo normal */ }
  }
  try {
    if (!estado.me) estado.me = await api('GET', '/api/auth/me');
    mostrarApp();
    if (!location.hash || location.hash === '#/') irParaInicio(); else navegar();
  } catch {
    mostrarLogin();
  }
})();
