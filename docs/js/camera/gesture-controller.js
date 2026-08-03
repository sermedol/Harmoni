// harmoni.py GestureController - birebir port. Ses motoruna dogrudan
// baglanmiyor; `synthActions` arayuzu (toggleLayer/fullOrchestra/muteExtras/
// setBrightness/setArticulation/setFxAmount/setDensityGain) araciligiyla
// calisir, boylece gercek ses motoru (worklet) baglanana kadar (Milestone
// 3-4) main.js bir stub gecebilir; bu dosyanin kendisi degismez.
import { clamp, lerp } from "../constants/music-utils.js";
import { LAYER_LABEL_BY_NAME } from "../constants/layers.js";

// Sahnede gosterilen etiketin titrememesi icin SUREKLI DURUM ile GERCEK
// OLAY ayrilir:
//   state.gestureDetail  her karede degisebilen surekli durum metni
//                        (gelismis gorunum ve ekran okuyucu icin)
//   state.gestureEvent   yalnizca gercekten bir sey OLDUGUNDA yazilir
//                        (katman acildi/kapandi, tam orkestra vb.)
// Onceki surumde sahne etiketi gestureDetail'e bakiyordu; icinde canli
// sayac ("... 0.5s") ve yuzde ("%84") oldugu icin metin her karede
// degisip titriyordu.
function emit(state, id, text) {
  if (state.gestureEvent?.id === id) return;
  state.gestureEvent = { id, text, at: performance.now() };
}

const layerName = (layer) => LAYER_LABEL_BY_NAME[layer] || layer;

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
      this.state.gestureDetail = "Eller bekleniyor";
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
      // Canli sayac YALNIZCA surekli durum metninde; sahne etiketi bunu
      // gostermez, yoksa saniyede onlarca kez degisir.
      this.state.gestureDetail = `Tam orkestra hazırlanıyor ${held.toFixed(1)}s`;
      if (held > 0.55 && !this.dualTriggered) {
        this.synthActions.fullOrchestra();
        this.dualTriggered = true;
        this.state.gestureDetail = "Tam orkestra açık";
        emit(this.state, "full-orchestra", "Tam orkestra");
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
      const percent = Math.round(amount * 100);
      this.state.gestureDetail = `Reverb %${percent}`;
      // Pinch surekli bir kontrol. Etiket her yuzdede degisirse titrer;
      // yalnizca %10'luk basamaklarda yenilenir.
      emit(this.state, `pinch-${Math.round(percent / 10)}`, `Reverb %${Math.round(percent / 10) * 10}`);
      return;
    }

    const hand = hands.reduce((best, h) => (h.confidence > best.confidence ? h : best), hands[0]);
    const gesture = hand.gesture;
    const previousGesture = this.previousGestures.get(hand.label) || "NEUTRAL";
    const entered = gesture !== previousGesture;
    this.previousGestures.set(hand.label, gesture);
    this.state.gesture = `${hand.label} ${gesture}`;

    // NOT: asagida etiket (emit) YALNIZCA `entered` oldugunda, yani jest
    // yeni girildiginde yazilir. Jest basili tutuldugu surece tekrar
    // yazilmaz; aksi halde el havada durdugu surece etiket yanip soner.
    if (gesture === "OPEN_HAND") {
      const target = hand.label === "RIGHT" ? "STRINGS" : "PAD";
      if (entered && !this.state.activeLayers.has(target)) {
        this.synthActions.toggleLayer(target);
        emit(this.state, `open-${target}`, `${layerName(target)} açık`);
      }
      this.state.gestureDetail = `${layerName(target)} açık`;
    } else if (gesture === "PEACE") {
      if (entered) {
        const active = this.synthActions.toggleLayer("DRUMS");
        const text = active ? "Ritim açık" : "Ritim kapalı";
        this.state.gestureDetail = text;
        emit(this.state, `drums-${active}`, text);
      } else {
        this.state.gestureDetail = "Ritim komutu kilitli";
      }
    } else if (gesture === "FIST") {
      if (entered) {
        this.synthActions.muteExtras();
        emit(this.state, "only-piano", "Yalnız piyano");
      }
      this.state.gestureDetail = "Yalnız piyano";
    } else if (gesture === "POINT") {
      if (entered) {
        const layer = this.layerOrder[this.layerCursor % this.layerOrder.length];
        this.layerCursor += 1;
        const active = this.synthActions.toggleLayer(layer);
        const text = `${layerName(layer)} ${active ? "açık" : "kapalı"}`;
        this.state.gestureDetail = text;
        emit(this.state, `layer-${layer}-${active}`, text);
      } else {
        this.state.gestureDetail = "Katman seçimi";
      }
    } else {
      this.state.gestureDetail = "Hareket izleniyor";
    }
  }

  _mapHandDistance(left, right) {
    const d = dist(left.palmCenter, right.palmCenter);
    const referenceSize = Math.max(24, (left.handSize + right.handSize) / 2);
    const normalized = clamp((d / referenceSize - 1.4) / 5.6, 0, 1);
    this.synthActions.setDensityGain(lerp(0.24, 0.62, normalized));
  }
}
