// Harmoni Web - bootstrap. Milestone 3: audio-graph/worklet iskeleti eklendi.
// Gercek SynthEngine/VocalDSP zinciri henuz worklet icinde yok (Milestone
// 4-6); su an icin worklet yalnizca mikrofon->cikis gecici (passthrough) hat
// ve MessagePort protokolunu saglar. synthActions hem yerel state'i (HUD
// icin) hem de (varsa) worklet'e control mesajlarini gunceller.
import { applyTheme, getTheme } from "./constants/themes.js";
import { LAYER_KEYS, ALL_LAYERS, LAYER_KEY_BY_NAME, LAYER_LABEL_BY_NAME } from "./constants/layers.js";
import { buildTonalOptionGroups, resolveTonalSelection } from "./constants/tonal-systems.js";
import { GENRES, getGenre } from "./constants/genres.js";
import { SessionRecorder, downloadBlob, timestampName } from "./export/recorder.js";
import { loadConfig, saveConfig } from "./config.js";
import { createAppState } from "./app-state.js";
import { Camera } from "./camera/camera.js";
import { HandTracker } from "./camera/hand-tracker.js";
import { GestureController } from "./camera/gesture-controller.js";
import { createDemoHandSource, drawDemoBackground } from "./camera/demo-source.js";
import { drawHandSkeletons } from "./hud/hand-skeleton.js";
import { drawCanvasHud } from "./hud/canvas-hud.js?v=20260801-9";
import { AudioGraph } from "./audio/audio-graph.js";

const CAM_WIDTH = 1280;
const CAM_HEIGHT = 720;
const DEMO_MODE = new URLSearchParams(location.search).has("demo");

const config = loadConfig();
const state = createAppState();
state.themeIndex = config.theme_index;
state.simpleMode = config.simple_mode;
state.monitorEnabled = config.monitor_enabled;
state.tonalSelection = config.tonal_selection;
state.musicGain = config.piano_volume;
state.genreId = config.genre_id;

const els = {
  hudSimple: document.getElementById("hud-simple"),
  hudAdvanced: document.getElementById("hud-advanced"),
  guideOverlay: document.getElementById("guide-overlay"),
  startOverlay: document.getElementById("start-overlay"),
  startButton: document.getElementById("start-button"),
  advVersion: document.getElementById("adv-version"),
  guideGestures: document.getElementById("guide-gestures"),
  guideKeys: document.getElementById("guide-keys"),
  debugLog: document.getElementById("debug-log"),
  sceneCanvas: document.getElementById("scene-canvas"),
  simpleStatusDot: document.getElementById("simple-status-dot"),
  simpleStatusLabel: document.getElementById("simple-status-label"),
  simpleInstrumentRow: document.getElementById("simple-instrument-row"),
  simpleTonalBadge: document.getElementById("simple-tonal-badge"),
  cameraErrorOverlay: document.getElementById("camera-error-overlay"),
  cameraErrorTitle: document.getElementById("camera-error-title"),
  cameraErrorDetail: document.getElementById("camera-error-detail"),
  cameraRetryButton: document.getElementById("camera-retry-button"),
  advStatusLine: document.getElementById("adv-status-line"),
  advStatusSub: document.getElementById("adv-status-sub"),
  advGestureRow: document.getElementById("adv-gesture-row"),
  simpleWaveformCanvas: document.getElementById("simple-waveform-canvas"),
  optTheme: document.getElementById("opt-theme"),
  optTonal: document.getElementById("opt-tonal"),
  optModeToggle: document.getElementById("opt-mode-toggle"),
  optFullOrchestra: document.getElementById("opt-full-orchestra"),
  optMute: document.getElementById("opt-mute"),
  optGuide: document.getElementById("opt-guide"),
  optMonitorToggle: document.getElementById("opt-monitor-toggle"),
  optVolume: document.getElementById("opt-volume"),
  optVolumeValue: document.getElementById("opt-volume-value"),
  optBpm: document.getElementById("opt-bpm"),
  optBpmValue: document.getElementById("opt-bpm-value"),
  simpleChordName: document.getElementById("simple-chord-name"),
  simpleChordDetail: document.getElementById("simple-chord-detail"),
  optGenre: document.getElementById("opt-genre"),
  optGenreHint: document.getElementById("opt-genre-hint"),
  instrumentGrid: document.getElementById("instrument-grid"),
  optRecord: document.getElementById("opt-record"),
  recBadge: document.getElementById("rec-badge"),
  recTime: document.getElementById("rec-time"),
  panelToggle: document.getElementById("panel-toggle"),
  panelClose: document.getElementById("panel-close"),
  panelBackdrop: document.getElementById("panel-backdrop"),
  optionsPanel: document.getElementById("options-panel"),
  guideClose: document.getElementById("guide-close"),
};

