// harmoni.py SynthEngine - birebir port (Voice.seed hala gercek rastgelelik
// kullanir - Python'da da random.randint ile turetiliyordu, notanin ICINDEKI
// gurultu yalnizca seed+age_samples ile deterministik/tekrarlanabilir).
import { clamp, lerp, onePoleLowpass } from "../../constants/music-utils.js";
import { renderVoice } from "./voices.js";
import { MultiTapReverb } from "./multitap-reverb.js";

const ALL_LAYERS = [
  "PIANO", "BAGLAMA", "NEY", "WOODWINDS", "BRASS", "STRINGS", "KEMAN", "GITAR",
  "PAD", "BASS", "DRUMS", "DAVUL",
];

// duck_gain Python'da AUDIO_BLOCK=256 orneklik blok basina bir kez 0.12
// oraninda hedefe yaklasir. AudioWorklet quantum'u Web Audio spesifikasyonu
// geregi sabit 128 orneklik oldugundan, ayni gercek-zamanli yumusatma HIZINI
// (zaman sabitini) korumak icin oran 1-sqrt(1-k) ile yari-blok-basina
// uyarlanir - bu, birinci dereceden ustel yumusatma icin YAKLASIK degil TAM
// matematiksel esdegerdir (iki ardisik 128'lik adim, bir 256'lik adimla ayni
// toplam sonme faktorunu uretir).
function halfBlockRate(k) {
  return 1 - Math.sqrt(1 - k);
}
const DUCK_RATE = halfBlockRate(0.12);

export class SynthEngine {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.voices = [];
    this.stepIndex = 0;
    this.samplesToStep = 0;
    this.musicGain = 0.30;
    this.density = 0.38;
    this.duckGain = 0.62;
    this.lastChordRevision = -1;
    this.maxVoices = 44;
    this.brightness = 1.0;
    this.brightStateL = 0;
    this.brightStateR = 0;
    this.articulation = 0.5;
    this.activeLayers = new Set(["PIANO"]);

