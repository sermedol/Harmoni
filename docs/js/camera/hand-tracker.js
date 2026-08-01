// harmoni.py HandTracker + HandPacket - birebir port. MediaPipe Tasks Vision
// (CDN'den ES modul olarak yuklenir) kullanir; yuklenemezse (agsizlik, WASM
// hatasi) Python'daki MP_AVAILABLE=false davranisiyla ayni sekilde
// `available=false` olur ve process() daima bos dizi dondurur - uygulamanin
// geri kalani (jest kontrolu, HUD) sessizce "eller yok" durumuna duser.
import { clamp } from "../constants/music-utils.js";
import { classifyGesture, createGestureHistory } from "./gesture-classifier.js";

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
  }

  async init() {
    try {
      const { HandLandmarker, FilesetResolver } = await import(
        /* webpackIgnore: true */ `${VISION_BASE}/vision_bundle.mjs`
      );
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
    return this.detectorTimes.reduce((a, b) => a + b, 0) / this.detectorTimes.length;
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

    const started = performance.now();
    const result = this.landmarker.detectForVideo(source, timestampMs);
    const packets = [];

    if (result.landmarks && result.landmarks.length > 0) {
      for (let idx = 0; idx < result.landmarks.length; idx++) {
        const lm = result.landmarks[idx];
        const handedness = result.handednesses?.[idx]?.[0];
        const label = (handedness?.categoryName || "Right").toUpperCase();
        const confidence = handedness?.score ?? 0;

        const rawNormalized = lm.map((p) => [p.x, p.y, p.z]);
        const previous = this.smoothLandmarks.get(label);
        let normalized;
        if (previous) {
          normalized = rawNormalized.map((p, i) => [
            previous[i][0] * 0.45 + p[0] * 0.55,
            previous[i][1] * 0.45 + p[1] * 0.55,
            previous[i][2] * 0.45 + p[2] * 0.55,
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
      }
      this.lastDetectionTime = performance.now();
    } else if (performance.now() - this.lastDetectionTime < 180) {
      packets.push(...this.lastPackets);
    }

    this.lastPackets = packets;
    const elapsed = (performance.now() - started) / 1000;
    if (elapsed > 0) {
      this.detectorTimes.push(1 / elapsed);
      if (this.detectorTimes.length > 20) this.detectorTimes.shift();
    }
    return packets;
  }

  _buildPacket(label, confidence, points, normalized) {
    const palmIndices = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
    const palmCenter = [
      palmIndices.reduce((s, i) => s + points[i][0], 0) / palmIndices.length,
      palmIndices.reduce((s, i) => s + points[i][1], 0) / palmIndices.length,
    ];
    const handSize = Math.max(20, dist(points[WRIST], points[MIDDLE_MCP]) * 1.9);
    const nonThumb = [
      points[INDEX_TIP][1] < points[INDEX_PIP][1],
      points[MIDDLE_TIP][1] < points[MIDDLE_PIP][1],
      points[RING_TIP][1] < points[RING_PIP][1],
      points[PINKY_TIP][1] < points[PINKY_PIP][1],
    ];
    const thumbExtended = dist(points[THUMB_TIP], palmCenter) > dist(points[THUMB_IP], palmCenter) * 1.13;
    const fingers = [thumbExtended, ...nonThumb];
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