els.sceneCanvas.width = CAM_WIDTH;
els.sceneCanvas.height = CAM_HEIGHT;
const ctx = els.sceneCanvas.getContext("2d");

function applyModeVisibility() {
  // Basit Mod'un bilgi kartlari canvas'a cizildigi icin (canvas-hud.js) burada
  // yalnizca Gelismis Mod'un ek teknik panelleri ac/kapa edilir.
  els.hudSimple.hidden = !state.simpleMode;
  els.hudAdvanced.hidden = state.simpleMode;
}

function applyThemeUI() {
  const theme = applyTheme(state.themeIndex);
  if (els.advVersion) els.advVersion.textContent = `v0.1 web | tema ${theme.name}`;
  return theme;
}

function persistConfig() {
  saveConfig({
    ...config,
    theme_index: state.themeIndex,
    simple_mode: state.simpleMode,
    monitor_enabled: state.monitorEnabled,
    tonal_selection: state.tonalSelection,
    piano_volume: state.musicGain,
    genre_id: state.genreId,
  });
}

function setMonitorEnabled(value) {
  state.monitorEnabled = value;
  audioGraph?.postControl({ monitorEnabled: value });
  if (els.optMonitorToggle) {
    els.optMonitorToggle.textContent = `Mikrofon monitoru: ${value ? "Acik" : "Kapali"}`;
  }
  persistConfig();
}

function toggleMode() {
  state.simpleMode = !state.simpleMode;
  applyModeVisibility();
  persistConfig();
  updateOptionsPanel();
}

function cycleTheme(index) {
  state.themeIndex = index;
  applyThemeUI();
  persistConfig();
  updateOptionsPanel();
}

function toggleGuide() {
  state.showGuide = !state.showGuide;
  els.guideOverlay.hidden = !state.showGuide;
  if (state.showGuide) setPanelOpen(false);
}

function populateTonalSelect() {
  if (!els.optTonal) return;
  els.optTonal.innerHTML = "";
  for (const group of buildTonalOptionGroups()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const opt of group.options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      optgroup.appendChild(option);
    }
    els.optTonal.appendChild(optgroup);
  }
  els.optTonal.value = state.tonalSelection;
}

// value ornekleri: "western:auto", "western:dorian", "makam:HICAZ"
// keepGenre: applyGenre icinden cagrildiginda secili turu sifirlamamak icin.
function setTonalSelection(value, { keepGenre = false } = {}) {
  if (!keepGenre && state.genreId) {
    state.genreId = "";
    if (els.optGenre) els.optGenre.value = "";
    if (els.optGenreHint) els.optGenreHint.textContent = "";
  }
  const resolved = resolveTonalSelection(value);
  state.tonalSelection = value;
  state.music.tonalSystem = resolved.tonalSystem;
  state.music.mode = resolved.mode || state.music.mode;
  state.music.makamName = resolved.makamName || state.music.makamName;
  state.music.chordNotes = resolved.chordNotes;
  state.music.makamDegrees = resolved.makamDegrees;
  state.music.chordRevision += 1;

  audioGraph?.postControl({
    tonalSystem: resolved.tonalSystem,
    chordNotes: resolved.chordNotes,
    makamDegrees: resolved.makamDegrees,
    chordRevision: state.music.chordRevision,
  });

  state.tonalDisplayName = resolved.displayName;
  if (els.optTonal) els.optTonal.value = value;
  if (els.simpleTonalBadge) {
    els.simpleTonalBadge.textContent =
      resolved.tonalSystem === "makam" ? resolved.displayName.toUpperCase() : "BATI";
  }
  if (els.simpleChordName) els.simpleChordName.textContent = resolved.displayName;
  persistConfig();
}

