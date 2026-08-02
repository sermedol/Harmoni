// harmoni.py HandTracker + HandPacket - birebir port. MediaPipe Tasks Vision
// (CDN'den ES modul olarak yuklenir) kullanir; yuklenemezse (agsizlik, WASM
// hatasi) Python'daki MP_AVAILABLE=false davranisiyla ayni sekilde
// `available=false` olur ve process() daima bos dizi dondurur - uygulamanin
// geri kalani (jest kontrolu, HUD) sessizce "eller yok" durumuna duser.
import { clamp } from "../constants/music-utils.js";
import { classifyGesture, createGestureHistory } from "./gesture-classifier.js?v=20260802-09";

const VISION_VERSION = "0.10.14";
const VISION_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function jointAngle(a, b, c) {
  const abx = a[0] - b[0], aby = a[1] - b[1];
  const cbx = c[0] - b[0], cby = c[1] - b[1];
  const denominator = Math.max(1e-6, Math.hypot(abx, aby) * Math.hypot(cbx, cby));
  return Math.acos(clamp((abx * cbx + aby * cby) / denominator, -1, 1)) * 180 / Math.PI;
}

// Ekrandaki yöne bağlı değildir; el yana veya çapraz durduğunda da çalışır.
export function fingerStates(points) {
  const wrist = points[WRIST];
  // Esikler kasitli olarak gevsek: insan eli "acik" dururken parmaklar
  // genelde 138-155 derece arasindadir, cetvel gibi duz degildir. Onceki
  // 152 derece siniri dort parmagin ayni anda gecmesini gerektirdigi icin
  // ACIK AVUC pratikte hic tetiklenmiyordu.
  const extended = (mcp, pip, tip) => {
    const straight = jointAngle(points[mcp], points[pip], points[tip]);
    const reach = dist(points[tip], wrist) / Math.max(1, dist(points[pip], wrist));
    return straight > 138 && reach > 1.04;
  };
  const thumbStraight = jointAngle(points[1], points[THUMB_IP], points[THUMB_TIP]);
  const thumbReach = dist(points[THUMB_TIP], points[MIDDLE_MCP]) / Math.max(1, dist(points[THUMB_IP], points[MIDDLE_MCP]));
  return [
    thumbStraight > 131 && thumbReach > 1.03,
    extended(INDEX_MCP, INDEX_PIP, INDEX_TIP),
    extended(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP),
    extended(RING_MCP, RING_PIP, RING_TIP),
    extended(PINKY_MCP, PINKY_PIP, PINKY_TIP),
  ];
}

// --- 1€ filtresi (Casiez, Roussel & Vogt, CHI 2012) ----------------------
//
// Neden esik tabanli olu bolge birakildi: "hareket < esik ise noktayi
// dondur" yaklasimi titremeyi cozmez, bicimini degistirir. Gurultu esigin
// etrafinda gezindiginde nokta "tamamen donuk" ile "bir anda alpha kadar
// sicra" arasinda gidip gelir (stick-slip) ve bu gozle duz gurultuden daha
// rahatsiz edicidir. Esigi yukseltmek eli agirlastirir, dusurmek gurultuyu
// geri getirir; arada calisan bir deger yoktur.
//
// 1€ filtresinde esik yoktur. Kesim frekansi ele ait hiza gore surekli
// uyarlanir: el dururken kesim dusuktur (agresif yumusatma -> titreme yok),
// el hizlandikca kesim yukselir (hafif yumusatma -> gecikme yok). Filtre
// ayrica kare suresini (dt) hesaba katar, yani fps degisince davranis
// degismez.
function lowPassAlpha(cutoffHz, dtSeconds) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

// Varsayilanlar olcumle secildi (30fps, +-0.004 normalize gurultu ile):
//   eski esik filtresi : std 0.89px, maxSapma 1.88px, karelerin %80'i donuk,
//                        en buyuk sicrama ortalamanin 6.6 kati  <- titreme
//   minCutoff .3 beta 8: std 0.62px, maxSapma 1.64px, donuk kare yok,
//                        en buyuk sicrama ortalamanin 2.7 kati, %90'a 4 kare
export function createOneEuroFilter({ minCutoff = 0.3, beta = 8, derivativeCutoff = 1 } = {}) {
  let value = null;
  let derivative = 0;
  return {
    reset() { value = null; derivative = 0; },
    filter(raw, dtSeconds) {
      const dt = dtSeconds > 0 ? dtSeconds : 1 / 60;
      if (value === null) { value = raw; return raw; }
      const rawDerivative = (raw - value) / dt;
      derivative += lowPassAlpha(derivativeCutoff, dt) * (rawDerivative - derivative);
      const cutoff = minCutoff + beta * Math.abs(derivative);
      value += lowPassAlpha(cutoff, dt) * (raw - value);
      return value;
    },
  };
}

