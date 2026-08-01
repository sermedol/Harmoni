import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_PROFILES, buildVideoConstraints, fitContain, fitCover, sceneSizeForViewport, shouldMirror } from "../../docs/js/camera/camera-math.js";
import { Camera } from "../../docs/js/camera/camera.js";
import { HandTracker, associateHandLabels, createOneEuroFilter, fingerStates } from "../../docs/js/camera/hand-tracker.js";
import { classifyGesture } from "../../docs/js/camera/gesture-classifier.js";
import { interpolateLandmark } from "../../docs/js/hud/hand-skeleton.js";

test("camera profiles degrade from 1080p to native fallback", () => {
  assert.deepEqual(CAMERA_PROFILES.slice(0, 4).map((p) => [p.width, p.height]), [[1920, 1080], [1280, 720], [960, 540], [640, 480]]);
  assert.equal(CAMERA_PROFILES.at(-1), null);
});

test("device selection uses exact device id without conflicting facing mode", () => {
  const constraints = buildVideoConstraints(CAMERA_PROFILES[1], { deviceId: "camera-2", facingMode: "environment" });
  assert.deepEqual(constraints.deviceId, { exact: "camera-2" });
  assert.equal("facingMode" in constraints, false);
  assert.equal(constraints.frameRate.max, 30);
});

test("default camera constraints do not force a device or facing mode", () => {
  const constraints = buildVideoConstraints(CAMERA_PROFILES[1], {});
  assert.equal("deviceId" in constraints, false);
  assert.equal("facingMode" in constraints, false);
});

test("cover crop preserves aspect ratio for 4:3 camera", () => {
  const crop = fitCover(640, 480, 1280, 720);
  assert.equal(crop.sh, 360);
  assert.equal(crop.sw, 640);
  assert.equal(crop.sy, 60);
  assert.equal(crop.sx, 0);
});

test("raw camera contain mode preserves the complete 4:3 frame", () => {
  assert.deepEqual(fitContain(640, 480, 1280, 720), { dx: 160, dy: 0, dw: 960, dh: 720 });
});

test("portrait scene matches the viewport aspect without CSS cropping", () => {
  const scene = sceneSizeForViewport(390, 844);
  assert.equal(scene.portrait, true);
  assert.ok(Math.abs(scene.width / scene.height - 390 / 844) < .001);
  assert.deepEqual(sceneSizeForViewport(1280, 720), { width: 1280, height: 720, portrait: false });
});

test("front camera mirrors automatically and rear camera does not", () => {
  assert.equal(shouldMirror({ facingMode: "user" }, "auto"), true);
  assert.equal(shouldMirror({ facingMode: "environment" }, "auto"), false);
  assert.equal(shouldMirror({ facingMode: "environment" }, "on"), true);
});

test("camera retries lower profiles and stop closes the active track", async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const track = new EventTarget();
  let stopped = false;
  track.stop = () => { stopped = true; };
  track.getSettings = () => ({ width: 960, height: 540, frameRate: 30, facingMode: "user", deviceId: "cam" });
  track.getCapabilities = () => ({});
  track.readyState = "live";
  track.label = "Test camera";
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  let attempts = 0;
  const mediaDevices = new EventTarget();
  mediaDevices.getUserMedia = async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("unsupported profile"), { name: "OverconstrainedError" });
    return stream;
  };
  mediaDevices.enumerateDevices = async () => [{ kind: "videoinput", deviceId: "cam", groupId: "g", label: "Test camera" }];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices } });
  const video = { readyState: 2, videoWidth: 960, videoHeight: 540, srcObject: null, play: async () => {}, pause: () => {}, addEventListener: () => {} };
  const camera = new Camera(video);
  assert.equal(await camera.start(), true);
  assert.equal(attempts, 3);
  assert.equal(camera.settings.width, 960);
  camera.destroy();
  assert.equal(stopped, true);
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

test("finger extension is invariant when the hand rotates", () => {
  const points = Array.from({ length: 21 }, () => [0, 0]);
  points[0] = [0, 0];
  points[1] = [-.4, .2]; points[3] = [-1.2, .2]; points[4] = [-2, .2];
  for (const [mcp, pip, tip, x] of [[5, 6, 8, -.6], [9, 10, 12, -.2], [13, 14, 16, .2], [17, 18, 20, .6]]) {
    points[mcp] = [x, .8]; points[pip] = [x, 1.8]; points[tip] = [x, 3.6];
  }
  assert.deepEqual(fingerStates(points), [true, true, true, true, true]);
  const angle = Math.PI / 2;
  const rotated = points.map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]);
  assert.deepEqual(fingerStates(rotated), [true, true, true, true, true]);
});

