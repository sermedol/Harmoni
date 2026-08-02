import test from "node:test";
import assert from "node:assert/strict";
import { createMeter, getMeter, METERS } from "../../docs/js/music/meter.js";
import { Transport, QUANTIZE, createTapTempo } from "../../docs/js/music/transport.js";

const SAMPLE_RATE = 48000;

/** Transport'u verilen orneklem sayisi kadar quantum quantum ilerletir. */
function run(transport, totalSamples, quantum = 128) {
  const ticks = [];
  let done = 0;
  while (done < totalSamples) {
    const step = Math.min(quantum, totalSamples - done);
    transport.advance(step, (tick) => ticks.push(tick));
    done += step;
  }
  return ticks;
}

// --- Meter ---------------------------------------------------------------

test("beatGroups toplami numerator ile uyusmazsa olcu reddedilir", () => {
  // Sessizce kabul edilirse aksak olculer yanlis uzunlukta calar.
  assert.throws(
    () => createMeter({ numerator: 9, denominator: 8, beatGroups: [2, 2, 2] }),
    /beatGroups toplami/
  );
});

test("3/4 ve 6/8 gercekten farkli olculer", () => {
  const three = METERS["3/4"];
  const six = METERS["6/8"];
  // Ayni cozunurlukte tick SAYISI esit olabilir (12/12); bu ikisini ayni
  // yapmaz. Ayirt edici olan vurus yapisi ve olcu suresidir.
  assert.deepEqual(three.beatGroups, [1, 1, 1]);
  assert.deepEqual(six.beatGroups, [3, 3]);
  assert.equal(three.groupStarts.length, 3, "3/4 uc vurus");
  assert.equal(six.groupStarts.length, 2, "6/8 iki vurus");

  // Vurus baslangiclari farkli tick'lere duser.
  assert.deepEqual(three.groupStarts, [0, 4, 8]);
  assert.deepEqual(six.groupStarts, [0, 6]);

  // Ayni BPM sayisinda olcu sureleri de ayni degil.
  assert.notEqual(three.secondsPerBar(120), six.secondsPerBar(120));

  // Vurgu haritalari farkli: 6/8'de 4. tick vurus basi degil, 3/4'te vurus basi.
  assert.ok(three.isBeatStart(4));
  assert.ok(!six.isBeatStart(4));
});

test("aksak gruplama esit olmayan vurus baslangiclari uretir", () => {
  const nine = METERS["9/8-aksak"];          // 2+2+2+3, ticksPerUnit 2
  assert.deepEqual(nine.groupStarts, [0, 4, 8, 12]);
  assert.equal(nine.ticksPerBar, 18);
  // Son grup uzun (3 birim = 6 tick), digerleri 4 tick.
  const spans = nine.groupStarts.map((start, index, all) =>
    (index + 1 < all.length ? all[index + 1] : nine.ticksPerBar) - start);
  assert.deepEqual(spans, [4, 4, 4, 6]);

  const seven = METERS["7/8-aksak"];         // 2+2+3
  assert.deepEqual(seven.groupStarts, [0, 4, 8]);
  assert.equal(seven.ticksPerBar, 14);
});

test("vurgu haritasi olcu basini ve grup baslarini ayirir", () => {
  const nine = METERS["9/8-aksak"];
  assert.equal(nine.accentAt(0), 1, "olcu basi en guclu");
  assert.ok(nine.accentAt(4) > nine.accentAt(5), "grup basi ara alt bolumden guclu");
  assert.ok(nine.accentAt(12) >= nine.accentAt(4), "uzun grup en az kisa grup kadar vurgulu");
  assert.ok(nine.accentAt(1) < nine.accentAt(4));
});

test("olcu suresi bpm ile dogru olceklenir", () => {
  const four = METERS["4/4"];
  // 120 BPM'de dortluk 0.5 sn, 4/4 olcu 2 sn.
  assert.ok(Math.abs(four.secondsPerBar(120) - 2) < 1e-9);
  assert.ok(Math.abs(four.secondsPerTick(120) - 0.125) < 1e-9, "16'lik 0.125 sn");
  // 60 BPM'de iki kati.
  assert.ok(Math.abs(four.secondsPerBar(60) - 4) < 1e-9);
  // 3/4 olcu 4/4'un dortte ucu.
  assert.ok(Math.abs(METERS["3/4"].secondsPerBar(120) - 1.5) < 1e-9);
});

// --- Transport -----------------------------------------------------------

test("tick sayisi bir olcude beklendigi kadar", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "4/4" });
  const barSamples = Math.round(METERS["4/4"].secondsPerBar(120) * SAMPLE_RATE);
  const ticks = run(transport, barSamples);
  assert.equal(ticks.length, 16, "4/4 bir olcude 16 adet 16'lik");
  assert.equal(ticks.filter((t) => t.isDownbeat).length, 1);
  assert.equal(ticks.filter((t) => t.isBeatStart).length, 4);
});

test("aksak olcude vurus sayisi gruplama ile uyusur", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "9/8-aksak" });
  const meter = METERS["9/8-aksak"];
  const ticks = run(transport, Math.round(meter.secondsPerBar(120) * SAMPLE_RATE));
  assert.equal(ticks.length, 18);
  assert.equal(ticks.filter((t) => t.isBeatStart).length, 4, "2+2+2+3 dort vurus");
});

