import test from "node:test";
import assert from "node:assert/strict";
import { WavWriter, encodeWav, floatToInt16, readWavHeader } from "../../docs/js/export/wav-encoder.js";

test("float ornekler 16-bit tam sayiya tasmadan cevrilir", () => {
  assert.equal(floatToInt16(0), 0);
  assert.equal(floatToInt16(1), 32767);
  assert.equal(floatToInt16(-1), -32768);
  // Araligin disindaki degerler kirpilmali, sarmamali.
  assert.equal(floatToInt16(4.2), 32767);
  assert.equal(floatToInt16(-9), -32768);
});

test("WAV basligi gecerli ve veri uzunlugu tutarli", () => {
  const frames = 480;
  const left = new Int16Array(frames).fill(1000);
  const right = new Int16Array(frames).fill(-1000);
  const header = readWavHeader(encodeWav([left, right], 48000));

  assert.equal(header.riff, "RIFF");
  assert.equal(header.wave, "WAVE");
  assert.equal(header.format, 1, "PCM olmali");
  assert.equal(header.channels, 2);
  assert.equal(header.sampleRate, 48000);
  assert.equal(header.bitsPerSample, 16);
  assert.equal(header.blockAlign, 4, "stereo 16-bit -> kare basina 4 bayt");
  assert.equal(header.byteRate, 48000 * 4);
  assert.equal(header.dataBytes, frames * 4);
  // RIFF boyutu basligin kendisi haric toplam uzunluk olmali.
  assert.equal(header.declaredSize, header.totalBytes - 8);
});

test("kanallar dogru sirada ic ice gecirilir", () => {
  const left = Int16Array.from([1, 3, 5]);
  const right = Int16Array.from([2, 4, 6]);
  const view = new DataView(encodeWav([left, right], 44100));
  const interleaved = [];
  for (let i = 0; i < 6; i++) interleaved.push(view.getInt16(44 + i * 2, true));
  assert.deepEqual(interleaved, [1, 2, 3, 4, 5, 6]);
});

test("WavWriter bloklari biriktirir ve sureyi dogru bildirir", () => {
  const writer = new WavWriter({ sampleRate: 48000, channels: 2 });
  assert.equal(writer.isEmpty, true);
  assert.equal(writer.toBlob(), null, "bos kayit blob uretmemeli");

  for (let i = 0; i < 375; i++) {                     // 375 * 128 = 48000 ornek
    writer.push([new Float32Array(128), new Float32Array(128)]);
  }
  assert.equal(writer.frames, 48000);
  assert.ok(Math.abs(writer.durationSeconds - 1) < 1e-6, "1 saniye olmali");

  const blob = writer.toBlob();
  assert.ok(blob, "blob uretilmeli");
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 44 + 48000 * 4);
});

test("WavWriter ust sinira ulasinca buyumeyi durdurur", () => {
  // Sinirsiz birikim uzun oturumlarda sekmeyi cokertir.
  const writer = new WavWriter({ sampleRate: 48000, channels: 2, maxSeconds: 0.01 });
  for (let i = 0; i < 20; i++) writer.push([new Float32Array(128), new Float32Array(128)]);
  assert.ok(writer.truncated, "sinir asildiginda isaretlenmeli");
  assert.ok(writer.frames <= 480, "sinirin otesinde veri tutulmamali");
});

test("clear kaydi tamamen bosaltir", () => {
  const writer = new WavWriter({ sampleRate: 48000, channels: 2 });
  writer.push([new Float32Array(128), new Float32Array(128)]);
  writer.clear();
  assert.equal(writer.frames, 0);
  assert.equal(writer.isEmpty, true);
  assert.equal(writer.toBlob(), null);
});

test("yazilan ornek degerleri geri okunabiliyor", () => {
  const writer = new WavWriter({ sampleRate: 8000, channels: 2 });
  const left = Float32Array.from([0, 0.5, -0.5, 1]);
  const right = Float32Array.from([1, -1, 0.25, 0]);
  writer.push([left, right]);
  const merged = writer.chunks.map((list) => list[0]);
  const view = new DataView(encodeWav(merged, 8000));
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), floatToInt16(0.5));
  assert.equal(view.getInt16(50, true), -32768);
});