// Parmaklari verilen eklem acisiyla buken yapay bir el uretir (180 = tam duz).
function handWithFingerBend(degrees) {
  const points = Array.from({ length: 21 }, () => [0, 0]);
  points[0] = [0, 0];
  points[1] = [-.4, .2]; points[3] = [-1.2, .2]; points[4] = [-2, .2];
  const theta = (180 - degrees) * Math.PI / 180;
  for (const [mcp, pip, tip, x] of [[5, 6, 8, -.6], [9, 10, 12, -.2], [13, 14, 16, .2], [17, 18, 20, .6]]) {
    points[mcp] = [x, .8];
    points[pip] = [x, 1.8];
    points[tip] = [x + Math.sin(theta) * 1.8, 1.8 + Math.cos(theta) * 1.8];
  }
  return points;
}

test("naturally open hand still counts as open when fingers bend slightly", () => {
  // Insan eli acik dururken parmaklar cetvel gibi duz degil, ~145 derecedir.
  // Onceki 152 derece esigi bu eli "kapali" sayiyor ve ACIK AVUC jesti
  // pratikte hic tetiklenmiyordu.
  assert.deepEqual(fingerStates(handWithFingerBend(145)).slice(1), [true, true, true, true]);
  // Gercekten bukulmus parmaklar hala acik sayilmamali.
  assert.deepEqual(fingerStates(handWithFingerBend(120)).slice(1), [false, false, false, false]);
});

test("hands survive render frames that have no new camera image", () => {
  // Kamera 30fps, sahne 60fps: karelerin yarisinda yeni video karesi yoktur.
  // O karelerde el listesi bosaltilirsa iskelet ve jestler saniyede ~30 kez
  // sonup yanar. Son gecerli tespit korunmali, ama sonsuza kadar degil.
  const tracker = new HandTracker();
  tracker.available = true;
  tracker.lastPackets = [{ label: "RIGHT" }];
  tracker.lastDetectionTime = 1000;

  assert.equal(tracker.recentPackets(1100).length, 1, "taze tespit korunmali");
  assert.equal(tracker.recentPackets(1400).length, 0, "bayat tespit birakilmali");

  tracker.available = false;
  assert.equal(tracker.recentPackets(1100).length, 0, "model yokken el bildirilmemeli");
});

test("closed fist is not misread as a pinch", () => {
  // Yumrukta bas parmak ve isaret ucu da birbirine yaklasir; eski sirada
  // pinch esigi once bakildigi icin yumruk PINCH olarak siniflaniyordu.
  assert.equal(classifyGesture([false, false, false, false, false], .10), "FIST");
  // Gercek pinch'te diger parmaklardan en az biri disarida durur.
  assert.equal(classifyGesture([false, false, true, true, true], .10), "PINCH");
  assert.equal(classifyGesture([true, true, true, true, true], .90), "OPEN_HAND");
});

test("portrait scene keeps the viewport aspect outside the old clamp band", () => {
  for (const [w, h] of [[583, 690], [768, 900], [360, 1000]]) {
    const scene = sceneSizeForViewport(w, h);
    assert.equal(scene.portrait, true, `${w}x${h} portrait olmali`);
    assert.ok(Math.abs(scene.width / scene.height - w / h) < .005, `${w}x${h} orani korunmali`);
  }
});

// Tekrarlanabilir sozde-rastgele gurultu (test determinist olmali).
function noiseSource(seed = 12345) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - .5;
  };
}

const FRAME = 1 / 30;

