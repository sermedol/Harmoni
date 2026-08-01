// harmoni.py: PitchSnapshot / MusicSnapshot dataclass'larinin JS karsiligi.
// Plain object fabrikalari - JS'te thread/lock olmadigindan sinif+kilit
// gerekmez, mesajlasma protokolu (bkz. audio/audio-graph.js) tek kaynakli
// "son deger kazanir" semantigini zaten sagliyor.

/**
 * @typedef {Object} PitchSnapshot
 * @property {number} frequency
 * @property {number} midiNote
 * @property {string} noteName
 * @property {number} confidence
 * @property {number} rms
 * @property {number} cents
 * @property {boolean} voiced
 * @property {number} timestamp
 */
export function defaultPitchSnapshot() {
  return {
    frequency: 0,
    midiNote: -1,
    noteName: "--",
    confidence: 0,
    rms: 0,
    cents: 0,
    voiced: false,
    timestamp: 0,
  };
}

/**
 * @typedef {Object} MusicSnapshot
 * @property {string} keyName
 * @property {number} keyRoot
 * @property {string} mode
 * @property {string} chordName
 * @property {number[]} chordNotes
 * @property {number} bpm
 * @property {number} beatPhase
 * @property {number} keyConfidence
 * @property {number} accompanimentConfidence
 * @property {number} vocalCenterMidi
 * @property {boolean} phraseActive
 * @property {number} chordRevision
 * @property {"western"|"makam"} tonalSystem
 * @property {string} makamName
 * @property {number} makamTonicKoma
 * @property {number} makamConfidence
 * @property {number[]} makamDegrees
 * @property {"duz"|"aksak"} rhythmFeel
 */
export function defaultMusicSnapshot() {
  return {
    keyName: "C",
    keyRoot: 0,
    mode: "major",
    chordName: "--",
    chordNotes: [],
    bpm: 96,
    beatPhase: 0,
    keyConfidence: 0,
    accompanimentConfidence: 0,
    vocalCenterMidi: 60,
    phraseActive: false,
    chordRevision: 0,
    tonalSystem: "western",
    makamName: "HICAZ",
    makamTonicKoma: 0,
    makamConfidence: 0,
    makamDegrees: [],
    rhythmFeel: "duz",
  };
}