function populateGenreSelect() {
  if (!els.optGenre) return;
  els.optGenre.innerHTML = "";
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "— Serbest (kendim seçerim) —";
  els.optGenre.appendChild(custom);
  for (const g of GENRES) {
    const option = document.createElement("option");
    option.value = g.id;
    option.textContent = g.label;
    els.optGenre.appendChild(option);
  }
}

// Bir tur secildiginde dizi + kadro + tempo birlikte uygulanir (harmoni.py'deki
// AutoArranger fikrinin kullanici tarafindan dogrudan secilebilen hali).
function applyGenre(id) {
  const genre = getGenre(id);
  state.genreId = id || "";
  if (els.optGenre) els.optGenre.value = state.genreId;

  if (!genre) {
    if (els.optGenreHint) els.optGenreHint.textContent = "";
    persistConfig();
    return;
  }
  if (els.optGenreHint) els.optGenreHint.textContent = genre.hint;

  state.activeLayers = new Set(genre.layers);
  postLayers();
  renderInstrumentGrid();

  if (els.optBpm) els.optBpm.value = String(genre.bpm);
  setBpm(genre.bpm);
  setTonalSelection(genre.tonal, { keepGenre: true });
  persistConfig();
}

function renderInstrumentGrid() {
  if (!els.instrumentGrid) return;
  els.instrumentGrid.innerHTML = "";
  for (const [key, [layer, label]] of Object.entries(LAYER_KEYS)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "instrument-chip" + (state.activeLayers.has(layer) ? " active" : "");
    chip.title = `${label} (${key.toUpperCase()} tuşu)`;
    chip.innerHTML = `<span class="chip-dot"></span><span>${label}</span>`;
    chip.addEventListener("click", () => {
      synthActions.toggleLayer(layer);
      // Elle degistirildiginde artik hazir bir turde degiliz.
      state.genreId = "";
      if (els.optGenre) els.optGenre.value = "";
      if (els.optGenreHint) els.optGenreHint.textContent = "";
      renderInstrumentGrid();
      persistConfig();
    });
    els.instrumentGrid.appendChild(chip);
  }
}

function setMusicGain(value) {
  state.musicGain = value;
  audioGraph?.postControl({ musicGain: value });
  if (els.optVolumeValue) els.optVolumeValue.textContent = `${Math.round(value * 100)}%`;
  persistConfig();
}

function setBpm(value) {
  state.music.bpm = value;
  audioGraph?.postControl({ bpm: value });
  if (els.optBpmValue) els.optBpmValue.textContent = String(value);
  if (els.simpleChordDetail) els.simpleChordDetail.textContent = `${value} BPM`;
}

// --- Kayit (video + duyulan ses: orkestra + islenmis vokal) ---
let recorder = null;

async function toggleRecording() {
  if (!recorder) {
    recorder = new SessionRecorder(els.sceneCanvas, audioGraph?.recordStream || null);
  }
  if (recorder.recording) {
    const blob = await recorder.stop();
    els.optRecord.classList.remove("active");
    els.optRecord.textContent = "● Kayıt başlat";
    els.recBadge.hidden = true;
    if (blob && blob.size > 0) downloadBlob(blob, timestampName("harmoni", "webm"));
    return;
  }
  const ok = recorder.start(30);
  if (!ok) {
    els.optRecord.textContent = "Kayıt desteklenmiyor";
    console.warn("Kayit baslatilamadi:", recorder.lastError);
    setTimeout(() => (els.optRecord.textContent = "● Kayıt başlat"), 2500);
    return;
  }
  els.optRecord.classList.add("active");
  els.optRecord.textContent = "■ Kaydı durdur";
  els.recBadge.hidden = false;
}

function updateRecordingBadge() {
  if (!recorder || !recorder.recording) return;
  const total = Math.floor(recorder.elapsedSeconds);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  if (els.recTime) els.recTime.textContent = `${m}:${s}`;
}

