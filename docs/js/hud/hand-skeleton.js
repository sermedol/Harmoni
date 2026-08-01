// harmoni.py HUDRenderer._draw_hand_skeletons - Canvas2D portu.
import { HAND_CONNECTIONS } from "../camera/hand-tracker.js";

const WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, RING_MCP = 13, PINKY_MCP = 17;
const THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_TIP = 12, RING_TIP = 16, PINKY_TIP = 20;

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
  ctx.save();
  ctx.globalAlpha = theme.dark ? 0.8 : 0.72;
  ctx.lineWidth = theme.dark ? 1 : 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const hand of hands) {
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

  if (hands.length >= 2 && hands.slice(0, 2).every((h) => h.gesture === "OPEN_HAND")) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hands[0].palmCenter[0], hands[0].palmCenter[1]);
    ctx.lineTo(hands[1].palmCenter[0], hands[1].palmCenter[1]);
    ctx.stroke();
    ctx.restore();
  }
}
