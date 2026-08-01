import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_PROFILES, buildVideoConstraints, fitCover, shouldMirror } from "../../docs/js/camera/camera-math.js";
import { Camera } from "../../docs/js/camera/camera.js";
import { fingerStates } from "../../docs/js/camera/hand-tracker.js";

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

test("cover crop preserves aspect ratio for 4:3 camera", () => {
  const crop = fitCover(640, 480, 1280, 720);
  assert.equal(crop.sh, 360);
  assert.equal(crop.sw, 640);
  assert.equal(crop.sy, 60);
  assert.equal(crop.sx, 0);
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
