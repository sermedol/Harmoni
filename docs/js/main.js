// Harmoni Web - bootstrap. Milestone 3: audio-graph/worklet iskeleti eklendi.
// Gercek SynthEngine/VocalDSP zinciri henuz worklet icinde yok (Milestone
// 4-6); su an icin worklet yalnizca mikrofon->cikis gecici (passthrough) hat
// ve MessagePort protokolunu saglar. synthActions hem yerel state'i (HUD
// icin) hem de (varsa) worklet'e control mesajlarini gunceller.
import { applyTheme, getTheme } from "./constants/themes.js?v=20260802-04";
import { LAYER_KEYS, ALL_LAYERS, LAYER_KEY_BY_NAME, LAYER_LABEL_BY_NAME } from "./constants/layers.js?v=20260802-04";
import { buildTonalOptionGroups, resolveTonalSelection } from "./constants/tonal-systems.js?v=20260802-04";
import { GENRES, getGenre } from "./constants/genres.js?v=20260802-04";
import { SessionRecorder, downloadBlob, timestampName } from "./export/recorder.js?v=20260802-04";
import { loadConfig, saveConfig } from "./config.js?v=20260802-04";
import { createAppState } from "./app-state.js?v=20260802-04";
import { Camera } from "./camera/camera.js?v=20260802-04";
import { fitContain, sceneSizeForViewport, shouldMirror } from "./camera/camera-math.js?v=20260802-04";
import { HandTracker } from "./camera/hand-tracker.js?v=20260802-04";
import { GestureController } from "./camera/gesture-controller.js?v=20260802-04";
import { createDemoHandSource, drawDemoBackground } from "./camera/demo-source.js?v=20260802-04";
import { drawHandSkeletons } from "./hud/hand-skeleton.js?v=20260802-04";
import { drawCanvasHud } from "./hud/canvas-hud.js?v=20260802-04";
import { AudioGraph } from "./audio/audio-graph.js?v=20260802-04";
import { PhraseDetector } from "./harmony/phrase-detector.js?v=20260802-04";
import { WesternHarmonyEngine } from "./harmony/western-harmony-engine.js?v=20260802-04";

const CAM_WIDTH = 1280;
const CAM_HEIGHT = 720;
let sceneWidth = CAM_WIDTH;
let sceneHeight = CAM_HEIGHT;
const DEMO_MODE = new URLSearchParams(location.search).has("demo");

const config = loadConfig();
// Web arayuzunun tek ve kalici gorunumu: Bordo.
// Eski oturumlardan kalmis tema tercihlerini de burada gecersiz kilariz.
config.theme_index = 0;
// Kamera seçimi kullanıcıdan gizlidir: her açılışta tarayıcının/işletim
// sisteminin varsayılan kamerası kullanılır.
config.camera_device_id = "";
config.camera_facing_mode = "";
const state = createAppState();
state.themeIndex = 0;
state.simpleMode = true;
// Eski sürümden kalan açık tercih akustik geri besleme yaratmasın. Nota ve
// frekans analizi monitor kapalıyken de kesintisiz çalışır.
config.monitor_enabled = false;
state.monitorEnabled = false;
state.tonalSelection = config.tonal_selection;
state.musicGain = config.piano_volume;
state.genreId = config.genre_id;
saveConfig(config);

const els = {
  hudSimple: document.getElementById("hud-simple"),
  hudAdvanced: document.getElementById("hud-advanced"),
  guideOverlay: document.getElementById("guide-overlay"),
  startOverlay: document.getElementById("start-overlay"),
  startButton: document.getElementById("start-button"),
  startPanel: document.getElementById("start-panel"),
  introSequence: document.getElementById("intro-sequence"),
  introText: document.getElementById("intro-text"),
  introAnnouncer: document.getElementById("intro-announcer"),
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
  cameraStatusLive: document.getElementById("camera-status-live"),
  cameraHint: document.getElementById("camera-hint"),
  cameraActive: document.getElementById("camera-active"),
  handStatus: document.getElementById("hand-status"),
  handStatusText: document.getElementById("hand-status-text"),
  optCamera: document.getElementById("opt-camera"),
  cameraSwitch: document.getElementById("camera-switch"),
  cameraRestart: document.getElementById("camera-restart"),
  optCameraMirror: document.getElementById("opt-camera-mirror"),
  optCameraPerformance: document.getElementById("opt-camera-performance"),
  optCameraDiagnostics: document.getElementById("opt-camera-diagnostics"),
  cameraDiagnostics: document.getElementById("camera-diagnostics"),
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
  optInputProfile: document.getElementById("opt-input-profile"),
  startInputProfile: document.getElementById("start-input-profile"),
  capabilityStatus: document.getElementById("capability-status"),
  recordResultOverlay: document.getElementById("record-result-overlay"),
  recordPreview: document.getElementById("record-preview"),
  recordMeta: document.getElementById("record-meta"),
  recordDownload: document.getElementById("record-download"),
  recordNew: document.getElementById("record-new"),
  recordDelete: document.getElementById("record-delete"),
  recordResultClose: document.getElementById("record-result-close"),
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
  optVocalStudio: document.getElementById("opt-vocal-studio"),
  vocalOverlay: document.getElementById("vocal-studio-overlay"),
  vocalClose: document.getElementById("vocal-close"),
  vocalMic: document.getElementById("vocal-mic"),
  vocalMicLabel: document.getElementById("vocal-mic-label"),
  vocalTimer: document.getElementById("vocal-timer"),
  vocalMeter: document.querySelector(".vocal-meter"),
  vocalMeterFill: document.getElementById("vocal-meter-fill"),
  vocalMeterPeak: document.getElementById("vocal-meter-peak"),
  vocalStatus: document.getElementById("vocal-status"),
  vocalRecord: document.getElementById("vocal-record"),
  vocalPlay: document.getElementById("vocal-play"),
  vocalDownload: document.getElementById("vocal-download"),
  vocalDiscard: document.getElementById("vocal-discard"),
  vocalPlayback: document.getElementById("vocal-playback"),
  vocalGain: document.getElementById("vocal-gain"),
  vocalGainValue: document.getElementById("vocal-gain-value"),
  vocalReverb: document.getElementById("vocal-reverb"),
  vocalReverbValue: document.getElementById("vocal-reverb-value"),
  vocalEcho: document.getElementById("vocal-echo"),
  vocalEchoValue: document.getElementById("vocal-echo-value"),
  vocalSource: document.getElementById("vocal-source"),
  vocalFxToggle: document.getElementById("vocal-fx-toggle"),
  vocalMonitorToggle: document.getElementById("vocal-monitor-toggle"),
};

