/* Utilidades musicais do Aclame: transposição de cifras, regiões e divisão vocal.
   Módulo UMD — roda no navegador (window.MusicaUtils) e no Node (require) para testes. */
(function (raiz, fabrica) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = fabrica();
  else raiz.MusicaUtils = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUSTENIDOS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const BEMOIS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Tons que convencionalmente se escrevem com bemóis.
  const TONS_BEMOIS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

  function indiceNota(nota) {
    const i = SUSTENIDOS.indexOf(nota);
    return i >= 0 ? i : BEMOIS.indexOf(nota);
  }

  function transporNota(nota, semitons, usarBemol) {
    const i = indiceNota(nota);
    if (i < 0) return nota;
    const alvo = ((i + semitons) % 12 + 12) % 12;
    return (usarBemol ? BEMOIS : SUSTENIDOS)[alvo];
  }

  // Acorde = raiz [A-G](#|b)? + sufixo (m, 7, sus4, add9, dim, °, maj7, 4, 9(11)…) + baixo opcional (/F#).
  const RE_ACORDE = /^([A-G](?:#|b)?)((?:m(?!aj)|maj|dim|aug|sus|add|[0-9]|[()#b+°ø\-])*)(?:\/([A-G](?:#|b)?))?$/;

  function parseAcorde(token) {
    const m = String(token).match(RE_ACORDE);
    if (!m) return null;
    return { raiz: m[1], sufixo: m[2] || '', baixo: m[3] || null };
  }

  function transporAcorde(token, semitons, usarBemol) {
    const a = parseAcorde(token);
    if (!a) return token;
    let r = transporNota(a.raiz, semitons, usarBemol) + a.sufixo;
    if (a.baixo) r += '/' + transporNota(a.baixo, semitons, usarBemol);
    return r;
  }

  // Tokens "neutros" que não invalidam uma linha de acordes.
  const RE_NEUTRO = /^([|\-–—.x*]+|x[0-9]+|[0-9]+x|\(|\)|,)$/i;

  // Linha de acordes: todo token é acorde ou neutro, e há pelo menos um acorde.
  // (Evita transpor letra: em "Em tua presença", "tua" não é acorde → linha não é de acordes.)
  function ehLinhaDeAcordes(linha) {
    const tokens = linha.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    let acordes = 0;
    for (const t of tokens) {
      if (parseAcorde(t)) acordes++;
      else if (!RE_NEUTRO.test(t)) return false;
    }
    return acordes > 0;
  }

  function semitonsEntre(tomDe, tomPara) {
    const de = indiceNota(String(tomDe).replace(/m$/, ''));
    const para = indiceNota(String(tomPara).replace(/m$/, ''));
    if (de < 0 || para < 0) return 0;
    return ((para - de) % 12 + 12) % 12;
  }

  // Transpõe somente as linhas de acordes do texto, preservando letra e marcadores de região.
  function transporCifra(texto, semitons, tomAlvo) {
    if (!semitons) return String(texto ?? '');
    const usarBemol = TONS_BEMOIS.has(String(tomAlvo || ''));
    return String(texto ?? '').split('\n').map((linha) => {
      if (!ehLinhaDeAcordes(linha)) return linha;
      return linha.split(/(\s+)/).map((seg) =>
        /\S/.test(seg) ? transporAcorde(seg, semitons, usarBemol) : seg).join('');
    }).join('\n');
  }

  // ---------- regiões ([INTRO], [REFRÃO], …) ----------
  const RE_REGIAO = /^\s*\[([^\]\n]{1,40})\]\s*$/;

  function extrairRegioes(texto) {
    const regioes = [];
    String(texto ?? '').split('\n').forEach((linha, i) => {
      const m = linha.match(RE_REGIAO);
      if (m && !parseAcorde(m[1].trim())) regioes.push({ nome: m[1].trim().toUpperCase(), linha: i });
    });
    return regioes;
  }

  // ---------- divisão vocal ----------
  // Tríade do tom: tônica / 3ª (maior +4, menor +3) / 5ª (+7).
  // Sugestão coral: Tenor = tônica · Contralto = 3ª · Soprano = 5ª.
  function divisaoVocal(tom) {
    if (!tom) return null;
    const menor = /m$/.test(tom);
    const raiz = String(tom).replace(/m$/, '');
    if (indiceNota(raiz) < 0) return null;
    const usarBemol = TONS_BEMOIS.has(tom);
    const tonica = transporNota(raiz, 0, usarBemol);
    const terca = transporNota(raiz, menor ? 3 : 4, usarBemol);
    const quinta = transporNota(raiz, 7, usarBemol);
    return {
      tom, tonica, terca, quinta,
      divisoes: [
        { voz: 'Tenor', nota: tonica, papel: 'tônica' },
        { voz: 'Contralto', nota: terca, papel: menor ? '3ª menor' : '3ª' },
        { voz: 'Soprano', nota: quinta, papel: '5ª' },
      ],
    };
  }

  const TONS = SUSTENIDOS.concat(SUSTENIDOS.map((n) => n + 'm'));

  function normalizarChave(titulo, artista) {
    return (String(titulo) + '|' + String(artista || ''))
      .toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9|]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  return {
    SUSTENIDOS, BEMOIS, TONS,
    indiceNota, transporNota, parseAcorde, transporAcorde, ehLinhaDeAcordes,
    semitonsEntre, transporCifra, extrairRegioes, divisaoVocal, normalizarChave,
  };
});
