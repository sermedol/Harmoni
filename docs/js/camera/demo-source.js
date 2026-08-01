// Yeni modul (Python'da karsiligi yok). Kamera/mikrofon iznine erisemeyen bu
// ortamda (ve kullanicinin kamerasiz denemek istemesi durumunda) tum
// jest-dispatch ve HUD hattini deterministik olarak calistirmak icin
// sentetik iki-el akisi uretir. ?demo=1 ile main.js tarafindan kullanilir.
import { classifyGesture } from "./gesture-classifier.js";

const FINGER_ANGLES_DEG = { thumb: -55, index: -20, middle: 0, ring: 20, pinky: 45 };
const FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"];

// Sirayla gezilecek jest senaryolari: [gesture-adi, sure(sn)]
const SCRIPT = [
  ["NEUTRAL", 2.0],
  ["OPEN_HAND", 3.0],
  ["POINT", 2.0],
  ["PEACE", 2.0],
  ["FIST", 1.5],
  ["PINCH", 2.5],
];

const FINGER_PATTERNS = {
  NEUTRAL: [false, false, true, true, false],
  OPEN_HAND: [true, true, true, true, true],
  POINT: [false, true, false, false, false],
  PEACE: [false, true, true, false, false],
  FIST: [false, false, false, false, false],
  PINCH: [true, true, false, false, false],
};

function dir(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return [Math.sin(rad), -Math.cos(rad)];
}

function buildLandmarks(center, handSize, gesture) {
  const fingers = FINGER_PATTERNS[gesture] || FINGER_PATTERNS.NEUTRAL;
  const points = new Array(21);
  points[0] = [center[0], center[1] + handSize * 0.55]; // WRIST

  FINGER_ORDER.forEach((name, fi) => {
    const extended = fingers[fi];
    const [dx, dy] = dir(FINGER_ANGLES_DEG[name]);
    const mcpR = handSize * 0.35;
    const base = fi === 0 ? 1 : 5 + (fi - 1) * 4; // thumb=1..4, others 5,9,13,17
    if (name === "thumb") {
      const mcp = [center[0] + dx * mcpR * 0.6, center[1] + dy * mcpR * 0.6];
      const ip = [center[0] + dx * (mcpR + handSize * 0.15), center[1] + dy * (mcpR + handSize * 0.15)];
      const tipR = extended ? mcpR + handSize * 0.75 : mcpR * 0.5;
      const tip = [center[0] + dx * tipR, center[1] + dy * tipR];
      points[1] = mcp;
      points[2] = mcp;
      points[3] = ip;
      points[4] = tip;
    } else {
      const mcp = [center[0] + dx * mcpR, center[1] + dy * mcpR];
      let pip, dip, tip;
      if (extended) {
        pip = [center[0] + dx * (mcpR + handSize * 0.35), center[1] + dy * (mcpR + handSize * 0.35)];
        dip = [center[0] + dx * (mcpR + handSize * 0.55), center[1] + dy * (mcpR + handSize * 0.55)];
        tip = [center[0] + dx * (mcpR + handSize * 0.75), center[1] + dy * (mcpR + handSize * 0.75)];
      } else {
        pip = [center[0] + dx * (mcpR + handSize * 0.15), center[1] + dy * (mcpR + handSize * 0.15)];
        tip = [pip[0], pip[1] + handSize * 0.18];
        dip = [(pip[0] + tip[0]) / 2, (pip[1] + tip[1]) / 2];
      }
      points[base] = mcp;
      points[base + 1] = pip;
      points[base + 2] = dip;
      points[base + 3] = tip;
    }
  });

  if (gesture === "PINCH") {
    const [dx, dy] = dir(-10);
    const pinchPoint = [center[0] + dx * handSize * 0.5, center[1] + dy * handSize * 0.5];
    points[4] = pinchPoint; // thumb tip
    points[8] = [pinchPoint[0] + handSize * 0.03, pinchPoint[1]]; // index tip, cok yakin
  }
  return points;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function packetFromCenter(label, center, handSize, gesture, t) {
  const points = buildLandmarks(center, handSize, gesture);
  const fingers = FINGER_PATTERNS[gesture] || FINGER_PATTERNS.NEUTRAL;
  const palmIndices = [0, 5, 9, 13, 17];
  const palmCenter = [
    palmIndices.reduce((s, i) => s + points[i][0], 0) / palmIndices.length,
    palmIndices.reduce((s, i) => s + points[i][1], 0) / palmIndices.length,
  ];
  const pinch = dist(points[4], points[8]) / handSize;
  const fingertips = [4, 8, 12, 16, 20];
  const openness = fingertips.reduce((s, i) => s + dist(points[i], palmCenter), 0) / fingertips.length / handSize;
  const resolvedGesture = classifyGesture(fingers, pinch);
  return {
    label,
    landmarks: points,
    normalized: points.map(([x, y]) => [x / 1280, y / 720, 0]),
    gesture: resolvedGesture,
    confidence: 0.95,
    openness,
    pinch,
    fingers,
    palmCenter,
    handSize,
  };
}

const SCRIPT_TOTAL = SCRIPT.reduce((sum, [, duration]) => sum + duration, 0);

export function createDemoHandSource(width = 1280, height = 720) {
  const startTime = performance.now();

  return {
    next() {
      const t = (performance.now() - startTime) / 1000;
      // Gercek gecen zamana (wall-clock) gore faz secimi - sabit
      // kare-basi artis kullanmaz, boylece rAF hizi/kesintisinden bagimsiz
      // olarak her zaman "su an hangi fazda olunmasi gerektigi"ni dogru verir.
      let elapsed = t % SCRIPT_TOTAL;
      let idx = 0;
      while (elapsed >= SCRIPT[idx][1]) {
        elapsed -= SCRIPT[idx][1];
        idx += 1;
      }
      const gesture = SCRIPT[idx][0];

      const handSize = Math.min(width, height) * 0.14;
      const leftCenter = [
        width * 0.32 + Math.sin(t * 0.6) * width * 0.05,
        height * 0.55 + Math.cos(t * 0.5) * height * 0.06,
      ];
      const rightCenter = [
        width * 0.68 + Math.sin(t * 0.6 + Math.PI) * width * 0.05,
        height * 0.55 + Math.cos(t * 0.5 + Math.PI) * height * 0.06,
      ];

      return [
        packetFromCenter("LEFT", leftCenter, handSize, gesture, t),
        packetFromCenter("RIGHT", rightCenter, handSize, gesture, t),
      ];
    },
  };
}

export function drawDemoBackground(ctx, width, height, t) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  const hue = (t * 12) % 360;
  grad.addColorStop(0, `hsl(${hue}, 35%, 12%)`);
  grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 35%, 8%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "16px sans-serif";
  ctx.fillText("DEMO MODU - sentetik el verisi (kamera yok)", 24, height - 20);
}
