// El iskeleti - kuvars malzemesi.
//
// Malzeme hedefi: ince kuvars cizgileri, yari saydam kirik beyaz / acik
// yesil, eklemlerde kucuk ic isik, cok dusuk yogunluklu glow.
//
// KULLANILMAYANLAR (ve nedenleri)
// - Kalin neon cizgi ve parlak beyaz: kamerayi ezip elin kendisini
//   gorunmez kiliyordu.
// - Her elde farkli guclu renk: ikinci bir bilgi katmani gibi okunuyordu;
//   artik sag/sol yalnizca cok hafif ton farkiyla ayriliyor.
// - Buyuk daireler ve etiket balonu: oyun arayuzu hissi veriyordu.
//   Etiket kaldirildi; jest geri bildirimi canvas-hud icinde tek yerden,
//   kisa sureli gosteriliyor.
import { HAND_CONNECTIONS } from "../camera/hand-tracker.js";

const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, RING_MCP = 13, PINKY_MCP = 17;
const THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_TIP = 12, RING_TIP = 16, PINKY_TIP = 20;
const JOINTS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
const TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];

const displayTracks = new Map();

// Bu katman YALNIZCA gorsel ara deger uretir: tespit her karede
// calismayabilir (processEvery) ama sahne 60fps cizilir, arada iskelet
// basamakli gorunmesin diye hedefe yumusak yaklasilir.
//
// Esik tabanli olu bolge burada KULLANILMAZ. Gurultu bastirma tek yerde,
// hand-tracker.js icindeki 1€ filtresinde yapiliyor. Iki katmanda birden
// esik uygulamak hem gecikmeyi ikiye katliyor hem de ikinci bir
// stick-slip kaynagi yaratiyordu.
export function interpolateLandmark(previous, target) {
  const distance = Math.hypot(target[0] - previous[0], target[1] - previous[1]);
  const alpha = Math.min(0.85, 0.22 + distance / 120);
  return [previous[0] + (target[0] - previous[0]) * alpha, previous[1] + (target[1] - previous[1]) * alpha];
}

function displayHand(source, now) {
  const previous = displayTracks.get(source.label);
  const landmarks = previous
    ? source.landmarks.map((point, index) => interpolateLandmark(previous.landmarks[index], point))
    : source.landmarks.map((point) => [...point]);
  const palmIndices = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
  const palmCenter = [
    palmIndices.reduce((sum, index) => sum + landmarks[index][0], 0) / palmIndices.length,
    palmIndices.reduce((sum, index) => sum + landmarks[index][1], 0) / palmIndices.length,
  ];
  // Yeni algilanan el aniden belirmesin: kisa bir aciliş.
  const appearedAt = previous?.appearedAt ?? now;
  displayTracks.set(source.label, { landmarks, lastSeen: now, appearedAt });
  return { ...source, landmarks, palmCenter, appearedAt };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} hands
 * @param {object} theme
 * @param {object} [options]
 * @param {number} [options.pinchAmount] 0-1, PINCH jestinde reverb miktari
 * @param {boolean} [options.reducedMotion]
 */
export function drawHandSkeletons(ctx, hands, theme, options = {}) {
  const now = performance.now();
  const renderedHands = hands.map((hand) => displayHand(hand, now));
  const visibleLabels = new Set(hands.map((hand) => hand.label));
  for (const [label, track] of displayTracks) {
    if (!visibleLabels.has(label) && now - track.lastSeen > 220) displayTracks.delete(label);
  }
  if (!renderedHands.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const hand of renderedHands) {
    // 260 ms'lik yumusak aciliş; takip dalgalandiginda sert yanip sonme olmaz.
    const age = Math.min(1, (now - hand.appearedAt) / 260);
    const fade = options.reducedMotion ? 1 : age * age * (3 - 2 * age);

    // IKI EL DE ayni soluk gul tonunda cizilir. Onceki surumde sol el
    // tamamen terracotta idi; bu, kamera uzerinde kalin kirmizi bir el
    // gibi okunuyordu. Sag/sol ayrimi yalnizca cok hafif bir opaklik
    // farkiyla verilir, renkle degil.
    const lineColor = theme.handLine || theme.primary;
    const jointColor = theme.handJoint || theme.secondary;
    const sideAlpha = hand.label === "RIGHT" ? 1 : 0.88;

    // Cok dusuk yogunluklu dis hat - malzeme hissi.
    ctx.globalAlpha = 0.14 * fade * sideAlpha;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 4.5;
    strokeBones(ctx, hand.landmarks);

    // Ince ic cizgi.
    ctx.globalAlpha = 0.82 * fade * sideAlpha;
    ctx.lineWidth = 1.15;
    strokeBones(ctx, hand.landmarks);

    // Eklemler: kucuk terracotta ic isik - tek renk vurgusu burada.
    for (const index of JOINTS) {
      ctx.fillStyle = jointColor;
      ctx.globalAlpha = 0.55 * fade;
      dot(ctx, hand.landmarks[index], 1.9);
    }
    for (const index of TIPS) {
      ctx.fillStyle = jointColor;
      ctx.globalAlpha = 0.24 * fade;
      dot(ctx, hand.landmarks[index], 5.2);
      ctx.fillStyle = lineColor;
      ctx.globalAlpha = 0.95 * fade * sideAlpha;
      dot(ctx, hand.landmarks[index], 2.2);
    }

    if (hand.gesture === "PINCH") drawPinchRing(ctx, hand, theme, fade, options.pinchAmount);
  }

  // Iki acik avuc: aralarinda cok silik bir bag.
  if (renderedHands.length >= 2 && renderedHands.slice(0, 2).every((hand) => hand.gesture === "OPEN_HAND")) {
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(renderedHands[0].palmCenter[0], renderedHands[0].palmCenter[1]);
    ctx.lineTo(renderedHands[1].palmCenter[0], renderedHands[1].palmCenter[1]);
    ctx.stroke();
  }

  ctx.restore();
}

function strokeBones(ctx, landmarks) {
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(landmarks[a][0], landmarks[a][1]);
    ctx.lineTo(landmarks[b][0], landmarks[b][1]);
  }
  ctx.stroke();
}

function dot(ctx, point, radius) {
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Pinch: elin cevresinde ince dairesel gosterge.
 * Halkanin dolulugu mevcut reverb degerini gosterir; buyuk yuzde yazisi yok.
 */
function drawPinchRing(ctx, hand, theme, fade, amount) {
  const thumb = hand.landmarks[THUMB_TIP];
  const index = hand.landmarks[INDEX_TIP];
  const cx = (thumb[0] + index[0]) / 2;
  const cy = (thumb[1] + index[1]) / 2;
  const radius = Math.max(18, hand.handSize ? hand.handSize * 0.42 : 26);
  const value = Math.max(0, Math.min(1, amount ?? 0));

  ctx.globalAlpha = 0.28 * fade;
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.9 * fade;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value);
  ctx.stroke();

  // Bas parmak ve isaret arasinda ince bag.
  ctx.globalAlpha = 0.55 * fade;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(thumb[0], thumb[1]);
  ctx.lineTo(index[0], index[1]);
  ctx.stroke();
}

export function resetHandSkeleton() {
  displayTracks.clear();
}