function setPanelOpen(open) {
  els.optionsPanel?.classList.toggle("open", open);
  document.body.classList.toggle("menu-open", open);
  els.panelBackdrop?.classList.toggle("visible", open);
  if (els.panelToggle) {
    els.panelToggle.setAttribute("aria-expanded", String(open));
    els.panelToggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  }
}

function updateOptionsPanel() {
  if (els.optTheme) els.optTheme.value = String(state.themeIndex);
  if (els.optTonal) els.optTonal.value = state.tonalSelection;
  if (els.optModeToggle) els.optModeToggle.textContent = state.simpleMode ? "Gelişmiş görünüm" : "Basit görünüm";
  if (els.optMonitorToggle) {
    els.optMonitorToggle.textContent = `Mikrofon: ${state.monitorEnabled ? "Açık" : "Kapalı"}`;
  }
}

function wireOptionsPanel() {
  els.optTheme?.addEventListener("change", (e) => cycleTheme(Number(e.target.value)));
  els.optTonal?.addEventListener("change", (e) => setTonalSelection(e.target.value));
  els.optGenre?.addEventListener("change", (e) => applyGenre(e.target.value));
  els.optRecord?.addEventListener("click", () => toggleRecording());
  els.panelToggle?.addEventListener("click", () => setPanelOpen(!els.optionsPanel.classList.contains("open")));
  els.panelClose?.addEventListener("click", () => setPanelOpen(false));
  els.panelBackdrop?.addEventListener("click", () => setPanelOpen(false));
  els.guideClose?.addEventListener("click", () => toggleGuide());
  els.optVolume?.addEventListener("input", (e) => setMusicGain(Number(e.target.value) / 100));
  els.optBpm?.addEventListener("input", (e) => setBpm(Number(e.target.value)));
  els.optModeToggle?.addEventListener("click", () => {
    toggleMode();
    updateOptionsPanel();
  });
  els.optMonitorToggle?.addEventListener("click", () => setMonitorEnabled(!state.monitorEnabled));
  els.optFullOrchestra?.addEventListener("click", () => {
    synthActions.fullOrchestra();
    renderInstrumentGrid();
  });
  els.optMute?.addEventListener("click", () => {
    synthActions.muteExtras();
    renderInstrumentGrid();
  });
  els.optGuide?.addEventListener("click", () => toggleGuide());
}

function renderGuide() {
  const gestureLines = [
    "İki açık avuç · Tam orkestrayı etkinleştirir",
    "Başparmak ve işaret parmağı · Reverb miktarını ayarlar",
    "Tek açık avuç · Sağ el yaylıları, sol el pad katmanını yönetir",
    "Barış işareti · Ritim katmanını açar veya kapatır",
    "Yumruk · Ek katmanları kapatır ve yalnızca piyanoyu bırakır",
    "İşaret parmağı · Enstrüman katmanları arasında geçiş yapar",
  ];
  els.guideGestures.innerHTML = `<h3>Jestler</h3><ul>${gestureLines.map((l) => `<li>${l}</li>`).join("")}</ul>`;

  const layerLines = Object.entries(LAYER_KEYS).map(([key, [, label]]) => `${key.toUpperCase()} ${label}`);
  const otherKeys = [
    "Tab · Basit/gelişmiş görünüm", "T · Batı/makam sistemi", "D · Dizi rengi",
    "A · Otomatik düzenleme", "F · Tam orkestra", "X · Yalnız piyano",
    "R · Kayıt", "S · Ekran görüntüsü", "1–4 · Tema", "H · Arayüz",
    "E · Vokal efektleri", "V · Mikrofon monitörü", "Boşluk · Tap tempo", "[ ] · Tempo",
    "− + · Reverb", "9 0 · Piyano seviyesi", "M · Ayna", "/ · Kılavuz",
  ];
  els.guideKeys.innerHTML = `
    <h3>Enstruman katmanlari</h3>
    <ul>${layerLines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <h3>Diger tuslar</h3>
    <ul>${otherKeys.map((l) => `<li>${l}</li>`).join("")}</ul>
  `;
}