const ctx = els.sceneCanvas.getContext("2d");
const inferenceCanvas = document.createElement("canvas");
inferenceCanvas.width = 640;
inferenceCanvas.height = 360;
const inferenceCtx = inferenceCanvas.getContext("2d", { alpha: false });
const lightCanvas = document.createElement("canvas");
lightCanvas.width = 32;
lightCanvas.height = 18;
const lightCtx = lightCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
let sceneScale = 1;

// canvas-hud.js sabit mantiksal koordinatlara ciziyor: ust bloklar y=111'de
// biter, alt konsol deckH+safe kadar yer kaplar. Sahne CSS'te olceklendigi
// icin bu mantiksal degerlerin CSS piksel karsiligini burada hesaplayip
// degisken olarak yayinliyoruz; layout.css DOM kromunu bu degiskenlerle
// konumlandirarak canvas icerigiyle cakismayi onluyor.
function publishHudSafeArea(portrait, logicalWidth) {
  const stage = els.sceneCanvas.parentElement;
  if (!stage) return;
  const width = stage.getBoundingClientRect().width;
  if (!width || !logicalWidth) return;
  const scale = width / logicalWidth;
  const bottomReserve = portrait ? 154 + 16 : 112 + 22;
  stage.style.setProperty("--hud-top", `${Math.round(130 * scale)}px`);
  stage.style.setProperty("--hud-bottom", `${Math.round((bottomReserve + 14) * scale)}px`);
}

function resizeSceneCanvas() {
  const size = sceneSizeForViewport(window.innerWidth, window.innerHeight);
  const portrait = size.portrait;
  const nextWidth = size.width;
  const nextHeight = size.height;
  const nextScale = portrait ? 1 : Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  // Sahne CSS genisligi, mantiksal boyut sabit kalsa bile degisebilir
  // (ornegin 1280 -> 1600 masaustu); guvenli alan her cagrida yayinlanir.
  publishHudSafeArea(portrait, nextWidth);
  if (sceneScale === nextScale && sceneWidth === nextWidth && sceneHeight === nextHeight && els.sceneCanvas.width === Math.round(nextWidth * nextScale)) return;
  sceneWidth = nextWidth;
  sceneHeight = nextHeight;
  sceneScale = nextScale;
  els.sceneCanvas.width = Math.round(sceneWidth * sceneScale);
  els.sceneCanvas.height = Math.round(sceneHeight * sceneScale);
  ctx.setTransform(sceneScale, 0, 0, sceneScale, 0, 0);
  publishHudSafeArea(portrait, nextWidth);
  if (DEMO_MODE && document.body.classList.contains("started")) demoSource = createDemoHandSource(sceneWidth, sceneHeight);
}
resizeSceneCanvas();
// Ilk cagri duzen olusmadan once gerceklestiyse sahne genisligi 0 olabilir.
requestAnimationFrame(() => resizeSceneCanvas());

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
    input_profile: config.input_profile,
    genre_id: state.genreId,
  });
}

function setMonitorEnabled(value) {
  state.monitorEnabled = value;
  audioGraph?.postControl({ monitorEnabled: value });
  if (els.optMonitorToggle) {
    els.optMonitorToggle.textContent = `Vokal duyumu: ${value ? "Açık" : "Kapalı"}`;
  }
  // Vokal studyodaki "Canli dinleme" ayni ayari gosterir; iki yuzey de
  // ayni durumu yansitmali.
  syncVocalMonitorButton();
  persistConfig();
}

function toggleMode() {
  state.simpleMode = !state.simpleMode;
  applyModeVisibility();
  persistConfig();
  updateOptionsPanel();
}

