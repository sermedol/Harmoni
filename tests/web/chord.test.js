import test from "node:test";
import assert from "node:assert/strict";
import { parseChord, parseProgression, createProgressionPlayer } from "../../docs/js/music/chord.js";

const C4 = 60;

test("temel ucluler dogru cozumlenir", () => {
  assert.deepEqual(parseChord("C").notes, [C4, C4 + 4, C4 + 7]);
  assert.deepEqual(parseChord("Am").notes, [69, 72, 76]);
  assert.equal(parseChord("C").quality, "");
  assert.equal(parseChord("Am").quality, "m");
});

test("diyez ve bemol kok notalari", () => {
  assert.equal(parseChord("F#").root % 12, 6);
  assert.equal(parseChord("Bb").root % 12, 10);
  assert.equal(parseChord("Db").root % 12, 1);
  // Bemol isareti ile de calismali.
  assert.equal(parseChord("E♭").root % 12, 3);
});

test("yedili ve genisletilmis akorlar", () => {
  assert.deepEqual(parseChord("G7").intervals, [0, 4, 7, 10]);
  assert.deepEqual(parseChord("Cmaj7").intervals, [0, 4, 7, 11]);
  assert.deepEqual(parseChord("Dm7").intervals, [0, 3, 7, 10]);
  assert.deepEqual(parseChord("Csus4").intervals, [0, 5, 7]);
  assert.deepEqual(parseChord("Csus2").intervals, [0, 2, 7]);
  assert.deepEqual(parseChord("C5").intervals, [0, 7], "guc akoru yalnizca kok+beslli");
  assert.deepEqual(parseChord("Bdim").intervals, [0, 3, 6]);
});

test("buyuk/kucuk harf anlamini korur: M7 majör, m7 minör", () => {
  // Kucuk harfe cevirip karsilastirmak bu ikisini ayni yapar ve akoru
  // tamamen yanlis calar.
  assert.deepEqual(parseChord("CM7").intervals, [0, 4, 7, 11], "CM7 majör yedili");
  assert.deepEqual(parseChord("Cm7").intervals, [0, 3, 7, 10], "Cm7 minör yedili");
  // CM majör UCLU, CM7 majör yedili. Ikisi karistirilmamali.
  assert.deepEqual(parseChord("CM").intervals, [0, 4, 7], "CM majör uclu");
  assert.deepEqual(parseChord("Cm").intervals, [0, 3, 7], "Cm minör uclu");
  // Uzun ekler harf duyarsiz kabul edilir.
  assert.equal(parseChord("CMAJ7").quality, "maj7");
  assert.equal(parseChord("cmin7")?.quality ?? parseChord("Cmin7").quality, "m7");
});

test("uzun ekler kisa eklerden once eslesir", () => {
  // "maj7" bir "m" olarak okunursa akor tamamen yanlis calar.
  assert.equal(parseChord("Cmaj7").quality, "maj7");
  assert.equal(parseChord("Cm7").quality, "m7");
  assert.equal(parseChord("Cm").quality, "m");
});

test("slash akoru bas notasini ayri tutar", () => {
  const chord = parseChord("G/B");
  assert.ok(chord);
  assert.equal(chord.root % 12, 7, "akor kokü G olmali");
  assert.equal(chord.bass % 12, 11, "bas notasi B olmali");
  assert.ok(chord.bass < chord.root, "bas kokten asagida olmali");
});

test("Turkce nota adlari kabul edilir", () => {
  assert.equal(parseChord("Do").root % 12, 0);
  assert.equal(parseChord("Sol").root % 12, 7);
  assert.equal(parseChord("Lam").root % 12, 9);
  assert.equal(parseChord("Lam").quality, "m", "Lam = La minor");
  // "Sol" tek harfli okunup yanlis coze bilirdi; uzun eslesme once denenir.
  assert.notEqual(parseChord("Sol").root % 12, parseChord("S")?.root % 12);
});

test("taninmayan sembol sessizce yanlis calmaz", () => {
  assert.equal(parseChord("Hx9"), null);
  assert.equal(parseChord("C#foo"), null);
  assert.equal(parseChord(""), null);
  assert.equal(parseChord(null), null);
});

test("dizi cozumleyici gecerli ve gecersizleri ayirir", () => {
  const { chords, invalid } = parseProgression("Am · F · C · G");
  assert.equal(chords.length, 4);
  assert.deepEqual(invalid, []);
  assert.equal(chords[0].name, "Am");

  const mixed = parseProgression("C Am Zz F");
  assert.equal(mixed.chords.length, 3);
  assert.deepEqual(mixed.invalid, ["Zz"], "gecersiz sembol bildirilmeli");
});

test("dizi cozumleyici farkli ayiricilari kabul eder", () => {
  for (const text of ["C Am F G", "C,Am,F,G", "C · Am · F · G", "C | Am | F | G"]) {
    assert.equal(parseProgression(text).chords.length, 4, `ayirici basarisiz: ${text}`);
  }
});

test("calaci dizide sirayla ilerler ve basa doner", () => {
  const player = createProgressionPlayer();
  const { chords } = parseProgression("C Am F");
  player.set(chords);

  assert.equal(player.length, 3);
  assert.equal(player.next().name, "C");
  assert.equal(player.next().name, "Am");
  assert.equal(player.next().name, "F");
  assert.equal(player.next().name, "C", "dizi bitince basa donmeli");
});

test("calaci bos diziyle guvenli calisir", () => {
  const player = createProgressionPlayer();
  assert.equal(player.next(), null);
  assert.equal(player.peek(), null);
  assert.equal(player.currentIndex, -1);
  player.set(null);
  assert.equal(player.next(), null);
});

test("peek imleci ilerletmez", () => {
  const player = createProgressionPlayer();
  player.set(parseProgression("C Am").chords);
  assert.equal(player.peek().name, "C");
  assert.equal(player.peek().name, "C", "peek imleci oynatmamali");
  assert.equal(player.next().name, "C");
  assert.equal(player.peek().name, "Am");
});

test("yeni dizi atandiginda imlec basa doner", () => {
  const player = createProgressionPlayer();
  player.set(parseProgression("C Am F G").chords);
  player.next(); player.next();
  player.set(parseProgression("D A").chords);
  assert.equal(player.next().name, "D", "yeni dizi bastan calmali");
});
