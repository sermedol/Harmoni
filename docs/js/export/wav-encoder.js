// 16-bit PCM WAV yazici.
//
// Neden MediaRecorder yerine bu: MediaRecorder yalnizca sikistirilmis
// kapsayicilar (WebM/Opus, mp4/AAC) uretir ve tarayicidan tarayiciya
// degisir. Vokal kaydinin kayipsiz ve her yerde acilabilir olmasi icin
// kayit veri yolunun ham PCM'i toplanip WAV olarak paketleniyor.
// MediaRecorder yolu yedek olarak korunuyor (bkz. recorder.js).

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Float orneklerini -1..1 araligindan 16-bit tam sayiya cevirir. */
export function floatToInt16(value) {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Kanal verilerinden WAV baytlari uretir.
 * @param {Int16Array[]} channelData - kanal basina esit uzunlukta ornekler
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWav(channelData, sampleRate) {
  const channels = channelData.length;
  const frames = channels ? channelData[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);           // fmt bolum uzunlugu
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      view.setInt16(offset, channelData[channel][frame], true);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Kayit sirasinda gelen float bloklarini biriktirir.
 * Bellek: 48 kHz stereo Int16 = saniyede ~192 KB. Float32 tutmaya gore
 * yarisi kadar yer kaplar; 5 dakikalik kayit ~57 MB civarindadir.
 */
export class WavWriter {
  constructor({ sampleRate = 48000, channels = 2, maxSeconds = 600 } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.maxFrames = Math.round(maxSeconds * sampleRate);
    this.chunks = Array.from({ length: channels }, () => []);
    this.frames = 0;
    this.truncated = false;
  }

  /** @param {Float32Array[]} blockPerChannel */
  push(blockPerChannel) {
    if (!blockPerChannel?.length) return;
    const length = blockPerChannel[0].length;
    if (!length) return;
    if (this.frames + length > this.maxFrames) { this.truncated = true; return; }
    for (let channel = 0; channel < this.channels; channel++) {
      const source = blockPerChannel[channel] || blockPerChannel[0];
      const target = new Int16Array(length);
      for (let i = 0; i < length; i++) target[i] = floatToInt16(source[i]);
      this.chunks[channel].push(target);
    }
    this.frames += length;
  }

  get durationSeconds() { return this.frames / this.sampleRate; }
  get isEmpty() { return this.frames === 0; }

  /** @returns {Blob|null} */
  toBlob() {
    if (this.isEmpty) return null;
    const merged = this.chunks.map((chunkList) => {
      const flat = new Int16Array(this.frames);
      let offset = 0;
      for (const chunk of chunkList) { flat.set(chunk, offset); offset += chunk.length; }
      return flat;
    });
    return new Blob([encodeWav(merged, this.sampleRate)], { type: "audio/wav" });
  }

  clear() {
    this.chunks = Array.from({ length: this.channels }, () => []);
    this.frames = 0;
    this.truncated = false;
  }
}

/** Testler ve dogrulama icin WAV basligini geri okur. */
export function readWavHeader(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const ascii = (offset, length) => {
    let out = "";
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
    return out;
  };
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
    declaredSize: view.getUint32(4, true),
    totalBytes: arrayBuffer.byteLength,
  };
}