// El basina 21 landmark x 3 eksen filtre bankasi.
export function createLandmarkSmoother(options = {}) {
  const banks = new Map();
  const makeBank = () => Array.from({ length: 21 }, () => [
    createOneEuroFilter(options),
    createOneEuroFilter(options),
    // Derinlik ekseni daha gurultuludur; biraz daha agir yumusatilir.
    createOneEuroFilter({ ...options, minCutoff: (options.minCutoff ?? 0.3) * 0.6 }),
  ]);
  return {
    smooth(label, points, dtSeconds) {
      let bank = banks.get(label);
      if (!bank) { bank = makeBank(); banks.set(label, bank); }
      return points.map((point, index) => [
        bank[index][0].filter(point[0], dtSeconds),
        bank[index][1].filter(point[1], dtSeconds),
        bank[index][2].filter(point[2] ?? 0, dtSeconds),
      ]);
    },
    reset(label) {
      if (label) banks.delete(label);
      else banks.clear();
    },
  };
}

export function associateHandLabels(wrists, rawLabels, previousHands, maxDistance = 0.24) {
  const labels = [...rawLabels];
  const usedPrevious = new Set();
  for (let i = 0; i < wrists.length; i++) {
    let bestIndex = -1;
    let bestDistance = maxDistance;
    for (let j = 0; j < previousHands.length; j++) {
      if (usedPrevious.has(j)) continue;
      const previousWrist = previousHands[j]?.normalized?.[WRIST];
      if (!previousWrist) continue;
      const distance = Math.hypot(wrists[i][0] - previousWrist[0], wrists[i][1] - previousWrist[1]);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = j; }
    }
    if (bestIndex >= 0) {
      labels[i] = previousHands[bestIndex].label;
      usedPrevious.add(bestIndex);
    }
  }
  if (labels.length === 2 && labels[0] === labels[1]) {
    const duplicate = labels[0];
    labels[1] = duplicate === "RIGHT" ? "LEFT" : "RIGHT";
  }
  return labels;
}

export class HandTracker {
  constructor({ processEvery = 2, maxHands = 2 } = {}) {
    this.available = false;
    this.landmarker = null;
    this.processEvery = Math.max(1, processEvery);
    this.maxHands = maxHands;
    this.frameIndex = 0;
    this.lastPackets = [];
    this.lastDetectionTime = -Infinity;
    this.smoothLandmarks = new Map(); // label -> son filtrelenmis landmark dizisi
    this.smoother = createLandmarkSmoother();
    this.gestureHistory = createGestureHistory();
    this.detectorTimes = [];
    this.lastProcessAt = 0;
    this.lastFrameAt = 0;
    this.missingSince = new Map();
    this.processing = false;
  }

