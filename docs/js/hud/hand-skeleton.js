// harmoni.py HUDRenderer._draw_hand_skeletons - Canvas2D portu.
import { HAND_CONNECTIONS } from "../camera/hand-tracker.js";

const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, RING_MCP = 13, PINKY_MCP = 17;
const THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_TIP = 12, RING_TIP = 16, PINKY_TIP = 20;
const displayTracks = new Map();

// Bu katman YALNIZCA gorsel ara deger uretir: tespit her karede calismayabilir
// (processEvery) ama sahne 60fps cizilir, arada iskelet basamakli gorunmesin
// diye hedefe yumusak yaklasilir.
//
// Burada da esik tabanli olu bolge (distance <= 4 -> dondur) kaldirildi.
// Gurultu bastirma artik tek bir yerde, hand-tracker.js icindeki 1€
// filtresinde yapiliyor. Iki katmanda birden esik uygulamak hem gecikmeyi
// ikiye katliyor hem de iki ayri stick-slip kaynagi yaratiyordu.
export function interpolateLandmark(previous, target) {
  const distance = Math.hypot(target[0] - previous[0], target[1] - previous[1]);
  // Surekli fonksiyon: mesafe buyudukce yaklasma orani puruzsuz artar,
  // hicbir noktada sicrama ya da donma yok.
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
  displayTracks.set(source.label, { landmarks, lastSeen: now });
  return { ...source, landmarks, palmCenter };
}

function gestureLabel(gesture) {
  const replaced = gesture.replace("OPEN_HAND", "Acik").replace("FIST", "Kapali").replace("PEACE", "Peace");
  return replaced.charAt(0).toUpperCase() + replaced.slice(1).toLowerCase();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawHandSkeletons(ctx, hands, theme) {
  const now = performance.now();
  const renderedHands = hands.map((hand) => displayHand(hand, now));
  const visibleLabels = new Set(hands.map((hand) => hand.label));
  for (const [label, track] of displayTracks) {
    if (!visibleLabels.has(label) && now - track.lastSeen > 220) displayTracks.delete(label);
  }
  ctx.save();
  ctx.globalAlpha = theme.dark ? 0.8 : 0.72;
  ctx.lineWidth = theme.dark ? 1 : 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const hand of renderedHands) {
    const color = hand.label === "RIGHT" ? theme.primary : theme.secondary;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = theme.dark ? 1 : 2;

    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(hand.landmarks[a][0], hand.landmarks[a][1]);
      ctx.lineTo(hand.landmarks[b][0], hand.landmarks[b][1]);
      ctx.stroke();
    }
    for (const idx of [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]) {
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const idx of [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]) {
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    const [cx, cy] = hand.palmCenter;
    let label = hand.label === "RIGHT" ? "Sag el" : "Sol el";
    label += " - " + gestureLabel(hand.gesture);
    ctx.font = "12px sans-serif";
    const tw = ctx.measureText(label).width;
    roundedRect(ctx, cx - tw / 2 - 10, cy + 37, tw + 20, 25, 11);
    ctx.fillStyle = theme.panel;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.fillText(label, cx - tw / 2, cy + 54);

    if (hand.gesture === "PINCH") {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hand.landmarks[THUMB_TIP][0], hand.landmarks[THUMB_TIP][1]);
      ctx.lineTo(hand.landmarks[INDEX_TIP][0], hand.landmarks[INDEX_TIP][1]);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (renderedHands.length >= 2 && renderedHands.slice(0, 2).every((h) => h.gesture === "OPEN_HAND")) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(renderedHands[0].palmCenter[0], renderedHands[0].palmCenter[1]);
    ctx.lineTo(renderedHands[1].palmCenter[0], renderedHands[1].palmCenter[1]);
    ctx.stroke();
    ctx.restore();
  }
}