test("landmark filter suppresses jitter without ever freezing (no stick-slip)", () => {
  // Eski esik tabanli filtre karelerin %80'inde noktayi TAMAMEN donduruyor,
  // sonra ortalamanin 6.6 kati bir sicrama yapiyordu. Gozle gorulen titreme
  // buydu. Esigi buyutmek eli agirlastiriyor, kucultmek gurultuyu geri
  // getiriyordu; arada calisan bir deger yok. 1€ filtresinde esik yoktur.
  const noise = noiseSource();
  const filter = createOneEuroFilter();
  const amplitude = .004;
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const value = filter.filter(.5 + noise() * 2 * amplitude, FRAME);
    if (i > 60) samples.push(value);
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const std = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
  const inputStd = amplitude / Math.sqrt(3);

  // Gurultu belirgin sekilde bastirilmali.
  assert.ok(std < inputStd * .35, `kalan titreme cok yuksek: ${std}`);
  // 1280px genislikte yaklasik 2 pikselden az sapma.
  assert.ok(Math.max(...samples.map((v) => Math.abs(v - .5))) < .0016);

  // Hicbir kare tamamen donmamali: donma + sicrama dongusu titremenin
  // kaynagiydi. Girdi degisiyorsa cikti da degismeli.
  const steps = samples.slice(1).map((v, i) => Math.abs(v - samples[i]));
  assert.equal(steps.filter((s) => s === 0).length, 0, "filtre kareleri donduruyor");
  // Adimlar birbirine yakin olmali (sicrama yok).
  const meanStep = steps.reduce((a, b) => a + b, 0) / steps.length;
  assert.ok(Math.max(...steps) < meanStep * 5, "adimlar arasinda sicrama var");
});

test("landmark filter follows deliberate motion within a few frames", () => {
  const filter = createOneEuroFilter();
  for (let i = 0; i < 40; i++) filter.filter(.5, FRAME);
  const progress = [];
  for (let i = 0; i < 12; i++) progress.push((filter.filter(.58, FRAME) - .5) / .08);
  const reached90 = progress.findIndex((v) => v >= .9);
  assert.ok(reached90 >= 0 && reached90 < 6, `%90'a ulasma cok yavas: ${reached90 + 1} kare`);
});

test("landmark filter behaves consistently in time across frame rates", () => {
  // dt hesaba katilmazsa 60fps'te filtre iki kat agir davranir.
  const settle = (dt, frames) => {
    const filter = createOneEuroFilter();
    for (let i = 0; i < Math.round(1.5 / dt); i++) filter.filter(.5, dt);
    let value = .5;
    for (let i = 0; i < frames; i++) value = filter.filter(.58, dt);
    return (value - .5) / .08;
  };
  // Ayni SURE (~200ms): 30fps'te 6 kare, 60fps'te 12 kare.
  const at30 = settle(1 / 30, 6);
  const at60 = settle(1 / 60, 12);
  assert.ok(Math.abs(at30 - at60) < .12, `fps'e gore davranis degisiyor: ${at30} vs ${at60}`);
});

test("hand identity remains stable when MediaPipe flips handedness", () => {
  const previous = [
    { label: "RIGHT", normalized: [[.2, .5, 0]] },
    { label: "LEFT", normalized: [[.8, .5, 0]] },
  ];
  const labels = associateHandLabels([[.21, .5], [.79, .5]], ["LEFT", "RIGHT"], previous);
  assert.deepEqual(labels, ["RIGHT", "LEFT"]);
});

test("render interpolation is continuous and never freezes", () => {
  // Gorsel katman artik esik kullanmiyor: gurultu bastirma tek yerde,
  // hand-tracker'daki 1€ filtresinde yapiliyor. Iki katmanda birden esik
  // uygulamak gecikmeyi ikiye katliyor ve ikinci bir stick-slip kaynagi
  // yaratiyordu.
  const tiny = interpolateLandmark([100, 100], [101, 99]);
  assert.notDeepEqual(tiny, [100, 100], "kucuk hareket donduruluyor");
  assert.ok(tiny[0] > 100 && tiny[0] < 101);

  // Mesafe buyudukce yaklasma orani monoton artmali, sicrama olmamali.
  const ratio = (distance) => (interpolateLandmark([100, 100], [100 + distance, 100])[0] - 100) / distance;
  const ratios = [2, 8, 20, 50, 120].map(ratio);
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] >= ratios[i - 1], "oran monoton degil");
  assert.ok(ratios.at(-1) <= .85, "hizli harekette asiri kesme");

  // Hizli hareket tek karede buyuk olcude kapanmali.
  assert.ok(interpolateLandmark([100, 100], [200, 100])[0] > 160);
});