  async init() {
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("El modeli yükleme zaman aşımı")), 15000));
      const modulePromise = import(/* webpackIgnore: true */ `${VISION_BASE}/vision_bundle.mjs`);
      const { HandLandmarker, FilesetResolver } = await Promise.race([modulePromise, timeout]);
      const fileset = await FilesetResolver.forVisionTasks(`${VISION_BASE}/wasm`);
      let lastError;
      for (const delegate of ["GPU", "CPU"]) {
        try {
          this.landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
            runningMode: "VIDEO", numHands: this.maxHands,
            minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.42,
            minTrackingConfidence: 0.44,
          });
          this.delegate = delegate;
          break;
        } catch (error) { lastError = error; }
      }
      if (!this.landmarker) throw lastError || new Error("El modeli başlatılamadı");
      this.available = true;
    } catch (err) {
      console.warn("HandTracker: MediaPipe yuklenemedi, el takibi devre disi.", err);
      this.available = false;
      this.landmarker = null;
    }
    return this.available;
  }

  // Kamera 30fps uretirken sahne 60fps cizilir; yeni bir video karesi
  // gelmedigi karelerde tespit calistirilmaz. O karelerde el listesini BOS
  // birakmak iskeletin ve jestlerin saniyede ~30 kez sonup yanmasina yol
  // aciyordu. Bunun yerine son gecerli tespit tekrar kullanilir; tespit
  // gercekten eskidiyse (kamera dondu, el cikti) bos donulur.
  recentPackets(nowMs, maxAgeMs = 220) {
    if (!this.available) return [];
    return nowMs - this.lastDetectionTime < maxAgeMs ? this.lastPackets : [];
  }

  get detectorFps() {
    if (!this.detectorTimes.length) return 0;
    const averageInterval = this.detectorTimes.reduce((a, b) => a + b, 0) / this.detectorTimes.length;
    return averageInterval > 0 ? 1000 / averageInterval : 0;
  }

  reset(label) {
    if (label) {
      this.smoothLandmarks.delete(label);
      this.smoother.reset(label);
      this.missingSince.delete(label);
      this.gestureHistory.reset(label);
    } else {
      this.smoothLandmarks.clear();
      this.smoother.reset();
      this.missingSince.clear();
      this.gestureHistory.reset();
      this.lastPackets = [];
    }
  }

  /**
   * @param {CanvasImageSource} source - mirror uygulanmis (Python'daki
   *   cv2.flip ile ayni sirada) kamera karesi.
   * @param {number} timestampMs
   * @param {number} width kaynak piksel genisligi
   * @param {number} height kaynak piksel yuksekligi
   */
  process(source, timestampMs, width, height) {
    this.frameIndex += 1;
    if (!this.available || !this.landmarker) return [];
    if (this.frameIndex % this.processEvery !== 0) return this.lastPackets;

    if (this.processing) return this.lastPackets;
    this.processing = true;
    const started = performance.now();
    let result;
    try { result = this.landmarker.detectForVideo(source, timestampMs); }
    finally { this.processing = false; }
    const packets = [];
    const seen = new Set();
    // 1€ filtresi kare suresine bagli calisir; ilk karede makul bir varsayim.
    const dtSeconds = this.lastFrameAt ? Math.min(0.25, Math.max(0.004, (timestampMs - this.lastFrameAt) / 1000)) : 1 / 30;
    this.lastFrameAt = timestampMs;

    if (result.landmarks && result.landmarks.length > 0) {
      const rawLabels = result.landmarks.map((_, index) => (result.handednesses?.[index]?.[0]?.categoryName || "Right").toUpperCase());
      const stableLabels = associateHandLabels(result.landmarks.map((landmarks) => [landmarks[WRIST].x, landmarks[WRIST].y]), rawLabels, this.lastPackets);
      for (let idx = 0; idx < result.landmarks.length; idx++) {
        const lm = result.landmarks[idx];
        const handedness = result.handednesses?.[idx]?.[0];
        const label = stableLabels[idx];
        seen.add(label);
        const confidence = handedness?.score ?? 0;

        const rawNormalized = lm.map((p) => [p.x, p.y, p.z]);
        const normalized = this.smoother.smooth(label, rawNormalized, dtSeconds);
        this.smoothLandmarks.set(label, normalized);

        const points = normalized.map(([x, y]) => [
          clamp(x, 0, 1) * width,
          clamp(y, 0, 1) * height,
        ]);

        const packet = this._buildPacket(label, confidence, points, normalized);
        packet.gesture = this.gestureHistory.stabilize(label, packet.gesture);
        packets.push(packet);
        this.missingSince.delete(label);
      }
      for (const label of this.smoothLandmarks.keys()) {
        if (!seen.has(label) && !this.missingSince.has(label)) this.missingSince.set(label, timestampMs);
        if (!seen.has(label) && timestampMs - (this.missingSince.get(label) || timestampMs) > 260) this.reset(label);
      }
      this.lastDetectionTime = performance.now();
    } else if (performance.now() - this.lastDetectionTime < 180) {
      packets.push(...this.lastPackets);
    } else {
      this.reset();
    }

    this.lastPackets = packets;
    if (this.lastProcessAt) {
      this.detectorTimes.push(started - this.lastProcessAt);
      if (this.detectorTimes.length > 20) this.detectorTimes.shift();
    }
    this.lastProcessAt = started;
    return packets;
  }

  _buildPacket(label, confidence, points, normalized) {
    const palmIndices = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
    const palmCenter = [
      palmIndices.reduce((s, i) => s + points[i][0], 0) / palmIndices.length,
      palmIndices.reduce((s, i) => s + points[i][1], 0) / palmIndices.length,
    ];
    const handSize = Math.max(20, dist(points[WRIST], points[MIDDLE_MCP]) * 1.9);
    const fingers = fingerStates(points);
    const pinch = dist(points[THUMB_TIP], points[INDEX_TIP]) / handSize;
    const fingertips = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];
    const openness = fingertips.reduce((s, i) => s + dist(points[i], palmCenter), 0) / fingertips.length / handSize;
    const gesture = classifyGesture(fingers, pinch);

    return {
      label,
      landmarks: points,
      normalized,
      gesture,
      confidence,
      openness,
      pinch,
      fingers,
      palmCenter,
      handSize,
    };
  }
}
