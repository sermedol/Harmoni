// Harmoni Web - v20260801-v1. El hareketleriyle canlı orkestra eşliği.
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
import { drawCanvasHud } from "./hud/canvas-hud.js";
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
  guideClose: document.getElementById("guide-overlay")?.querySelector(".guide-close"),
  startOverlay: document.getElementById("start-overlay"),
  typewriterContainer: document.getElementById("typewriter-container"),
  typewriterText: document.getElementById("typewriter-text"),
  startPanelContent: document.getElementById("start-panel-content"),
  startButton: document.getElementById("start-button"),
  cameraSkipButton: document.getElementById("camera-skip-button"),
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
};

els.sceneCanvas.width = CAM_WIDTH;
els.sceneCanvas.height = CAM_HEIGHT;
const ctx = els.sceneCanvas.getContext("2d");

function applyModeVisibility() {
  // Basit Mod'un bilgi kartlari canvas'a cizildigi icin (canvas-hud.js) burada
  // yalnizca Gelişmiş Mod'un ek teknik panelleri ac/kapa edilir.
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
    els.optMonitorToggle.textContent = `Mikrofon monitoru: ${value ? "Açık" : "Kapalı"}`;
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
    console.warn("Kayit başlatılamadı:", recorder.lastError);
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
  els.guideClose?.addEventListener("click", () => toggleGuide());
}

function renderGuide() {
  const gestureLines = [
    "İki elde AÇIK AVUÇ (0.55sn) → tam orkestra",
    "PINCH (baş parmak+işaret) → vokal reverb/eco miktarı",
    "AÇIK AVUÇ (tek el) → sağ: Yaylılar, sol: Pad",
    "BARIŞ İŞARETİ (işaret+orta) → Ritim (bateri)",
    "YUMRUK → ekstra katmanları kapat (yalnız piyano)",
    "İŞARET PARMAĞI → katmanlar arasında geçiş",
  ];
  els.guideGestures.innerHTML = `<h3>Jestler</h3><ul>${gestureLines.map((l) => `<li>${l}</li>`).join("")}</ul>`;

  const layerLines = Object.entries(LAYER_KEYS).map(([key, [, label]]) => `${key.toUpperCase()} ${label}`);
  const otherKeys = [
    "Tab basit/gelişmiş görünüm", "T tonalite (Batı/Makam)", "D dizi rengi",
    "A oto-düzenleme", "F tam orkestra", "X sadece piyano",
    "R kayıt", "S ekran görüntüsü", "1-4 tema", "H arayüz",
    "E vokal fx", "V monitoring", "Space tap tempo", "[ ] bpm",
    "- + reverb", "9 0 piyano seviyesi", "M ayna", "/ kılavuz",
  ];
  els.guideKeys.innerHTML = `
    <h3>Enstruman katmanlari</h3>
    <ul>${layerLines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <h3>Diger tuslar</h3>
    <ul>${otherKeys.map((l) => `<li>${l}</li>`).join("")}</ul>
  `;
}

let introSkipped = false;
let introAbortController = null;

async function runTypewriterIntro() {
  if (introSkipped) return;
  introAbortController = new AbortController();
  const signal = introAbortController.signal;

  const sequences = [
    { text: "Selam,", duration: 600 },
    { erase: true, duration: 400 },
    { text: "kafamın içine", duration: 900 },
    { erase: true, duration: 400 },
    { text: "hoş geldiniz :)", duration: 800 },
  ];

  for (const seq of sequences) {
    if (signal.aborted || introSkipped) break;
    if (seq.erase) {
      els.typewriterText.textContent = "";
    } else {
      els.typewriterText.textContent = seq.text;
    }
    await new Promise((r) => setTimeout(r, seq.duration));
  }

  if (!signal.aborted && !introSkipped) {
    els.typewriterContainer.hidden = true;
    els.startPanelContent.hidden = false;
  }
}

function skipIntro() {
  if (introSkipped) return;
  introSkipped = true;
  if (introAbortController) introAbortController.abort();
  els.typewriterContainer.hidden = true;
  els.startPanelContent.hidden = false;
  els.startPanelContent.style.opacity = "1";
  els.startPanelContent.style.filter = "blur(0)";
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
  if (event.key === "Escape" && state.showGuide) {
    toggleGuide();
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
    noteName: state.pitch.voiced ? state.pitch.noteName : "--",
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
    ? "Hazır"
    : !camOnline
    ? "Kamera bekleniyor"
    : "Ses bekleniyor";

  const orderedLayers = [...state.activeLayers].sort(
    (a, b) => (LAYER_KEY_BY_NAME[a] || "~").localeCompare(LAYER_KEY_BY_NAME[b] || "~")
  );
  const names = orderedLayers.map((l) => LAYER_LABEL_BY_NAME[l] || l);
  els.simpleInstrumentRow.textContent = names.length ? names.join(" | ") : "Sessiz";

  if (els.advStatusLine) {
    els.advStatusLine.textContent = ready ? "Dinliyor ve eşlik ediyor" : "Başlatılıyor...";
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

function skipCamera() {
  hideCameraError();
  state.cameraStatus = "SKIPPED";
  startExperience();
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
  if (state.genreId && getGenre(state.genreId)) {
    applyGenre(state.genreId);
  } else {
    setTonalSelection(state.tonalSelection);
    setBpm(state.music.bpm);
  }
  window.addEventListener("keydown", handleKeydown);

  // Typewriter intro: skip with Enter, Space, Escape, or click
  runTypewriterIntro();
  els.typewriterContainer.addEventListener("click", skipIntro);
  document.addEventListener("keydown", (e) => {
    if (["Enter", " ", "Escape"].includes(e.key)) skipIntro();
  });

  els.startButton.addEventListener("click", () => {
    startExperience();
  });
  els.cameraRetryButton.addEventListener("click", () => {
    tryStartCamera();
  });
  els.cameraSkipButton?.addEventListener("click", () => {
    skipCamera();
  });

  if (DEMO_MODE) {
    els.startButton.textContent = "Demo modunu başlat";
  }
}

bootstrap();

const buildMeta = document.querySelector('meta[name="harmoni-build"]');
const buildVersion = buildMeta?.getAttribute('content') || 'unknown';
console.log(`Harmoni v${buildVersion} — El hareketleriyle canlı orkestra eşliği`);

if (new URLSearchParams(location.search).has("debug")) {
  els.debugLog.hidden = false;
  import("./debug/self-test.js").then((mod) => mod.runSelfTest(els.debugLog));
}

window.__harmoni = {
  state, config, getTheme, tick, gestureController, synthActions,
  get audioGraph() { return audioGraph; },
};
