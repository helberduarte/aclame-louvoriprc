'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const MU = require('../public/musica-utils');

test('parseAcorde reconhece acordes e rejeita palavras', () => {
  assert.deepEqual(MU.parseAcorde('C'), { raiz: 'C', sufixo: '', baixo: null });
  assert.deepEqual(MU.parseAcorde('F#m7'), { raiz: 'F#', sufixo: 'm7', baixo: null });
  assert.deepEqual(MU.parseAcorde('D/F#'), { raiz: 'D', sufixo: '', baixo: 'F#' });
  assert.deepEqual(MU.parseAcorde('Bb'), { raiz: 'Bb', sufixo: '', baixo: null });
  assert.ok(MU.parseAcorde('Gsus4'));
  assert.ok(MU.parseAcorde('C9(11)'));
  assert.ok(MU.parseAcorde('Em'), 'Em é acorde válido');
  assert.equal(MU.parseAcorde('tua'), null);
  assert.equal(MU.parseAcorde('Deus'), null);
  assert.equal(MU.parseAcorde('presença'), null);
});

test('ehLinhaDeAcordes distingue linha de acordes de linha de letra', () => {
  assert.equal(MU.ehLinhaDeAcordes('G  D/F#  Em7  C'), true);
  assert.equal(MU.ehLinhaDeAcordes('C  G  Am  F  x2'), true);
  assert.equal(MU.ehLinhaDeAcordes('Em tua presença é meu lugar'), false, '"Em" no meio de letra não transpõe');
  assert.equal(MU.ehLinhaDeAcordes('Deus é bom o tempo todo'), false);
  assert.equal(MU.ehLinhaDeAcordes(''), false);
});

test('transposição de nota e acorde com preferência por bemóis', () => {
  assert.equal(MU.transporNota('C', 2), 'D');
  assert.equal(MU.transporNota('B', 1), 'C');
  assert.equal(MU.transporNota('C', -1), 'B');
  assert.equal(MU.transporNota('A', 1, true), 'Bb');
  assert.equal(MU.transporAcorde('D/F#', 2), 'E/G#');
  assert.equal(MU.transporAcorde('Am7', 3), 'Cm7');
  assert.equal(MU.semitonsEntre('G', 'A'), 2);
  assert.equal(MU.semitonsEntre('D', 'C'), 10);
});

test('transporCifra muda só as linhas de acordes e preserva letra', () => {
  const cifra = '[REFRÃO]\nG        D/F#\nDeus é fiel em tudo\nEm7      C\nEm tua presença';
  const t = MU.transporCifra(cifra, 2, 'A');
  assert.match(t, /A {8}E\/G#/);
  assert.match(t, /F#m7 {6}D/);
  assert.match(t, /Deus é fiel em tudo/, 'letra intacta');
  assert.match(t, /Em tua presença/, 'linha de letra com "Em" não transposta');
  assert.match(t, /\[REFRÃO\]/, 'marcador de região intacto');
  assert.equal(MU.transporCifra(cifra, 0), cifra, 'semitons 0 = texto igual');
});

test('extrairRegioes acha marcadores e ignora acordes entre colchetes', () => {
  const texto = '[INTRO]\nG D\n\n[VERSO]\nletra\n\n[PRÉ-REFRÃO]\nletra\n[REFRÃO]\nletra\n[Em]\nnão é região';
  const r = MU.extrairRegioes(texto);
  assert.deepEqual(r.map((x) => x.nome), ['INTRO', 'VERSO', 'PRÉ-REFRÃO', 'REFRÃO']);
  assert.equal(r[0].linha, 0);
  assert.equal(r[1].linha, 3);
});

test('divisaoVocal devolve tríade do tom para soprano/contralto/tenor', () => {
  const g = MU.divisaoVocal('G');
  assert.equal(g.tonica, 'G');
  assert.equal(g.terca, 'B');
  assert.equal(g.quinta, 'D');
  assert.deepEqual(g.divisoes.map((d) => `${d.voz}:${d.nota}`), ['Tenor:G', 'Contralto:B', 'Soprano:D']);
  const em = MU.divisaoVocal('Em');
  assert.equal(em.terca, 'G', '3ª menor de Em é G');
  const f = MU.divisaoVocal('F');
  assert.equal(f.terca, 'A');
  assert.equal(MU.divisaoVocal('X'), null);
});

test('normalizarChave deduplica título+artista com acentos e caixa', () => {
  assert.equal(MU.normalizarChave('Não Há Deus Maior', 'Adoração'), MU.normalizarChave('nao ha deus maior', 'ADORACAO'));
  assert.notEqual(MU.normalizarChave('Oceanos', 'Hillsong'), MU.normalizarChave('Oceanos', 'Outro'));
});
