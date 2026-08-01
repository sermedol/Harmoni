// harmoni.py AudioEngine._callback'in gercek-zamanli ses render-thread'i
// (AudioWorkletProcessor) karsiligi. Milestone 5: VocalDSP (gercek vokal
// guzellestirme zinciri) baglandi. Gercek HarmonyEngine akor/makam verisi
// (Milestone 6, su an icin sabit bir yerlesik C majör akoru ve Hicaz makami
// varsayilan olarak kullanilir) henuz yok.
import { SynthEngine } from "./synth-engine.js";
import { VocalDSP } from "./vocal-dsp.js";
import { PitchTracker } from "./pitch-tracker.js";

const DEFAULT_MUSIC = {
  bpm: 96,
  phraseActive: false,
  chordRevision: 0,
  tonalSystem: "western",
  chordNotes: [60, 64, 67], // C majör (Milestone 6'da HarmonyEngine bunu gercek zamanli guncelleyecek)
  makamDegrees: [60, 65, 69, 72, 74, 77, 81], // Hicaz benzeri yerlesik dizi (yer tutucu)
};

class HarmoniProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = new SynthEngine(sampleRate);
    this.vocalDsp = new VocalDSP(sampleRate);
    this.pitchTracker = new PitchTracker(sampleRate);
    this.pitchSnapshot = null;
    this.music = { ...DEFAULT_MUSIC };
    // harmoni.py DEFAULT_CONFIG.monitor_enabled - kapatildiginda mikrofon
    // hoparlore YANSITILMAZ (vocal=0, DSP hic calismaz). Kulaklik takmadan
    // (mikrofon hoparloru duyacak sekilde) kullanildiginda bu kapatilmazsa
    // akustik geri besleme (cizirti/uluma) olusur - Python'daki ayni risk.
    this.monitorEnabled = false;
    this.vocalLevel = 0;
    this.tickCount = 0;
    this.telemetryEveryNQuanta = 8; // ~21ms araliklarla (128 ornek/quanta @ 48kHz)
    // harmoni.py'deki state.waveform (256 orneklik goruntuleme tamponu) karsiligi -
    // Python'da bu MIKROFON GIRISININ (islenmemis mono) dairesel bir kopyasidir,
    // nihai karisimin degil (bkz. AudioEngine._callback: waveform = mono).
    this.waveformSize = 256;
    this.waveformBuffer = new Float32Array(this.waveformSize);
    this.waveformPos = 0;

    this.port.onmessage = (event) => {
      try {
        const msg = event.data;
        if (!msg || msg.type !== "control") return;
        const payload = msg.payload;
        if ("activeLayers" in payload) this.synth.setLayers(payload.activeLayers);
        if ("brightness" in payload) this.synth.setBrightness(payload.brightness);
        if ("articulation" in payload) this.synth.setArticulation(payload.articulation);
        if ("density" in payload) this.synth.density = payload.density;
        if ("musicGain" in payload) this.synth.musicGain = payload.musicGain;
        if ("monitorEnabled" in payload) this.monitorEnabled = payload.monitorEnabled;
        if ("fxAmount" in payload) this.vocalDsp.setFxAmount(payload.fxAmount);
        if ("vocalEnabled" in payload) this.vocalDsp.enabled = payload.vocalEnabled;
        for (const key of ["bpm", "phraseActive", "chordRevision", "tonalSystem", "chordNotes", "makamDegrees"]) {
          if (key in payload) this.music[key] = payload[key];
        }
      } catch (err) {
        this.port.postMessage({ type: "error", where: "onmessage", message: err.message, stack: err.stack });
      }
    };
  }

  process(inputs, outputs) {
    try {
      const output = outputs[0];
      const frames = output[0].length;
      const input = inputs[0];
      const hasInput = input && input.length > 0 && input[0].length > 0;
      const mono = new Float64Array(frames);
      if (hasInput) {
        const ch = input[0];
        for (let i = 0; i < frames; i++) mono[i] = ch[i];
      }

      let sumSq = 0;
      for (let i = 0; i < frames; i++) sumSq += mono[i] * mono[i];
      this.vocalLevel = Math.sqrt(sumSq / frames + 1e-12);
      // Perde analizi her zaman ham mikrofon sinyalinden yapılır. Hoparlöre
      // vokal duyumu kapalı olsa bile nota/frekans takibi canlı kalır.
      this.pitchSnapshot = this.pitchTracker.submit(mono, currentTime * 1000);

      for (let i = 0; i < frames; i++) {
        this.waveformBuffer[this.waveformPos] = mono[i];
        this.waveformPos = (this.waveformPos + 1) % this.waveformSize;
      }

      let vocalL, vocalR;
      if (this.monitorEnabled) {
        [vocalL, vocalR] = this.vocalDsp.process(mono);
      } else {
        vocalL = null;
        vocalR = null;
      }

      const [musicL, musicR] = this.synth.render(frames, this.music, this.vocalLevel);

      for (let ch = 0; ch < output.length; ch++) {
        const outCh = output[ch];
        const synthCh = ch === 0 ? musicL : musicR;
        const vocalCh = ch === 0 ? vocalL : vocalR;
        for (let i = 0; i < frames; i++) {
          const vocal = vocalCh ? vocalCh[i] * 0.96 : 0;
          const mix = vocal + synthCh[i];
          const limited = Math.tanh(mix * 1.06) / Math.tanh(1.06);
          outCh[i] = Math.max(-0.96, Math.min(0.96, limited));
        }
      }

      this.tickCount += 1;
      if (this.tickCount % this.telemetryEveryNQuanta === 0) {
        let maxAbs = 0;
        for (let i = 0; i < frames; i++) maxAbs = Math.max(maxAbs, Math.abs(musicL[i]), Math.abs(musicR[i]));
        const waveform = new Float32Array(this.waveformSize);
        for (let i = 0; i < this.waveformSize; i++) {
          waveform[i] = this.waveformBuffer[(this.waveformPos + i) % this.waveformSize];
        }
        this.port.postMessage({
          type: "telemetry",
          tickCount: this.tickCount,
          hasInput,
          vocalLevel: this.vocalLevel,
          pitch: this.pitchSnapshot,
          synthMaxAbs: maxAbs,
          activeVoiceCount: this.synth.voices.length,
          waveform,
          controlEcho: { activeLayers: [...this.synth.activeLayers], music: this.music },
        });
      }
    } catch (err) {
      this.port.postMessage({ type: "error", where: "process", message: err.message, stack: err.stack });
      return true;
    }
    return true;
  }
}

registerProcessor("harmoni-processor", HarmoniProcessor);