function handleKeydown(event) {
  if (event.key === "Tab") {
    event.preventDefault();
    toggleMode();
    return;
  }
  if (event.key === "/" || event.key === "?") {
    event.preventDefault();
    toggleGuide();
    return;
  }
  if (event.key === "Escape") {
    if (state.showGuide) toggleGuide();
    else if (els.optionsPanel?.classList.contains("open")) setPanelOpen(false);
    return;
  }
  if (["1", "2", "3", "4"].includes(event.key)) {
    cycleTheme(Number(event.key) - 1);
    return;
  }
  if (event.key === "t" || event.key === "T") {
    // Listedeki bir sonraki secenege gec (Bati modlari -> makamlar -> basa don).
    const flat = buildTonalOptionGroups().flatMap((g) => g.options.map((o) => o.value));
    const idx = flat.indexOf(state.tonalSelection);
    setTonalSelection(flat[(idx + 1) % flat.length]);
    return;
  }
  if (event.key === "f" || event.key === "F") {
    synthActions.fullOrchestra();
    return;
  }
  if (event.key === "x" || event.key === "X") {
    synthActions.muteExtras();
    return;
  }
  if (event.key === "v" || event.key === "V") {
    setMonitorEnabled(!state.monitorEnabled);
    return;
  }
  if (event.key === "r" || event.key === "R") {
    toggleRecording();
    return;
  }
  // Enstruman katmani kisayollari (P/B/N/W/C/Y/K/G/J/L/I/Z)
  const layerEntry = LAYER_KEYS[event.key.toLowerCase()];
  if (layerEntry) {
    synthActions.toggleLayer(layerEntry[0]);
    renderInstrumentGrid();
    return;
  }
}

// synthActions: GestureController'in tek ses-motoru arayuzu. Yerel state'i
// (HUD icin) her zaman gunceller; audioGraph mevcutsa (Milestone 3+) ayrica
// worklet'e control mesaji gonderir - boylece gercek SynthEngine (Milestone 4)
// worklet icine tasindiginda bu dosyada baska hicbir sey degismeyecek.
let audioGraph = null;

function postLayers() {
  audioGraph?.postControl({ activeLayers: [...state.activeLayers] });
}

function createSynthActions(state) {
  return {
    toggleLayer(name) {
      if (state.activeLayers.has(name)) {
        state.activeLayers.delete(name);
        postLayers();
        return false;
      }
      state.activeLayers.add(name);
      postLayers();
      return true;
    },
    fullOrchestra() {
      for (const layer of ALL_LAYERS) state.activeLayers.add(layer);
      postLayers();
    },
    muteExtras() {
      state.activeLayers.clear();
      state.activeLayers.add("PIANO");
      postLayers();
    },
    setBrightness(v) {
      state.brightness = v;
      audioGraph?.postControl({ brightness: v });
    },
    setArticulation(v) {
      state.articulation = v;
      audioGraph?.postControl({ articulation: v });
    },
    setFxAmount(v) {
      state.fxAmount = v;
      audioGraph?.postControl({ fxAmount: v });
    },
    setDensityGain(density, gain) {
      state.density = density;
      state.musicGain = gain;
      audioGraph?.postControl({ density, musicGain: gain });
    },
  };
}

const synthActions = createSynthActions(state);
const gestureController = new GestureController(state, synthActions);

