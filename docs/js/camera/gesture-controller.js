// harmoni.py GestureController - birebir port. Ses motoruna dogrudan
// baglanmiyor; `synthActions` arayuzu (toggleLayer/fullOrchestra/muteExtras/
// setBrightness/setArticulation/setFxAmount/setDensityGain) araciligiyla
// calisir, boylece gercek ses motoru (worklet) baglanana kadar (Milestone
// 3-4) main.js bir stub gecebilir; bu dosyanin kendisi degismez.
import { clamp, lerp } from "../constants/music-utils.js";

const CAM_WIDTH = 1280;

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export class GestureController {
  constructor(state, synthActions) {
    this.state = state;
    this.synthActions = synthActions;
    this.lastEvent = new Map();
    this.dualOpenSince = null;
    this.layerCursor = 0;
    this.layerOrder = [
      "STRINGS", "PAD", "BASS", "DRUMS", "BAGLAMA", "WOODWINDS", "BRASS", "NEY",
      "GITAR", "KEMAN", "DAVUL",
    ];
    this.lastPalm = new Map(); // label -> {point, time, size}
    this.brightnessSmooth = 1.0;
    this.articulationSmooth = 0.5;
    this.previousGestures = new Map();
    this.dualTriggered = false;
  }

  _allowed(event, cooldown = 1.1) {
    const now = performance.now() / 1000;
    const previous = this.lastEvent.get(event) || 0;
    if (now - previous < cooldown) return false;
    this.lastEvent.set(event, now);
    return true;
  }

  _updateExpression(hands) {
    const now = performance.now() / 1000;
    if (!hands.length) {
      this.brightnessSmooth = lerp(this.brightnessSmooth, 1.0, 0.05);
      this.articulationSmooth = lerp(this.articulationSmooth, 0.5, 0.05);
      this.synthActions.setBrightness(this.brightnessSmooth);
      this.synthActions.setArticulation(this.articulationSmooth);
      this.lastPalm.clear();
      return;
    }

    const opennessValues = hands.map((h) => clamp((h.openness - 0.55) / 0.65, 0, 1));
    const targetBrightness = lerp(0.15, 1.0, opennessValues.reduce((a, b) => a + b, 0) / opennessValues.length);

    const speeds = [];
    const seenLabels = new Set();
    for (const hand of hands) {
      seenLabels.add(hand.label);
      const previous = this.lastPalm.get(hand.label);
      if (previous) {
        const dt = Math.max(1 / 90, now - previous.time);
        speeds.push(dist(hand.palmCenter, previous.point) / Math.max(previous.size, 1) / dt);
      }
      this.lastPalm.set(hand.label, { point: hand.palmCenter, time: now, size: hand.handSize });
    }
    for (const label of [...this.lastPalm.keys()]) {
      if (!seenLabels.has(label)) this.lastPalm.delete(label);
    }

    let targetArticulation;
    if (speeds.length) {
      const speedNorm = clamp(Math.max(...speeds) / 3.2, 0, 1);
      targetArticulation = clamp(1.0 - speedNorm, 0, 1);
    } else {
      targetArticulation = this.articulationSmooth;
    }

    this.brightnessSmooth = lerp(this.brightnessSmooth, targetBrightness, 0.15);
    this.articulationSmooth = lerp(this.articulationSmooth, targetArticulation, 0.15);
    this.synthActions.setBrightness(this.brightnessSmooth);
    this.synthActions.setArticulation(this.articulationSmooth);
  }

  update(hands) {
    this._updateExpression(hands);
    if (!hands.length) {
      this.state.gesture = "SCANNING";
      this.state.gestureDetail = "ELLER BEKLENIYOR";
      this.dualOpenSince = null;
      this.dualTriggered = false;
      this.previousGestures.clear();
      return;
    }

    const openHands = hands.filter((h) => h.gesture === "OPEN_HAND");
    if (openHands.length >= 2) {
      if (this.dualOpenSince === null) this.dualOpenSince = performance.now() / 1000;
      const held = performance.now() / 1000 - this.dualOpenSince;
      this.state.gesture = "DUAL OPEN";
      this.state.gestureDetail = `FULL ORCHESTRA ARMING ${held.toFixed(1)}s`;
      if (held > 0.55 && !this.dualTriggered) {
        this.synthActions.fullOrchestra();
        this.dualTriggered = true;
        this.state.gestureDetail = "TAM ORKESTRA AKTIF";
      }
      this._mapHandDistance(openHands[0], openHands[1]);
      return;
    }
    this.dualOpenSince = null;
    this.dualTriggered = false;

    const pinches = hands.filter((h) => h.gesture === "PINCH");
    if (pinches.length) {
      const hand = pinches[0];
      const amount = clamp((0.55 - hand.pinch) / 0.42, 0, 1);
      this.synthActions.setFxAmount(amount);
      this.state.gesture = `${hand.label} PINCH`;
      this.state.gestureDetail = `VOCAL SPACE ${String(Math.round(amount * 100)).padStart(2, "0")}%`;
      return;
    }

    const hand = hands.reduce((best, h) => (h.confidence > best.confidence ? h : best), hands[0]);
    const gesture = hand.gesture;
    const previousGesture = this.previousGestures.get(hand.label) || "NEUTRAL";
    const entered = gesture !== previousGesture;
    this.previousGestures.set(hand.label, gesture);
    this.state.gesture = `${hand.label} ${gesture}`;

    if (gesture === "OPEN_HAND") {
      const target = hand.label === "RIGHT" ? "STRINGS" : "PAD";
      if (entered) {
        if (!this.state.activeLayers.has(target)) this.synthActions.toggleLayer(target);
      }
      this.state.gestureDetail = `${target} KATMANI ACIK`;
    } else if (gesture === "PEACE") {
      let detail;
      if (entered) {
        const active = this.synthActions.toggleLayer("DRUMS");
        detail = active ? "DRUMS AKTIF" : "DRUMS KAPALI";
      } else {
        detail = "RITIM KOMUTU KILITLI";
      }
      this.state.gestureDetail = detail;
    } else if (gesture === "FIST") {
      if (entered) this.synthActions.muteExtras();
      this.state.gestureDetail = "EK KATMANLAR SUSTURULDU";
    } else if (gesture === "POINT") {
      let detail;
      if (entered) {
        const layer = this.layerOrder[this.layerCursor % this.layerOrder.length];
        this.layerCursor += 1;
        const active = this.synthActions.toggleLayer(layer);
        detail = `${layer} ${active ? "AKTIF" : "KAPALI"}`;
      } else {
        detail = "KATMAN SECIMI";
      }
      this.state.gestureDetail = detail;
    } else {
      this.state.gestureDetail = "HAREKET IZLENIYOR";
    }
  }

  _mapHandDistance(left, right) {
    const d = dist(left.palmCenter, right.palmCenter);
    const normalized = clamp((d / CAM_WIDTH - 0.12) / 0.52, 0, 1);
    this.synthActions.setDensityGain(lerp(0.24, 0.62, normalized));
  }
}
