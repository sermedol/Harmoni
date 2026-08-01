// harmoni.py: RuntimeState dataclass'inin JS karsiligi. Python'da tum
// okuma/yazma bir threading.RLock uzerinden yapilir (kamera/ses/UI ayri
// thread'ler oldugu icin); JS'te main thread tek ve senkron oldugundan kilit
// gerekmez - worklet ile iletisim zaten mesaj gecisiyle (bkz. audio-graph.js)
// "son deger kazanir" seklinde izole edilmis durumda.
import { defaultPitchSnapshot, defaultMusicSnapshot } from "./harmony/pitch-types.js";

export function createAppState() {
  const listeners = new Set();
  const state = {
    pitch: defaultPitchSnapshot(),
    music: defaultMusicSnapshot(),
    vocalLevel: 0,
    outputLevel: 0,
    audioStatus: "OFFLINE",
    cameraStatus: "OFFLINE",
    cameraFps: 0,
    detectorFps: 0,
    gesture: "NEUTRAL",
    gestureDetail: "",
    activeLayers: new Set(["PIANO"]),
    waveform: new Float32Array(256),
    latencyMs: 0,
    autoArrangeEnabled: true,
    showGuide: false,
    simpleMode: true,
    themeIndex: 0,
    brightness: 1.0,
    articulation: 0.5,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify() {
      for (const fn of listeners) fn(state);
    },
  };
  return state;
}
