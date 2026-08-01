// harmoni.py HandTracker + HandPacket - birebir port. MediaPipe Tasks Vision
// (CDN'den ES modul olarak yuklenir) kullanir; yuklenemezse (agsizlik, WASM
// hatasi) Python'daki MP_AVAILABLE=false davranisiyla ayni sekilde
// `available=false` olur ve process() daima bos dizi dondurur - uygulamanin
// geri kalani (jest kontrolu, HUD) sessizce "eller yok" durumuna duser.
import { clamp } from "../constants/music-utils.js";
import { classifyGesture, createGestureHistory } from "./gesture-classifier.js?v=20260801-27";

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
  const extended = (mcp, pip, tip) => {
    const straight = jointAngle(points[mcp], points[pip], points[tip]);
    const reach = dist(points[tip], wrist) / Math.max(1, dist(points[pip], wrist));
    return straight > 152 && reach > 1.08;
  };
  const thumbStraight = jointAngle(points[1], points[THUMB_IP], points[THUMB_TIP]);
  const thumbReach = dist(points[THUMB_TIP], points[MIDDLE_MCP]) / Math.max(1, dist(points[THUMB_IP], points[MIDDLE_MCP]));
  return [
    thumbStraight > 145 && thumbReach > 1.08,
    extended(INDEX_MCP, INDEX_PIP, INDEX_TIP),
    extended(MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP),
    extended(RING_MCP, RING_PIP, RING_TIP),
    extended(PINKY_MCP, PINKY_PIP, PINKY_TIP),
  ];
}

// MediaPipe'ın durağan elde ürettiği birkaç piksellik gürültüyü emer; gerçek
// hareket büyüdükçe katsayı hızla yükselir ve el ağırlaşmış hissettirmez.
export function smoothLandmarkPoint(previous, current) {
  const movement = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
  // A stationary MediaPipe landmark commonly wanders by 3-6 screen pixels.
  // Treat that as sensor noise instead of continuously chasing it. Once the
  // hand genuinely moves, open the filter progressively so controls stay live.
  if (movement < 0.0042) return [...previous];
  const alpha = movement < 0.012
    ? 0.14
    : clamp(0.18 + movement * 14, 0.34, 0.82);
  const zAlpha = clamp(alpha * 0.72, 0.1, 0.62);
  return [
    previous[0] + (current[0] - previous[0]) * alpha,
    previous[1] + (current[1] - previous[1]) * alpha,
    previous[2] + (current[2] - previous[2]) * zAlpha,
  ];
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
    this.smoothLandmarks = new Map(); // label -> Float32Array(21*3)
    this.gestureHistory = createGestureHistory();
    this.detectorTimes = [];
    this.lastProcessAt = 0;
    this.missingSince = new Map();
    this.processing = false;
  }

  async init() {
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("El modeli yükleme zaman aşımı")), 15000));
      const modulePromise = import(/* webpackIgnore: true */ `${VISION_BASE}/vision_bundle.mjs`);
      const { HandLandmarker, FilesetResolver } = await Promise.race([modulePromise, timeout]);
      const fileset = await FilesetResolver.forVisionTasks(`${VISION_BASE}/wasm`);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: this.maxHands,
        minHandDetectionConfidence: 0.50,
        minTrackingConfidence: 0.45,
      });
      this.available = true;
    } catch (err) {
      console.warn("HandTracker: MediaPipe yuklenemedi, el takibi devre disi.", err);
      this.available = false;
      this.landmarker = null;
    }
    return this.available;
  }

  get detectorFps() {
    if (!this.detectorTimes.length) return 0;
    const averageInterval = this.detectorTimes.reduce((a, b) => a + b, 0) / this.detectorTimes.length;
    return averageInterval > 0 ? 1000 / averageInterval : 0;
  }

  reset(label) {
    if (label) {
      this.smoothLandmarks.delete(label);
      this.missingSince.delete(label);
      this.gestureHistory.reset(label);
    } else {
      this.smoothLandmarks.clear();
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
        const previous = this.smoothLandmarks.get(label);
        let normalized;
        if (previous) {
          normalized = rawNormalized.map((p, i) => [
            previous[i][0] * 0.68 + p[0] * 0.32,
            previous[i][1] * 0.68 + p[1] * 0.32,
            previous[i][2] * 0.68 + p[2] * 0.32,
          ]);
        } else {
          normalized = rawNormalized;
        }
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