test("uzun surede zamanlama kaymasi kabul sinirinda", () => {
  // On dakika: kumulatif hata duyulur olmamali.
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "4/4" });
  const minutes = 10;
  const ticks = run(transport, SAMPLE_RATE * 60 * minutes, 128);
  const expected = (60 * minutes) / METERS["4/4"].secondsPerTick(120);
  const drift = Math.abs(ticks.length - expected);
  assert.ok(drift <= 1, `on dakikada ${drift} tick kayma`);
  // Orneklem sayaci tam olmali.
  assert.equal(transport.absoluteSample, SAMPLE_RATE * 60 * minutes);
});

test("tempo degisimi vurus sinirinda uygulanir ve fazi bozmaz", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "4/4" });
  run(transport, Math.round(SAMPLE_RATE * 0.125 * 1.5));   // vurusun ortasindayiz
  const sampleBefore = transport.absoluteSample;

  transport.setTempo(90, QUANTIZE.NEXT_BEAT);
  assert.equal(transport.bpm, 120, "hemen degismemeli");
  assert.equal(transport.absoluteSample, sampleBefore, "sayac sifirlanmamali");

  run(transport, Math.round(SAMPLE_RATE * 0.6));
  assert.equal(transport.bpm, 90, "vurus sinirinda uygulanmali");
});

test("olcu degisimi yalnizca olcu basinda uygulanir", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "4/4" });
  run(transport, Math.round(SAMPLE_RATE * 0.5));           // olcunun ortasi
  transport.setMeter("3/4", QUANTIZE.NEXT_BAR);
  assert.equal(transport.meter.id, "4/4", "hemen degismemeli");

  run(transport, Math.round(SAMPLE_RATE * 2));
  assert.equal(transport.meter.id, "3/4", "olcu basinda uygulanmali");
});

test("ticksUntil kuantize sinirlarini dogru hesaplar", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 120, meter: "9/8-aksak" });
  // Basta: bir sonraki vurus 4 tick sonra (2+2+2+3 gruplamasi).
  assert.equal(transport.ticksUntil(QUANTIZE.NEXT_BEAT), 4);
  assert.equal(transport.ticksUntil(QUANTIZE.NEXT_BAR), 18);
  assert.equal(transport.ticksUntil(QUANTIZE.NEXT_SUBDIVISION), 1);
  assert.equal(transport.ticksUntil(QUANTIZE.IMMEDIATE), 0);
});

test("tick sirasi korunur ve atlanmaz", () => {
  const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 140, meter: "7/8-aksak" });
  const ticks = run(transport, SAMPLE_RATE * 3, 128);
  for (let i = 1; i < ticks.length; i++) {
    assert.equal(ticks[i].tick, ticks[i - 1].tick + 1, "tick atlandi veya tekrarlandi");
  }
});

test("quantum boyutu tick sonuclarini degistirmez", () => {
  const total = SAMPLE_RATE * 4;
  const counts = [128, 256, 512].map((quantum) => {
    const transport = new Transport({ sampleRate: SAMPLE_RATE, bpm: 132, meter: "4/4" });
    return run(transport, total, quantum).length;
  });
  assert.equal(new Set(counts).size, 1, `quantum'a gore farkli tick sayisi: ${counts}`);
});

// --- Tap tempo -----------------------------------------------------------

test("tap tempo medyan kullanir ve aykiri vurusu eler", () => {
  const tap = createTapTempo();
  // 500 ms araliklar = 120 BPM, arada bir gec vurus.
  const times = [0, 500, 1000, 1500, 2180, 2500, 3000];
  let bpm = null;
  for (const time of times) bpm = tap.tap(time) ?? bpm;
  assert.ok(bpm !== null, "yeterli vurustan sonra deger uretmeli");
  assert.ok(Math.abs(bpm - 120) <= 6, `aykiri vurus sonucu bozdu: ${bpm}`);
});

test("tap tempo iki vurustan once karar vermez", () => {
  const tap = createTapTempo();
  assert.equal(tap.tap(0), null);
  assert.equal(tap.tap(500), null);
  assert.ok(tap.tap(1000) !== null);
});

test("tap tempo makul araligin disini reddeder", () => {
  const tap = createTapTempo();
  // 20 ms aralik = 3000 BPM, kabul edilmemeli.
  assert.equal(tap.tap(0), null);
  assert.equal(tap.tap(20), null);
  assert.equal(tap.tap(40), null);
});

test("uzun duraklama sonrasi tap dizisi sifirlanir", () => {
  const tap = createTapTempo();
  tap.tap(0); tap.tap(500); tap.tap(1000);
  assert.ok(tap.count >= 3);
  tap.tap(9000);                                  // 8 saniye sonra
  assert.equal(tap.count, 1, "eski vuruslar atilmali");
});

test("bilinmeyen olcu kimligi guvenli varsayilana duser", () => {
  assert.equal(getMeter("yok-boyle-bir-olcu").id, "4/4");
});
