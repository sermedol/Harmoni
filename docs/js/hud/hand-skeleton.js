// harmoni.py HUDRenderer._draw_hand_skeletons - Canvas2D portu.
import { HAND_CONNECTIONS } from "../camera/hand-tracker.js";

const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, RING_MCP = 13, PINKY_MCP = 17;
const THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_TIP = 12, RING_TIP = 16, PINKY_TIP = 20;
const displayTracks = new Map();

export function interpolateLandmark(previous, target) {
  const distance = Math.hypot(target[0] - previous[0], target[1] - previous[1]);
  // Keep the overlay visually planted while the hand is still. This is only
  // presentation smoothing; gesture/audio calculations continue to use the
  // tracker data and therefore remain responsive.
  if (distance <= 4) return [...previous];
  const alpha = distance < 14 ? 0.12 : distance > 70 ? 0.68 : Math.min(0.54, 0.24 + distance / 230);
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
  const gestures = {
    "OPEN_HAND": "Açık Avuç",
    "FIST": "Yumruk",
    "PEACE": "Barış İşareti",
    "PINCH": "Pinch",
    "POINTING_UP": "Yukarı İşaret",
    "THUMB_UP": "Başparmak Yukarı",
  };
  return gestures[gesture] || gesture;
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
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.5;

  for (const hand of renderedHands) {
    const color = hand.label === "RIGHT" ? theme.primary : theme.secondary;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(hand.landmarks[a][0], hand.landmarks[a][1]);
      ctx.lineTo(hand.landmarks[b][0], hand.landmarks[b][1]);
      ctx.stroke();
    }

    for (const idx of [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]) {
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const idx of [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]) {
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hand.landmarks[idx][0], hand.landmarks[idx][1], 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const [cx, cy] = hand.palmCenter;
    let label = hand.label === "RIGHT" ? "Sağ El" : "Sol El";
    label += " • " + gestureLabel(hand.gesture);
    ctx.font = "11px sans-serif";
    ctx.globalAlpha = 1;
    const tw = ctx.measureText(label).width;
    roundedRect(ctx, cx - tw / 2 - 8, cy + 38, tw + 16, 22, 8);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.fillText(label, cx - tw / 2, cy + 52);

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