// Canvas HUD'un ihtiyaci olan tum bilgiyi tek bir nesnede toplar.
function buildHudView() {
  const camOnline = state.cameraStatus === "ONLINE";
  const audioOnline = state.audioStatus === "ONLINE";
  const ordered = [...state.activeLayers].sort(
    (a, b) => (LAYER_KEY_BY_NAME[a] || "~").localeCompare(LAYER_KEY_BY_NAME[b] || "~")
  );
  const genre = getGenre(state.genreId);
  let recordTime = "0:00";
  if (recorder && recorder.recording) {
    const total = Math.floor(recorder.elapsedSeconds);
    recordTime = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  return {
    chordName: state.music.chordName && state.music.chordName !== "--"
      ? state.music.chordName
      : state.tonalDisplayName,
    bpm: state.music.bpm,
    tonalSystem: state.music.tonalSystem,
    tonalBadge: state.music.tonalSystem === "makam"
      ? (state.tonalDisplayName || "MAKAM").toUpperCase()
      : "BATI",
    noteName: state.pitch.voiced ? state.pitch.noteName : "Dinliyor…",
    frequency: state.pitch.frequency || 0,
    voiced: !!state.pitch.voiced,
    ready: camOnline && audioOnline,
    statusLabel: camOnline && audioOnline
      ? "Hazır"
      : !camOnline
      ? "Kamera bekleniyor"
      : "Ses bekleniyor",
    gesture: state.gesture,
    gestureDetail: state.gestureDetail,
    instruments: ordered.map((l) => LAYER_LABEL_BY_NAME[l] || l),
    genreLabel: genre ? genre.label : "Serbest mod",
    waveform: state.waveform,
    recording: !!(recorder && recorder.recording),
    recordTime,
  };
}

function updateHudLive() {
  const camOnline = state.cameraStatus === "ONLINE";
  const audioOnline = state.audioStatus === "ONLINE";
  const ready = camOnline && audioOnline;
  els.simpleStatusDot.classList.toggle("ready", ready);
  els.simpleStatusLabel.textContent = ready
    ? "Hazir"
    : !camOnline
    ? "Kamera bekleniyor"
    : "Ses bekleniyor";

  const orderedLayers = [...state.activeLayers].sort(
    (a, b) => (LAYER_KEY_BY_NAME[a] || "~").localeCompare(LAYER_KEY_BY_NAME[b] || "~")
  );
  const names = orderedLayers.map((l) => LAYER_LABEL_BY_NAME[l] || l);
  els.simpleInstrumentRow.textContent = names.length ? names.join(" | ") : "Sessiz";

  if (els.advStatusLine) {
    els.advStatusLine.textContent = ready ? "Dinliyor ve eslik ediyor" : "Baslatiliyor...";
  }
  if (els.advStatusSub) {
    els.advStatusSub.textContent = `kamera ${state.cameraFps.toFixed(0)}fps  el ${state.detectorFps.toFixed(0)}fps  gecikme ${state.latencyMs.toFixed(0)}ms`;
  }
  if (els.advGestureRow) {
    els.advGestureRow.textContent = `${state.gesture} - ${state.gestureDetail}`;
  }
}

function fitCover(srcW, srcH, dstW, dstH) {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let sw, sh, sx, sy;
  if (srcAspect > dstAspect) {
    sh = srcH;
    sw = srcH * dstAspect;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    sw = srcW;
    sh = srcW / dstAspect;
    sx = 0;
    sy = (srcH - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

let camera = null;
let handTracker = null;
let demoSource = null;
let frameCount = 0;
let fpsWindowStart = performance.now();

function drawRealFrame(video) {
  const { sx, sy, sw, sh } = fitCover(video.videoWidth, video.videoHeight, CAM_WIDTH, CAM_HEIGHT);
  ctx.save();
  if (config.mirror) {
    ctx.translate(CAM_WIDTH, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAM_WIDTH, CAM_HEIGHT);
  ctx.restore();
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  tick();
}

function tick() {
  const now = performance.now();
  const t = now / 1000;

  let packets = [];
  if (DEMO_MODE && demoSource) {
    drawDemoBackground(ctx, CAM_WIDTH, CAM_HEIGHT, t);
    packets = demoSource.next();
    state.cameraStatus = "ONLINE";
    state.cameraFps = 60;
  } else if (camera && camera.status === "ONLINE") {
    drawRealFrame(camera.video);
    state.cameraStatus = "ONLINE";
    if (handTracker) {
      packets = handTracker.process(els.sceneCanvas, now, CAM_WIDTH, CAM_HEIGHT);
      state.detectorFps = handTracker.detectorFps;
    }
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CAM_WIDTH, CAM_HEIGHT);
    state.cameraStatus = "OFFLINE";
  }

  gestureController.update(packets);
  const theme = getTheme(state.themeIndex);
  drawHandSkeletons(ctx, packets, theme);
  updateRecordingBadge();
  // Bilgi panelleri canvas'a cizilir -> hem ekranda hem de kayitta gorunur.
  drawCanvasHud(ctx, buildHudView(), theme, CAM_WIDTH, CAM_HEIGHT);
  updateHudLive();

  frameCount += 1;
  if (now - fpsWindowStart > 1000) {
    fpsWindowStart = now;
    frameCount = 0;
  }
}

function showCameraError(error) {
  els.cameraErrorTitle.textContent = error.title;
  els.cameraErrorDetail.textContent = error.detail;
  els.cameraErrorOverlay.hidden = false;
}

function hideCameraError() {
  els.cameraErrorOverlay.hidden = true;
}

async function tryStartCamera() {
  els.cameraRetryButton.disabled = true;
  els.cameraRetryButton.textContent = "Deneniyor...";
  camera = new Camera();
  const ok = await camera.start();
  // Kamera goruntusu HEMEN gorunur olmali - el takibi modelinin (MediaPipe,
  // CDN'den indirilir) veya mikrofon izninin bitmesini BEKLEMEZ. Bu ikisi
  // yavas/engelli bir agda uzun surebilir; onceden bunlarin bitmesini
  // beklemek kameranin acilmis olmasina ragmen ekranin bos kalmasina neden
  // oluyordu (bkz. renderLoop, tick() zaten handTracker hazir degilse
  // guvenli sekilde bos el listesiyle devam eder).
  state.cameraStatus = camera.status;
  if (ok) {
    hideCameraError();
    if (!handTracker) {
      handTracker = new HandTracker({ processEvery: 2 });
      handTracker.init(); // kasitli olarak await edilmiyor (arka planda yuklenir)
    }
  } else {
    showCameraError(camera.error);
  }
  els.cameraRetryButton.disabled = false;
  els.cameraRetryButton.textContent = "Tekrar dene";
  return ok;
}

function startExperience() {
  els.startOverlay.hidden = true;
  // Baslangic ekrani (z-index 30) kapanmadan panel/kayit kontrolleri
  // tiklanamaz durumdaydi; artik yalnizca basladiktan sonra gorunurler.
  document.body.classList.add("started");
  if (DEMO_MODE) {
    demoSource = createDemoHandSource(CAM_WIDTH, CAM_HEIGHT);
  } else {
    tryStartCamera(); // kasitli olarak await edilmiyor - renderLoop hemen baslar
  }
  audioGraph = new AudioGraph(state);
  audioGraph.start({ lowLatency: config.performance !== "quality" }).then(() => {
    // Worklet yeni olustu; kullanicinin baslangictan once yaptigi tum
    // secimleri (tonalite, ses seviyesi, tempo, monitor) ona aktar.
    audioGraph.postControl({
      monitorEnabled: state.monitorEnabled,
      musicGain: state.musicGain,
      bpm: state.music.bpm,
      tonalSystem: state.music.tonalSystem,
      chordNotes: state.music.chordNotes,
      makamDegrees: state.music.makamDegrees,
      chordRevision: state.music.chordRevision,
    });
  });
  renderLoop();
}

function bootstrap() {
  applyThemeUI();
  applyModeVisibility();
  renderGuide();
  populateTonalSelect();
  populateGenreSelect();
  renderInstrumentGrid();
  wireOptionsPanel();
  updateOptionsPanel();
  if (els.optVolume) els.optVolume.value = String(Math.round(state.musicGain * 100));
  setMusicGain(state.musicGain);
  // Kayitli bir tur varsa onu uygula (dizi + kadro + tempoyu birlikte kurar);
  // yoksa yalnizca kayitli diziye don.
  if (state.genreId && getGenre(state.genreId)) {
    applyGenre(state.genreId);
  } else {
    setTonalSelection(state.tonalSelection);
    setBpm(state.music.bpm);
  }
  window.addEventListener("keydown", handleKeydown);
  els.startButton.addEventListener("click", () => {
    startExperience();
  });
  els.cameraRetryButton.addEventListener("click", () => {
    tryStartCamera();
  });

  if (DEMO_MODE) {
    els.startButton.textContent = "Demo modunu baslat";
  }
}

bootstrap();

if (new URLSearchParams(location.search).has("debug")) {
  els.debugLog.hidden = false;
  import("./debug/self-test.js").then((mod) => mod.runSelfTest(els.debugLog));
}

window.__harmoni = {
  state, config, getTheme, tick, gestureController, synthActions,
  get audioGraph() { return audioGraph; },
};