function cycleTheme() {
  state.themeIndex = 0;
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
let recordResult = null;
let recordResultUrl = "";

async function toggleRecording() {
  if (!recorder) {
    recorder = new SessionRecorder(els.sceneCanvas, audioGraph?.recordStream || null);
  }
  if (recorder.recording) {
    const blob = await recorder.stop();
    els.optRecord.classList.remove("active");
    els.optRecord.textContent = "● Kayıt başlat";
    els.recBadge.hidden = true;
    if (blob && blob.size > 0) showRecordResult(blob);
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
  const wasOpen = els.optionsPanel?.classList.contains("open");
  els.optionsPanel?.classList.toggle("open", open);
  if (els.optionsPanel) {
    els.optionsPanel.inert = !open;
    els.optionsPanel.setAttribute("aria-hidden", String(!open));
  }
  document.body.classList.toggle("menu-open", open);
  els.panelBackdrop?.classList.toggle("visible", open);
  if (els.panelToggle) {
    els.panelToggle.setAttribute("aria-expanded", String(open));
    els.panelToggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  }
  if (els.optInputProfile) els.optInputProfile.value = config.input_profile;
  if (els.startInputProfile) els.startInputProfile.value = config.input_profile;
  if (open) requestAnimationFrame(() => els.panelClose?.focus());
  else if (wasOpen) els.panelToggle?.focus();
}

function clearRecordResult() {
  if (recordResultUrl) URL.revokeObjectURL(recordResultUrl);
  recordResultUrl = "";
  recordResult = null;
  if (els.recordPreview) { els.recordPreview.pause(); els.recordPreview.removeAttribute("src"); els.recordPreview.load(); }
  if (els.recordResultOverlay) els.recordResultOverlay.hidden = true;
}

function showRecordResult(blob) {
  clearRecordResult();
  recordResult = blob;
  recordResultUrl = URL.createObjectURL(blob);
  els.recordPreview.src = recordResultUrl;
  els.recordMeta.textContent = `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${blob.type || "WebM"}`;
  els.recordResultOverlay.hidden = false;
  els.recordDownload.focus();
}

function updateOptionsPanel() {
  if (els.optTheme) els.optTheme.value = String(state.themeIndex);
  if (els.optTonal) els.optTonal.value = state.tonalSelection;
  if (els.optModeToggle) els.optModeToggle.textContent = state.simpleMode ? "Gelişmiş görünüm" : "Basit görünüm";
  if (els.optMonitorToggle) {
    els.optMonitorToggle.textContent = `Vokal duyumu: ${state.monitorEnabled ? "Açık" : "Kapalı"}`;
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
  const setInputProfile = (value) => {
    config.input_profile = value === "music" ? "music" : "speaker";
    if (els.optInputProfile) els.optInputProfile.value = config.input_profile;
    if (els.startInputProfile) els.startInputProfile.value = config.input_profile;
    persistConfig();
  };
  els.optInputProfile?.addEventListener("change", (event) => setInputProfile(event.target.value));
  els.startInputProfile?.addEventListener("change", (event) => setInputProfile(event.target.value));
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
    "T · Makam/dizi seçenekleri arasında geçiş", "F · Tam orkestra", "X · Yalnız piyano",
    "R · Kayıt", "V · Vokal duyumu", "/ · Kılavuz", "Esc · Açık paneli kapat",
  ];
  els.guideKeys.innerHTML = `
    <h3>Enstruman katmanlari</h3>
    <ul>${layerLines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <h3>Diger tuslar</h3>
    <ul>${otherKeys.map((l) => `<li>${l}</li>`).join("")}</ul>
  `;
}

function handleKeydown(event) {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (els.startPanel?.classList.contains("intro-pending") && ["Enter", " ", "Escape"].includes(event.key)) {
    event.preventDefault();
    introSkipped = true;
    revealStartPanel();
    return;
  }
  if (typing) return;
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
    setDensityGain(density) {
      state.density = density;
      audioGraph?.postControl({ density });
    },
  };
}

const synthActions = createSynthActions(state);
const gestureController = new GestureController(state, synthActions);
const phraseDetector = new PhraseDetector();
const westernHarmony = new WesternHarmonyEngine();
let lastPitchTimestamp = -1;

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
    inputLevel: Math.min(1, Math.max(0, (state.pitch.rms || 0) / 0.08)),
    pitchConfidence: Math.min(1, Math.max(0, state.pitch.confidence || 0)),
    pitchCents: state.pitch.cents || 0,
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
  if (!destroyed && (state.lifecycle === "STARTING_MEDIA" || state.lifecycle === "PARTIAL_READY")) {
    state.lifecycle = ready ? "READY" : "PARTIAL_READY";
  }
  if (els.capabilityStatus) {
    const c = state.capabilities;
    els.capabilityStatus.textContent = `Kamera: ${c.camera} · Mikrofon: ${c.microphone} · El modeli: ${c.handModel} · Perde: ${c.pitch}`;
  }
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

let camera = null;
let handTracker = null;
let demoSource = null;
let frameCount = 0;
let fpsWindowStart = performance.now();
let renderLoopStarted = false;
let renderFrameId = 0;
let startPromise = null;
let destroyed = false;
let lastRenderAt = 0;
let cameraStartPromise = null;
let activeMirror = true;
let lastVideoFrameAt = 0;
let displayFrameCounter = 0;
let displayFpsStarted = performance.now();
let noHandsSince = performance.now();
let lastHintAt = 0;
let brightnessSampleAt = 0;
let averageBrightness = 128;
let analysisProfile = "balanced";
let slowAnalysisCount = 0;
let fastAnalysisCount = 0;

function setAnalysisProfile(profile) {
  analysisProfile = profile;
  const profiles = {
    quality: [768, 432, 1], balanced: [640, 360, 1], performance: [480, 270, 2],
  };
  let [width, height, every] = profiles[profile] || profiles.balanced;
  if (sceneHeight > sceneWidth) {
    width = height;
    height = Math.round(width * sceneHeight / sceneWidth);
  }
  if (inferenceCanvas.width !== width) {
    inferenceCanvas.width = width;
    inferenceCanvas.height = height;
  }
  if (handTracker) handTracker.processEvery = every;
  state.cameraPerformance = profile;
}

function updateAdaptiveProfile(processMs) {
  const requested = config.camera_performance || "auto";
  if (requested !== "auto") return setAnalysisProfile(requested);
  if (processMs > 42) { slowAnalysisCount += 1; fastAnalysisCount = 0; }
  else if (processMs < 25) { fastAnalysisCount += 1; slowAnalysisCount = 0; }
  else { slowAnalysisCount = Math.max(0, slowAnalysisCount - 1); fastAnalysisCount = 0; }
  if (slowAnalysisCount > 18 && analysisProfile !== "performance") {
    setAnalysisProfile(analysisProfile === "quality" ? "balanced" : "performance");
    slowAnalysisCount = 0;
  } else if (fastAnalysisCount > 180 && analysisProfile !== "quality") {
    setAnalysisProfile(analysisProfile === "performance" ? "balanced" : "quality");
    fastAnalysisCount = 0;
  }
}

// El takibinin durumunu ekranda gorunur kilar. Model yuklenemediginde eskiden
// hicbir sey olmuyordu: el iskeleti hic cikmiyor ama sebebi belli olmuyordu.
let lastHandStatusKey = "";
function updateHandStatus(packets) {
  if (!els.handStatus) return;
  const visible = document.body.classList.contains("started") && state.cameraStatus === "ONLINE";
  els.handStatus.hidden = !visible;
  if (!visible) return;

  const model = state.capabilities.handModel;
  const count = packets.length;
  let key, text, cls;
  if (model === "partial") {
    key = "failed";
    text = "El takibi yüklenemedi";
    cls = "failed";
  } else if (model === "loading") {
    key = "loading";
    text = "El takibi yükleniyor";
    cls = "";
  } else if (count > 0) {
    key = `on:${count}`;
    text = count > 1 ? `${count} el algılandı` : "1 el algılandı";
    cls = "tracking";
  } else {
    key = "off";
    text = "El aranıyor";
    cls = "";
  }
  // aria-live alaninin her karede tekrar okunmamasi icin yalnizca degisince yaz.
  if (key === lastHandStatusKey) return;
  lastHandStatusKey = key;
  els.handStatusText.textContent = text;
  els.handStatus.classList.toggle("tracking", cls === "tracking");
  els.handStatus.classList.toggle("failed", cls === "failed");
}

function drawRealFrame(video) {
  const srcW = video.videoWidth || sceneWidth;
  const srcH = video.videoHeight || sceneHeight;
  const frame = fitContain(srcW, srcH, sceneWidth, sceneHeight);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, sceneWidth, sceneHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (activeMirror) {
    ctx.translate(sceneWidth, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, srcW, srcH, frame.dx, frame.dy, frame.dw, frame.dh);
  ctx.restore();
}

function drawInferenceFrame(video) {
  const iw = inferenceCanvas.width;
  const ih = inferenceCanvas.height;
  const srcW = video.videoWidth || iw;
  const srcH = video.videoHeight || ih;
  const frame = fitContain(srcW, srcH, iw, ih);
  inferenceCtx.save();
  inferenceCtx.fillStyle = "#000";
  inferenceCtx.fillRect(0, 0, iw, ih);
  if (activeMirror) { inferenceCtx.translate(iw, 0); inferenceCtx.scale(-1, 1); }
  inferenceCtx.drawImage(video, 0, 0, srcW, srcH, frame.dx, frame.dy, frame.dw, frame.dh);
  inferenceCtx.restore();
}

function renderLoop() {
  if (renderLoopStarted || destroyed) return;
  renderLoopStarted = true;
  const frame = (frameNow = performance.now()) => {
    if (destroyed) return;
    renderFrameId = requestAnimationFrame(frame);
    if (sceneHeight > sceneWidth && frameNow - lastRenderAt < 30) return;
    lastRenderAt = frameNow;
    if (document.hidden && frameCount % 4 !== 0) {
      frameCount += 1;
      return;
    }
    tick();
  };
  renderFrameId = requestAnimationFrame(frame);
}

function sampleCameraConditions(now, hands) {
  if (now - brightnessSampleAt > 1200) {
    brightnessSampleAt = now;
    const sw = 32, sh = 18;
    try {
      lightCtx.drawImage(inferenceCanvas, 0, 0, sw, sh);
      const sample = lightCtx.getImageData(0, 0, sw, sh).data;
      let total = 0;
      for (let i = 0; i < sample.length; i += 4) total += sample[i] * .2126 + sample[i + 1] * .7152 + sample[i + 2] * .0722;
      averageBrightness = total / (sample.length / 4);
    } catch { averageBrightness = 128; }
  }
  if (hands.length) noHandsSince = now;
  let hint = "";
  if (averageBrightness < 43) hint = "Ellerinizi daha iyi algılayabilmem için ortamı biraz aydınlatın.";
  else if (now - noHandsSince > 6500) hint = "Ellerinizi kameranın gördüğü alana getirin ve iki elinizin de tamamen görünmesini sağlayın.";
  if (hint && now - lastHintAt > 8000) {
    lastHintAt = now;
    els.cameraHint.textContent = hint;
    els.cameraHint.hidden = false;
  } else if (!hint || now - lastHintAt > 5500) {
    els.cameraHint.hidden = true;
  }
}

function updateCameraDiagnostics(hands = []) {
  if (!els.cameraDiagnostics || !config.camera_diagnostics) return;
  const s = camera?.settings || {};
  els.cameraDiagnostics.textContent = [
    `Kamera: ${state.cameraName || "—"}`,
    `Kaynak: ${s.width || 0}×${s.height || 0} @ ${Math.round(s.frameRate || 0)} FPS`,
    `Sahne: ${state.cameraFps.toFixed(0)} FPS · DPR ${sceneScale.toFixed(1)}`,
    `El analizi: ${state.detectorFps.toFixed(0)} FPS · ${inferenceCanvas.width}×${inferenceCanvas.height}`,
    `MediaPipe: ${handTracker?.delegate || "bekleniyor"} · El: ${hands.length}`,
    `Profil: ${state.cameraPerformance} · Track: ${camera?.track?.readyState || "—"}`,
  ].join("\n");
}

function tick() {
  const now = performance.now();
  const t = now / 1000;

  let packets = [];
  if (DEMO_MODE && demoSource) {
    drawDemoBackground(ctx, sceneWidth, sceneHeight, t);
    packets = demoSource.next();
    state.cameraStatus = "ONLINE";
    state.cameraFps = 60;
  } else if (camera && camera.status === "online") {
    drawRealFrame(camera.video);
    state.cameraStatus = "ONLINE";
    const videoFrameTime = camera.video.currentTime;
    if (handTracker && videoFrameTime !== lastVideoFrameAt && !document.hidden) {
      lastVideoFrameAt = videoFrameTime;
      drawInferenceFrame(camera.video);
      const analysisStarted = performance.now();
      packets = handTracker.process(inferenceCanvas, now, sceneWidth, sceneHeight);
      state.detectorFps = handTracker.detectorFps;
      const processMs = performance.now() - analysisStarted;
      if (processMs > 1) updateAdaptiveProfile(processMs);
    } else if (handTracker) {
      // Yeni video karesi yok: son gecerli tespiti koru. Aksi halde eller
      // ara karelerde kayboluyor ve iskelet titriyordu.
      packets = handTracker.recentPackets(now);
    }
    sampleCameraConditions(now, packets);
    updateCameraDiagnostics(packets);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sceneWidth, sceneHeight);
    state.cameraStatus = "OFFLINE";
  }

  updateHandStatus(packets);
  updateVocalMeter(now);
  gestureController.update(packets);
  updateMusicalAnalysis();
  const theme = getTheme(state.themeIndex);
  drawHandSkeletons(ctx, packets, theme);
  updateRecordingBadge();
  // Bilgi panelleri canvas'a cizilir -> hem ekranda hem de kayitta gorunur.
  drawCanvasHud(ctx, buildHudView(), theme, sceneWidth, sceneHeight);
  updateHudLive();

  frameCount += 1;
  if (now - fpsWindowStart > 1000) {
    state.cameraFps = frameCount * 1000 / (now - fpsWindowStart);
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

function announceCamera(message) {
  if (els.cameraStatusLive) els.cameraStatusLive.textContent = message;
}

function populateCameraDevices(devices) {
  if (!els.optCamera) return;
  const selected = config.camera_device_id || "";
  els.optCamera.replaceChildren(new Option("Varsayılan kamera", ""));
  devices.forEach((device, index) => els.optCamera.add(new Option(device.label || `Kamera ${index + 1}`, device.deviceId)));
  els.optCamera.value = devices.some((device) => device.deviceId === selected) ? selected : "";
  els.cameraSwitch.hidden = devices.length < 2;
}

function bindCamera(cameraInstance) {
  cameraInstance.addEventListener("deviceschange", (event) => populateCameraDevices(event.detail));
  cameraInstance.addEventListener("statechange", (event) => {
    const { status, reason } = event.detail;
    document.querySelector(".stage")?.classList.toggle("camera-starting", ["requesting", "starting"].includes(status));
    document.querySelector(".stage")?.classList.toggle("camera-online", status === "online");
    els.cameraActive.hidden = status !== "online";
    if (status === "requesting") announceCamera("Kamera izni bekleniyor");
    if (status === "starting") announceCamera("Kamera hazırlanıyor");
    if (status === "online") announceCamera("Kamera hazır");
    if (status === "interrupted") {
      announceCamera("Kamera bağlantısı kesildi");
      state.cameraStatus = "INTERRUPTED";
      handTracker?.reset?.();
      if (reason === "ended") showCameraError({ title: "Kamera bağlantısı kesildi", detail: "Kamerayı yeniden bağlayıp Tekrar dene'ye basın." });
    }
  });
}

async function tryStartCamera(options = {}) {
  if (cameraStartPromise) return cameraStartPromise;
  cameraStartPromise = tryStartCameraOnce(options).finally(() => { cameraStartPromise = null; });
  return cameraStartPromise;
}

async function tryStartCameraOnce({ facingMode = config.camera_facing_mode, deviceId = "" } = {}) {
  state.capabilities.camera = "requesting";
  els.cameraRetryButton.disabled = true;
  els.cameraRetryButton.textContent = "Deneniyor...";
  camera?.destroy();
  camera = new Camera();
  bindCamera(camera);
  const ok = await camera.start({ deviceId, facingMode });
  // Kamera goruntusu HEMEN gorunur olmali - el takibi modelinin (MediaPipe,
  // CDN'den indirilir) veya mikrofon izninin bitmesini BEKLEMEZ. Bu ikisi
  // yavas/engelli bir agda uzun surebilir; onceden bunlarin bitmesini
  // beklemek kameranin acilmis olmasina ragmen ekranin bos kalmasina neden
  // oluyordu (bkz. renderLoop, tick() zaten handTracker hazir degilse
  // guvenli sekilde bos el listesiyle devam eder).
  state.cameraStatus = camera.status;
  if (ok) {
    hideCameraError();
    state.capabilities.camera = "ready";
    state.cameraSettings = camera.settings;
    state.cameraName = camera.track?.label || camera.devices.find((device) => device.deviceId === camera.settings.deviceId)?.label || "Kamera";
    activeMirror = shouldMirror(camera.settings, config.camera_mirror);
    config.camera_device_id = camera.settings.deviceId || deviceId || "";
    config.camera_facing_mode = camera.settings.facingMode || facingMode || "user";
    persistConfig();
    populateCameraDevices(camera.devices);
    announceCamera(`Kamera hazır: ${camera.width}×${camera.height}`);
    if (!handTracker) {
      handTracker = new HandTracker({ processEvery: 2 });
      setAnalysisProfile(config.camera_performance === "auto" ? "balanced" : config.camera_performance);
      state.capabilities.handModel = "loading";
      announceCamera("Kamera görüntüsü geldi; el modeli hazırlanıyor");
      handTracker.init().then((ready) => {
        state.capabilities.handModel = ready ? "ready" : "partial";
        announceCamera(ready ? "Kamera ve el algılama hazır" : "Kamera hazır; el modeli yüklenemedi");
      });
    }
  } else {
    state.capabilities.camera = ["NotAllowedError", "PermissionDismissedError"].includes(camera.error?.code) ? "denied" : "error";
    showCameraError(camera.error);
  }
  els.cameraRetryButton.disabled = false;
  els.cameraRetryButton.textContent = "Tekrar dene";
  return ok;
}

function startExperience() {
  if (startPromise) return startPromise;
  startPromise = startExperienceOnce();
  return startPromise;
}

function updateMusicalAnalysis() {
  const pitch = state.pitch;
  if (!pitch || pitch.timestamp === lastPitchTimestamp) return;
  lastPitchTimestamp = pitch.timestamp;
  const phrase = phraseDetector.update(pitch, pitch.timestamp || performance.now());
  state.phrase = phrase;
  if (state.music.phraseActive !== phrase.phraseActive) {
    state.music.phraseActive = phrase.phraseActive;
    audioGraph?.postControl({ phraseActive: phrase.phraseActive });
  }
  if (state.tonalSelection !== "western:auto" || !state.stablePitch) return;
  const change = westernHarmony.update(state.stablePitch, pitch.timestamp || performance.now());
  if (!change) return;
  state.music.keyRoot = change.keyRoot;
  state.music.mode = change.mode;
  state.music.keyName = change.chordName.split(" ")[0];
  state.music.chordName = change.chordName;
  state.music.chordNotes = change.chordNotes;
  state.music.chordRevision = change.revision;
  state.music.keyConfidence = change.confidence;
  state.capabilities.harmony = "ready";
  audioGraph?.postControl({ harmonyChange: change });
}

async function startExperienceOnce() {
  if (destroyed) return false;
  state.lifecycle = "STARTING_MEDIA";
  els.startOverlay.hidden = true;
  // Baslangic ekrani (z-index 30) kapanmadan panel/kayit kontrolleri
  // tiklanamaz durumdaydi; artik yalnizca basladiktan sonra gorunurler.
  document.body.classList.add("started");
  if (DEMO_MODE) {
    demoSource = createDemoHandSource(sceneWidth, sceneHeight);
  } else {
    tryStartCamera(); // Kamera ve ses birbirini engellemeden başlar.
  }
  // Görsel sahne mikrofon izni veya AudioWorklet yüklenmesini beklemez.
  // İzin penceresi açık kalsa bile kamera/HUD hemen çalışmaya devam eder.
  renderLoop();
  audioGraph = new AudioGraph(state);
  const audioReady = await audioGraph.start({ lowLatency: config.performance !== "quality", inputProfile: config.input_profile }).then(() => {
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
    return audioGraph.available;
  });
  const cameraReady = DEMO_MODE || state.capabilities.camera === "ready";
  state.lifecycle = cameraReady && audioReady ? "READY" : "PARTIAL_READY";
  return true;
}

async function destroyExperience() {
  if (destroyed) return;
  destroyed = true;
  state.lifecycle = "STOPPING";
  if (recorder?.recording) await recorder.stop();
  camera?.destroy();
  audioGraph?.stop();
  if (renderFrameId) cancelAnimationFrame(renderFrameId);
  renderLoopStarted = false;
  state.lifecycle = "DESTROYED";
}

const introDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let introSkipped = false;

function revealStartPanel() {
  if (!els.startPanel || els.startPanel.classList.contains("intro-ready")) return;
  els.introSequence?.classList.add("is-leaving");
  els.startPanel.classList.remove("intro-pending");
  els.startPanel.classList.add("intro-ready");
  els.startPanel.setAttribute("aria-hidden", "false");
  els.startButton.disabled = false;
  state.lifecycle = "AWAITING_USER";
  setTimeout(() => { if (els.introSequence) els.introSequence.hidden = true; }, 760);
}

async function typeIntro(text, speed) {
  if (!els.introText) return;
  els.introText.textContent = "";
  for (const char of text) {
    if (introSkipped) return;
    els.introText.textContent += char;
    await introDelay(speed);
  }
}

async function eraseIntro(speed) {
  if (!els.introText) return;
  while (els.introText.textContent.length) {
    if (introSkipped) return;
    els.introText.textContent = els.introText.textContent.slice(0, -1);
    await introDelay(speed);
  }
}

async function runIntroSequence() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealStartPanel();
    return;
  }
  await introDelay(80);
  await typeIntro("Selam,", 58);
  if (els.introAnnouncer && !introSkipped) els.introAnnouncer.textContent = "Selam,";
  await introDelay(500);
  await eraseIntro(34);
  await introDelay(50);
  await typeIntro("kafamın içine", 58);
  if (els.introAnnouncer && !introSkipped) els.introAnnouncer.textContent = "kafamın içine";
  await introDelay(500);
  await eraseIntro(34);
  await introDelay(50);
  await typeIntro("hoş geldiniz :)", 58);
  if (els.introAnnouncer && !introSkipped) els.introAnnouncer.textContent = "hoş geldiniz :)";
  await introDelay(520);
  revealStartPanel();
}

// =========================================================================
// VOKAL STUDYO
// Ses zinciri worklet icinde calisir (bkz. audio/worklet/vocal-dsp.js).
// Burasi yalnizca kontrol yuzeyi: mikrofon yasam dongusu, kayit, geri
// dinleme, gostergeler. Kayit, kullaniciya duyulan ISLENMIS sesi icerir -
// worklet'in kayit veri yolundan alinan PCM WAV olarak paketlenir.
// =========================================================================
const vocalStudio = {
  open: false,
  recording: false,
  blob: null,
  objectUrl: null,
  duration: 0,
  smoothedLevel: 0,
  peakHold: 0,
  peakHoldAt: 0,
  clippedAt: 0,
  quietSince: 0,
  fxEnabled: true,
};

function setVocalStatus(message, tone = "") {
  if (!els.vocalStatus) return;
  els.vocalStatus.textContent = message;
  els.vocalStatus.classList.remove("warn", "error", "ok");
  if (tone) els.vocalStatus.classList.add(tone);
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function releaseVocalRecording() {
  if (vocalStudio.objectUrl) {
    URL.revokeObjectURL(vocalStudio.objectUrl);
    vocalStudio.objectUrl = null;
  }
  vocalStudio.blob = null;
  vocalStudio.duration = 0;
  if (els.vocalPlayback) {
    els.vocalPlayback.pause();
    els.vocalPlayback.removeAttribute("src");
    els.vocalPlayback.load();
    els.vocalPlayback.hidden = true;
  }
}

function updateVocalControls() {
  const ready = !!audioGraph?.micReady;
  const hasRecording = !!vocalStudio.blob;
  if (els.vocalRecord) {
    els.vocalRecord.disabled = !ready;
    els.vocalRecord.textContent = vocalStudio.recording ? "■ Kaydı durdur" : "● Kaydı başlat";
    els.vocalRecord.classList.toggle("recording", vocalStudio.recording);
  }
  for (const [element, enabled] of [
    [els.vocalPlay, hasRecording && !vocalStudio.recording],
    [els.vocalDownload, hasRecording && !vocalStudio.recording],
    [els.vocalDiscard, hasRecording && !vocalStudio.recording],
  ]) {
    if (element) element.disabled = !enabled;
  }
  if (els.vocalMic) {
    els.vocalMic.classList.toggle("live", ready && !vocalStudio.recording);
    els.vocalMic.classList.toggle("recording", vocalStudio.recording);
  }
  if (els.vocalMicLabel) {
    els.vocalMicLabel.textContent = vocalStudio.recording
      ? "Kaydediliyor"
      : ready ? "Mikrofon açık" : "Mikrofonu aç";
  }
  if (els.vocalTimer) els.vocalTimer.classList.toggle("active", vocalStudio.recording);
}

async function enableVocalMicrophone() {
  if (!audioGraph) return;
  // iOS/Safari: AudioContext yalnizca kullanici hareketi icinde baslar.
  await audioGraph.resume();
  setVocalStatus("Mikrofon izni bekleniyor…");
  const ok = await audioGraph.enableMicrophone();
  if (ok) {
    setVocalStatus("Mikrofon hazır. Kaydı başlatabilirsiniz.", "ok");
    pushVocalSettings();
  } else {
    setVocalStatus(state.microphoneError || "Mikrofon başlatılamadı.", "error");
  }
  updateVocalControls();
}

function pushVocalSettings() {
  if (!audioGraph) return;
  audioGraph.postControl({
    vocalInputGain: Number(els.vocalGain?.value || 100) / 100,
    vocalReverbMix: Number(els.vocalReverb?.value || 14) / 100,
    vocalEchoMix: Number(els.vocalEcho?.value || 6) / 100,
    vocalEnabled: vocalStudio.fxEnabled,
    captureSource: els.vocalSource?.value || "mix",
  });
}

async function toggleVocalRecording() {
  if (!audioGraph?.micReady) return enableVocalMicrophone();
  await audioGraph.resume();

  if (vocalStudio.recording) {
    const { blob, duration, truncated } = audioGraph.stopCapture();
    vocalStudio.recording = false;
    if (blob) {
      releaseVocalRecording();
      vocalStudio.blob = blob;
      vocalStudio.duration = duration;
      vocalStudio.objectUrl = URL.createObjectURL(blob);
      if (els.vocalPlayback) {
        els.vocalPlayback.src = vocalStudio.objectUrl;
        els.vocalPlayback.hidden = false;
      }
      const size = (blob.size / (1024 * 1024)).toFixed(1);
      setVocalStatus(
        `Kayıt hazır — ${formatClock(duration)} · ${size} MB · WAV` +
        (truncated ? " (süre sınırına ulaşıldı)" : ""),
        "ok"
      );
    } else {
      setVocalStatus("Kayıt alınamadı; ses yolu hazır değil.", "error");
    }
    updateVocalControls();
    return;
  }

  releaseVocalRecording();
  if (!audioGraph.startCapture()) {
    setVocalStatus("Kayıt başlatılamadı; ses motoru hazır değil.", "error");
    return;
  }
  vocalStudio.recording = true;
  vocalStudio.quietSince = performance.now();
  setVocalStatus("Kaydediliyor…");
  updateVocalControls();
}

// Seviye gostergesi: dB olceginde, yumusatilmis, tepe tutuculu.
// Ham tepe degeri dogrudan cizilirse gosterge titrer; asagidaki zaman
// sabitleri hizli yukselip yavas dusen dogal bir hareket verir.
function updateVocalMeter(now) {
  if (!vocalStudio.open || !els.vocalMeterFill) return;
  const peak = state.vocalInputPeak || 0;
  const db = 20 * Math.log10(peak + 1e-9);
  const normalised = clamp01((db + 60) / 60);

  const rising = normalised > vocalStudio.smoothedLevel;
  vocalStudio.smoothedLevel += (normalised - vocalStudio.smoothedLevel) * (rising ? 0.45 : 0.12);
  const level = vocalStudio.smoothedLevel;

  els.vocalMeterFill.style.width = `${(level * 100).toFixed(1)}%`;
  els.vocalMic?.style.setProperty("--vocal-level", level.toFixed(3));

  if (normalised >= vocalStudio.peakHold) {
    vocalStudio.peakHold = normalised;
    vocalStudio.peakHoldAt = now;
  } else if (now - vocalStudio.peakHoldAt > 1200) {
    vocalStudio.peakHold = Math.max(0, vocalStudio.peakHold - 0.006);
  }
  if (els.vocalMeterPeak) {
    els.vocalMeterPeak.style.left = `${(vocalStudio.peakHold * 100).toFixed(1)}%`;
    els.vocalMeterPeak.classList.toggle("visible", vocalStudio.peakHold > 0.02);
  }

  // Clipping: tam olcege cok yaklasilinca. Gosterge kisa bir sure kirmizi
  // kalir, aksi halde tek bir orneklik tepe gozden kacar.
  if (peak >= 0.945) vocalStudio.clippedAt = now;
  const clipping = now - vocalStudio.clippedAt < 900;
  els.vocalMeter?.classList.toggle("clipping", clipping);

  if (!vocalStudio.recording) return;
  els.vocalTimer.textContent = formatClock(audioGraph?.captureSeconds || 0);

  if (clipping) {
    setVocalStatus("Ses çok yüksek — giriş seviyesini düşürün.", "warn");
    vocalStudio.quietSince = now;
  } else if (db > -42) {
    vocalStudio.quietSince = now;
    if (els.vocalStatus.classList.contains("warn")) setVocalStatus("Kaydediliyor…");
  } else if (now - vocalStudio.quietSince > 2500) {
    setVocalStatus("Ses çok düşük — mikrofona yaklaşın veya giriş seviyesini artırın.", "warn");
  }
}

function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

function openVocalStudio() {
  if (!els.vocalOverlay) return;
  vocalStudio.open = true;
  els.vocalOverlay.hidden = false;
  setPanelOpen?.(false);
  updateVocalControls();
  if (audioGraph?.micReady) {
    setVocalStatus("Mikrofon hazır. Kaydı başlatabilirsiniz.", "ok");
    pushVocalSettings();
  } else {
    setVocalStatus("Başlamak için mikrofonu açın.");
  }
  els.vocalMic?.focus();
}

function closeVocalStudio() {
  if (!els.vocalOverlay) return;
  if (vocalStudio.recording) toggleVocalRecording();
  vocalStudio.open = false;
  els.vocalOverlay.hidden = true;
  els.vocalPlayback?.pause();
}

function wireVocalStudio() {
  if (!els.vocalOverlay) return;

  els.optVocalStudio?.addEventListener("click", () => openVocalStudio());
  els.vocalClose?.addEventListener("click", () => closeVocalStudio());
  els.vocalOverlay.addEventListener("click", (event) => {
    if (event.target === els.vocalOverlay) closeVocalStudio();
  });

  els.vocalMic?.addEventListener("click", () => {
    if (audioGraph?.micReady) toggleVocalRecording();
    else enableVocalMicrophone();
  });
  els.vocalRecord?.addEventListener("click", () => toggleVocalRecording());

  els.vocalPlay?.addEventListener("click", () => {
    if (!vocalStudio.objectUrl || !els.vocalPlayback) return;
    els.vocalPlayback.hidden = false;
    els.vocalPlayback.currentTime = 0;
    els.vocalPlayback.play().catch(() => setVocalStatus("Tarayıcı oynatmayı engelledi; oynat düğmesini kullanın.", "warn"));
  });

  els.vocalDownload?.addEventListener("click", () => {
    if (vocalStudio.blob) downloadBlob(vocalStudio.blob, timestampName("harmoni-vokal", "wav"));
  });

  els.vocalDiscard?.addEventListener("click", () => {
    releaseVocalRecording();
    setVocalStatus("Kayıt silindi.");
    updateVocalControls();
  });

  const bindSlider = (input, output, format, apply) => {
    input?.addEventListener("input", () => {
      if (output) output.textContent = format(Number(input.value));
      apply();
    });
  };
  bindSlider(els.vocalGain, els.vocalGainValue, (v) => `${v}%`, pushVocalSettings);
  bindSlider(els.vocalReverb, els.vocalReverbValue, (v) => `${v}%`, pushVocalSettings);
  bindSlider(els.vocalEcho, els.vocalEchoValue, (v) => `${v}%`, pushVocalSettings);

  els.vocalSource?.addEventListener("change", () => pushVocalSettings());

  els.vocalFxToggle?.addEventListener("click", () => {
    vocalStudio.fxEnabled = !vocalStudio.fxEnabled;
    els.vocalFxToggle.textContent = `Efektler: ${vocalStudio.fxEnabled ? "Açık" : "Kapalı"}`;
    els.vocalFxToggle.classList.toggle("on", vocalStudio.fxEnabled);
    pushVocalSettings();
  });

  els.vocalMonitorToggle?.addEventListener("click", () => {
    setMonitorEnabled(!state.monitorEnabled);
    syncVocalMonitorButton();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && vocalStudio.open) closeVocalStudio();
  });
  // Sekme kapanirken akislari ve nesne URL'lerini birak.
  window.addEventListener("pagehide", () => {
    audioGraph?.cancelCapture();
    releaseVocalRecording();
  });

  els.vocalFxToggle?.classList.add("on");
  syncVocalMonitorButton();
}

function syncVocalMonitorButton() {
  if (!els.vocalMonitorToggle) return;
  const on = !!state.monitorEnabled;
  els.vocalMonitorToggle.textContent = `Canlı dinleme: ${on ? "Açık" : "Kapalı"}`;
  els.vocalMonitorToggle.classList.toggle("on", on);
}

function bootstrap() {
  applyThemeUI();
  applyModeVisibility();
  renderGuide();
  populateTonalSelect();
  populateGenreSelect();
  renderInstrumentGrid();
  wireOptionsPanel();
  wireVocalStudio();
  setPanelOpen(false);
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
  window.addEventListener("pagehide", () => { destroyExperience(); }, { once: true });
  els.startButton.addEventListener("click", () => {
    startExperience();
  });
  els.startOverlay.addEventListener("click", (event) => {
    if (els.startPanel.classList.contains("intro-pending")) {
      event.preventDefault();
      event.stopPropagation();
      introSkipped = true;
      revealStartPanel();
    }
  });
  els.cameraRetryButton.addEventListener("click", () => {
    tryStartCamera();
  });
  if (els.optCamera) {
    els.optCamera.value = config.camera_device_id || "";
    els.optCamera.addEventListener("change", async () => {
      config.camera_device_id = els.optCamera.value;
      persistConfig();
      handTracker?.reset?.();
      await tryStartCamera({ deviceId: config.camera_device_id });
    });
  }
  els.cameraRestart?.addEventListener("click", () => tryStartCamera());
  els.cameraSwitch?.addEventListener("click", async () => {
    if (camera?.devices?.length > 1) {
      const index = Math.max(0, camera.devices.findIndex((device) => device.deviceId === config.camera_device_id));
      config.camera_device_id = camera.devices[(index + 1) % camera.devices.length].deviceId;
    } else {
      config.camera_device_id = "";
      config.camera_facing_mode = config.camera_facing_mode === "environment" ? "user" : "environment";
    }
    persistConfig();
    handTracker?.reset?.();
    await tryStartCamera();
  });
  if (els.optCameraMirror) {
    els.optCameraMirror.value = config.camera_mirror || "auto";
    els.optCameraMirror.addEventListener("change", () => {
      config.camera_mirror = els.optCameraMirror.value;
      activeMirror = shouldMirror(camera?.settings, config.camera_mirror);
      handTracker?.reset?.();
      persistConfig();
    });
  }
  if (els.optCameraPerformance) {
    els.optCameraPerformance.value = config.camera_performance || "auto";
    els.optCameraPerformance.addEventListener("change", () => {
      config.camera_performance = els.optCameraPerformance.value;
      setAnalysisProfile(config.camera_performance === "auto" ? "balanced" : config.camera_performance);
      persistConfig();
    });
  }
  if (els.optCameraDiagnostics) {
    els.optCameraDiagnostics.checked = Boolean(config.camera_diagnostics);
    els.cameraDiagnostics.hidden = !config.camera_diagnostics;
    els.optCameraDiagnostics.addEventListener("change", () => {
      config.camera_diagnostics = els.optCameraDiagnostics.checked;
      els.cameraDiagnostics.hidden = !config.camera_diagnostics;
      persistConfig();
    });
  }
  window.addEventListener("resize", resizeSceneCanvas, { passive: true });
  window.addEventListener("orientationchange", () => { resizeSceneCanvas(); setAnalysisProfile(analysisProfile); handTracker?.reset?.(); }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      handTracker?.reset?.();
      return;
    }
    lastVideoFrameAt = 0;
    if (camera?.track?.readyState === "ended") tryStartCamera();
  });
  els.recordDownload?.addEventListener("click", () => {
    if (recordResult) downloadBlob(recordResult, timestampName("harmoni", "webm"));
  });
  els.recordNew?.addEventListener("click", clearRecordResult);
  els.recordDelete?.addEventListener("click", clearRecordResult);
  els.recordResultClose?.addEventListener("click", clearRecordResult);

  if (DEMO_MODE) els.startButton.querySelector("span").textContent = "DEMO PERFORMANSINI BAŞLAT";

  runIntroSequence();
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