    // Orkestra icin hafif, paylasilan "oda" reverb'i (VocalDSP'nin kullandigi
    // ayni MultiTapReverb sinifi, farkli parametrelerle - bkz. multitap-reverb.js).
    this.reverbMix = 0.15;
    this.reverb = new MultiTapReverb(sampleRate, {
      tapsL: [0.029, 0.061, 0.097, 0.14],
      gainsL: [0.42, 0.30, 0.20, 0.13],
      feedbackAmount: 0.30,
      smoothingCoeff: 0.6,
      bufferSeconds: 0.55,
    });
  }

  setLayers(layers) {
    this.activeLayers = new Set(layers);
  }

  toggleLayer(name) {
    const layers = new Set(this.activeLayers);
    let active;
    if (layers.has(name)) {
      layers.delete(name);
      active = false;
    } else {
      layers.add(name);
      active = true;
    }
    this.activeLayers = layers;
    return active;
  }

  muteExtras() {
    this.setLayers(["PIANO"]);
  }

  fullOrchestra() {
    this.setLayers(ALL_LAYERS);
  }

  setBrightness(v) {
    this.brightness = clamp(v, 0, 1);
  }

  setArticulation(v) {
    this.articulation = clamp(v, 0, 1);
  }

  trigger(midiNote, kind, velocity = 0.7, duration = 0.8, pan = 0.0) {
    if (velocity <= 0.001) return;
    const durationSamples = Math.max(64, Math.round(duration * this.sampleRate));
    const voice = {
      midiNote,
      kind,
      velocity: clamp(velocity, 0, 1),
      durationSamples,
      pan: clamp(pan, -1, 1),
      phase: 0,
      ageSamples: 0,
      seed: Math.floor(Math.random() * 2147483647),
      ksBuffer: null,
      ksPos: 0,
    };
    if (this.voices.length >= this.maxVoices) {
      this.voices = this.voices.slice(-(this.maxVoices - 1));
    }
    this.voices.push(voice);
  }

  _scheduleStep(music) {
    const layers = this.activeLayers;
    const step = this.stepIndex % 8;
    const beatSeconds = 60.0 / Math.max(music.bpm, 1.0);
    const phraseActive = music.phraseActive;
    const chordChanged = music.chordRevision !== this.lastChordRevision;
    if (chordChanged) this.lastChordRevision = music.chordRevision;
    const articulationScale = lerp(0.55, 1.4, this.articulation);

    if (music.tonalSystem === "makam") {
      this._scheduleMakamStep(music, layers, step, beatSeconds, phraseActive, chordChanged, articulationScale);
    } else {
      this._scheduleWesternStep(music, layers, step, beatSeconds, phraseActive, chordChanged, articulationScale);
    }
    this.stepIndex += 1;
  }

  _scheduleMakamStep(music, layers, step, beatSeconds, phraseActive, chordChanged, articulationScale) {
    const degrees = music.makamDegrees;
    if (!degrees || !degrees.length) return;
    const tonic = degrees[0];
    const guclu = degrees.length > 4 ? degrees[4] : degrees[degrees.length - 1];

    if (chordChanged && (step === 0 || step === 4)) {
      this.trigger(tonic - 12.0, "pad", phraseActive ? 0.13 : 0.19, beatSeconds * 7.4, -0.35);
      this.trigger(guclu - 12.0, "pad", phraseActive ? 0.10 : 0.14, beatSeconds * 7.4, 0.35);
      if (layers.has("BASS")) this.trigger(tonic - 24.0, "bass", phraseActive ? 0.28 : 0.36, beatSeconds * 3.6, -0.05);
      if (layers.has("STRINGS")) {
        for (const note of [tonic, guclu]) this.trigger(note, "strings", 0.11, beatSeconds * 3.6, 0.0);
      }
    }

    const activeSteps = phraseActive ? [0, 3, 5] : [0, 1, 3, 4, 5, 6];
    if (activeSteps.includes(step)) {
      const pattern = [0, 2, 1, 4, 3, 2, 1, 0];
      const note = degrees[pattern[step] % degrees.length];
      const velocity = phraseActive ? 0.29 : 0.38;
      this.trigger(note, "baglama", velocity, beatSeconds * 1.1 * articulationScale, -0.1 + 0.2 * (step / 7.0));
    }

    if (layers.has("NEY") && (step === 2 || step === 6) && !phraseActive) {
      const note = degrees[(step === 2 ? 4 : 2) % degrees.length];
      this.trigger(note, "ney", 0.23, beatSeconds * 3.4, -0.15);
    }
    if (layers.has("WOODWINDS") && chordChanged && (step === 0 || step === 4)) {
      this.trigger(degrees[degrees.length - 1], "flute", phraseActive ? 0.12 : 0.18, beatSeconds * 3.0, 0.3);
    }
    if (layers.has("KEMAN") && (step === 1 || step === 5) && !phraseActive) {
      const note = degrees[(step === 1 ? 3 : 1) % degrees.length];
      this.trigger(note, "keman", 0.18, beatSeconds * 2.6, 0.3);
    }
    if (layers.has("GITAR") && [1, 3, 5, 7].includes(step)) {
      const pattern = [1, 3, 2, 0];
      const note = degrees[pattern[Math.floor(step / 2) % pattern.length] % degrees.length];
      const velocity = phraseActive ? 0.17 : 0.24;
      this.trigger(note, "guitar", velocity, beatSeconds * 0.9 * articulationScale, -0.2);
    }
    if (layers.has("DAVUL")) {
      if (step === 0 || step === 4) this.trigger(40.0, "davul", phraseActive ? 0.17 : 0.24, 0.35, -0.1);
      else if (step === 2 || step === 6) this.trigger(64.0, "davul", phraseActive ? 0.13 : 0.19, 0.12, 0.1);
    }
    if (layers.has("BRASS") && (step === 0 || step === 4) && !phraseActive) {
      this.trigger(tonic, "brass", 0.15, beatSeconds * 1.0, 0.0);
      this.trigger(guclu, "brass", 0.13, beatSeconds * 1.0, 0.2);
    }
    if (layers.has("DRUMS")) {
      this.trigger(36, "kick", step === 0 || step === 4 ? 0.22 : 0.0, 0.18);
      if (step === 2 || step === 6) this.trigger(38, "snare", 0.15, 0.17);
    }
  }

  _scheduleWesternStep(music, layers, step, beatSeconds, phraseActive, chordChanged, articulationScale) {
    const chord = music.chordNotes;
    if (!chord || !chord.length) return;
    if (layers.has("PIANO")) {
      const sparse = this.density < 0.34;
      const dense = this.density > 0.54;
      const activeSteps = phraseActive ? [0, 4] : sparse ? [0, 4] : dense ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 4, 5, 6];
      if (activeSteps.includes(step)) {
        const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
        const note = chord[pattern[step] % chord.length];
        const velocity = phraseActive ? 0.30 : 0.38;
        this.trigger(note, "piano", velocity, beatSeconds * 0.68 * articulationScale, -0.08 + 0.16 * (step / 7.0));
      }
      if (chordChanged && (step === 0 || step === 4)) {
        chord.forEach((n, idx) => {
          this.trigger(n, "piano_soft", phraseActive ? 0.15 : 0.21, beatSeconds * 1.45 * articulationScale, -0.18 + idx * 0.18);
        });
      }
    }
    if (layers.has("BASS") && (step === 0 || step === 4)) {
      this.trigger(chord[0] - 12, "bass", phraseActive ? 0.30 : 0.38, beatSeconds * 0.90 * articulationScale, -0.06);
    }
    if (layers.has("STRINGS") && chordChanged && (step === 0 || step === 4)) {
      chord.forEach((note, idx) => this.trigger(note, "strings", 0.13, beatSeconds * 3.6, -0.45 + idx * 0.45));
    }
    if (layers.has("PAD") && chordChanged && (step === 0 || step === 4)) {
      chord.forEach((note, idx) => this.trigger(note - 12, "pad", 0.095, beatSeconds * 3.8, -0.58 + idx * 0.58));
    }
    if (layers.has("WOODWINDS") && chordChanged && (step === 2 || step === 6)) {
      this.trigger(chord[chord.length - 1] + 12, "flute", phraseActive ? 0.14 : 0.21, beatSeconds * 3.2, 0.25);
    }
    if (layers.has("BRASS") && (step === 0 || step === 4) && !phraseActive) {
      chord.forEach((note, idx) => this.trigger(note, "brass", 0.17, beatSeconds * 1.1, -0.3 + idx * 0.3));
    }
    if (layers.has("BAGLAMA") && [1, 3, 5, 7].includes(step)) {
      const pattern = [2, 0, 1, 0];
      const note = chord[pattern[Math.floor(step / 2) % pattern.length] % chord.length];
      const velocity = phraseActive ? 0.19 : 0.26;
      this.trigger(note, "baglama", velocity, beatSeconds * 0.8 * articulationScale, 0.15);
    }
    if (layers.has("GITAR") && [1, 3, 5, 7].includes(step)) {
      const pattern = [1, 2, 0, 1];
      const note = chord[pattern[Math.floor(step / 2) % pattern.length] % chord.length];
      const velocity = phraseActive ? 0.17 : 0.23;
      this.trigger(note, "guitar", velocity, beatSeconds * 0.7 * articulationScale, -0.2);
    }
    if (layers.has("KEMAN") && (step === 2 || step === 6) && !phraseActive) {
      this.trigger(chord[chord.length - 1] + 12, "keman", 0.17, beatSeconds * 3.0, 0.35);
    }
    if (layers.has("DAVUL")) {
      if (step === 0 || step === 4) this.trigger(40.0, "davul", phraseActive ? 0.18 : 0.26, 0.35, -0.1);
      else if (step === 2 || step === 6) this.trigger(64.0, "davul", phraseActive ? 0.14 : 0.20, 0.12, 0.1);
    }
    if (layers.has("DRUMS")) {
      this.trigger(36, "kick", step === 0 || step === 4 ? 0.24 : 0.0, 0.18);
      if (step === 2 || step === 6) this.trigger(38, "snare", 0.18, 0.17);
      if (step % 2 === 0) this.trigger(42, "hat", 0.07, 0.08, 0.18);
    }
  }

  /**
   * @param {number} frames
   * @param {object} music - {bpm, phraseActive, chordRevision, tonalSystem, chordNotes, makamDegrees}
   * @param {number} vocalLevel
   * @returns {[Float32Array, Float32Array]}
   */
  render(frames, music, vocalLevel) {
    const samplesPerStep = (this.sampleRate * 60.0) / Math.max(music.bpm, 1.0) / 2.0;
    this.samplesToStep -= frames;
    while (this.samplesToStep <= 0.0) {
      this._scheduleStep(music);
      this.samplesToStep += samplesPerStep;
    }

    const outL = new Float64Array(frames);
    const outR = new Float64Array(frames);
    const active = [];
    for (const voice of this.voices) {
      if (voice.velocity <= 0.0 || voice.ageSamples >= voice.durationSamples) continue;
      const [vl, vr] = renderVoice(voice, frames, this.sampleRate);
      for (let i = 0; i < frames; i++) {
        outL[i] += vl[i];
        outR[i] += vr[i];
      }
      if (voice.ageSamples < voice.durationSamples) active.push(voice);
    }
    this.voices = active;

    const phraseActive = music.phraseActive;
    const targetDuck = phraseActive || vocalLevel > 0.009 ? 0.62 : 0.74;
    this.duckGain += (targetDuck - this.duckGain) * DUCK_RATE;
    const layerCount = this.activeLayers.size;
    const gainCompensation = clamp(Math.sqrt(5.0 / Math.max(layerCount, 1)), 0.6, 1.0);
    const totalGain = this.musicGain * this.duckGain * gainCompensation;
    for (let i = 0; i < frames; i++) {
      outL[i] = clamp(outL[i] * totalGain, -0.72, 0.72);
      outR[i] = clamp(outR[i] * totalGain, -0.72, 0.72);
    }

    let finalL = outL;
    let finalR = outR;
    if (this.brightness < 0.995) {
      const cutoff = lerp(600.0, 17000.0, Math.pow(clamp(this.brightness, 0, 1), 0.55));
      const coeff = Math.exp((-2.0 * Math.PI * cutoff) / this.sampleRate);
      const [fl, bl] = onePoleLowpass(finalL, coeff, this.brightStateL);
      const [fr, br] = onePoleLowpass(finalR, coeff, this.brightStateR);
      finalL = fl;
      finalR = fr;
      this.brightStateL = bl;
      this.brightStateR = br;
    }

    const { wetL, wetR } = this.reverb.process(finalL, finalR);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = clamp(finalL[i] + wetL[i] * this.reverbMix, -0.72, 0.72);
      right[i] = clamp(finalR[i] + wetR[i] * this.reverbMix, -0.72, 0.72);
    }
    return [left, right];
  }
}
