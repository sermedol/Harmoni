// harmoni.py AudioEngine._callback'in gercek-zamanli ses render-thread'i
// (AudioWorkletProcessor) karsiligi. Milestone 5: VocalDSP (gercek vokal
// guzellestirme zinciri) baglandi. Gercek HarmonyEngine akor/makam verisi
// (Milestone 6, su an icin sabit bir yerlesik C majör akoru ve Hicaz makami
// varsayilan olarak kullanilir) henuz yok.
import { SynthEngine } from "./synth-engine.js?v=20260802-04";
import { VocalDSP } from "./vocal-dsp.js?v=20260802-04";
import { PitchTracker } from "./pitch-tracker.js?v=20260802-04";

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
    this.pendingHarmony = null;
    // harmoni.py DEFAULT_CONFIG.monitor_enabled - kapatildiginda mikrofon
    // hoparlore YANSITILMAZ (vocal=0, DSP hic calismaz). Kulaklik takmadan
    // (mikrofon hoparloru duyacak sekilde) kullanildiginda bu kapatilmazsa
    // akustik geri besleme (cizirti/uluma) olusur - Python'daki ayni risk.
    this.monitorEnabled = false;
    this.vocalLevel = 0;
    this.captureEnabled = false;
    this.captureVocalOnly = false;
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
        if ("vocalInputGain" in payload) this.vocalDsp.setInputGain(payload.vocalInputGain);
        if ("vocalReverbMix" in payload) this.vocalDsp.setReverbMix(payload.vocalReverbMix);
        if ("vocalEchoMix" in payload) this.vocalDsp.setEchoMix(payload.vocalEchoMix);
        if ("vocalDecaySeconds" in payload) this.vocalDsp.setDecaySeconds(payload.vocalDecaySeconds);
        // Vokal kaydi: kayit veri yolunun ham PCM'i ana is parcacigina
        // gonderilir ve orada WAV olarak paketlenir (bkz. export/wav-encoder.js).
        if ("captureEnabled" in payload) {
          this.captureEnabled = !!payload.captureEnabled;
          if (!this.captureEnabled) this.vocalDsp.reset();
        }
        // "mix" = kullanicinin duydugunun aynisi (orkestra + islenmis vokal).
        // "vocal" = yalnizca islenmis vokal kanali.
        if ("captureSource" in payload) this.captureVocalOnly = payload.captureSource === "vocal";
        if ("harmonyChange" in payload) this.pendingHarmony = payload.harmonyChange;
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
      const monitorOutput = outputs[0];
      const recordOutput = outputs[1];
      const frames = monitorOutput[0].length;
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

      // RecordBus vokali her zaman işler; monitorEnabled yalnızca fiziksel
      // hoparlör/kulaklık yolundaki vokal duyumunu kontrol eder.
      const [vocalL, vocalR] = this.vocalDsp.process(mono);

      if (this.pendingHarmony && this.synth.samplesToStep <= 0 && this.synth.stepIndex % 8 === (this.pendingHarmony.applyAtStep || 0)) {
        this.music.chordNotes = [...this.pendingHarmony.chordNotes];
        this.music.chordRevision = this.pendingHarmony.revision;
        this.pendingHarmony = null;
      }
      const [musicL, musicR] = this.synth.render(frames, this.music, this.vocalLevel);

      let recordPeak = 0;
      let recordSumSq = 0;
      for (let ch = 0; ch < monitorOutput.length; ch++) {
        const monitorCh = monitorOutput[ch];
        const recordCh = recordOutput?.[ch];
        const synthCh = ch === 0 ? musicL : musicR;
        const vocalCh = ch === 0 ? vocalL : vocalR;
        for (let i = 0; i < frames; i++) {
          const vocal = vocalCh[i] * 0.96;
          const monitorMix = synthCh[i] + (this.monitorEnabled ? vocal : 0);
          const recordMix = synthCh[i] + vocal;
          monitorCh[i] = Math.max(-0.96, Math.min(0.96, Math.tanh(monitorMix * 1.06) / Math.tanh(1.06)));
          const recordLimited = Math.max(-0.96, Math.min(0.96, Math.tanh(recordMix * 1.06) / Math.tanh(1.06)));
          if (recordCh) recordCh[i] = recordLimited;
          recordPeak = Math.max(recordPeak, Math.abs(recordMix));
          recordSumSq += recordMix * recordMix;
        }
      }

      // Kayit veri yolunun kopyasi ana is parcacigina gonderilir. Kopya
      // sarttir: cikis tamponlari her quantum'da yeniden kullanildigi icin
      // referans gondermek bozuk veri uretir. Transferable kullanarak
      // kopyalama maliyeti tek seferde kalir.
      if (this.captureEnabled && recordOutput?.[0]) {
        const sourceL = this.captureVocalOnly ? vocalL : recordOutput[0];
        const sourceR = this.captureVocalOnly ? vocalR : (recordOutput[1] || recordOutput[0]);
        const captureL = new Float32Array(sourceL);
        const captureR = new Float32Array(sourceR);
        this.port.postMessage(
          { type: "capture", left: captureL, right: captureR },
          [captureL.buffer, captureR.buffer]
        );
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
          // Seviye gostergesi ve clipping uyarisi icin: giris kazanci
          // uygulanmis ama kompresore girmemis tepe degeri.
          vocalInputPeak: this.vocalDsp.inputPeak,
          pitch: this.pitchSnapshot,
          stablePitch: this.pitchTracker.stablePitch,
          synthMaxAbs: maxAbs,
          recordPeak,
          recordRms: Math.sqrt(recordSumSq / Math.max(1, frames * 2)),
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
