import test from "node:test";
import assert from "node:assert/strict";
import { AudioGraph, describeMicrophoneError } from "../../docs/js/audio/audio-graph.js";

function makeGraph() {
  const state = { capabilities: {}, };
  const graph = new AudioGraph(state);
  graph.available = true;
  graph.ctx = { sampleRate: 48000 };          // postControl workletNode'suz guvenli
  return { graph, state };
}

const block = () => ({ type: "capture", left: new Float32Array(128), right: new Float32Array(128) });

// Node 22'de globalThis.navigator salt okunur bir erisimci; dogrudan
// atanamaz, tanimlanmasi gerekir.
function stubNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}
function restoreNavigator() {
  Reflect.deleteProperty(globalThis, "navigator");
}

test("kayit veri yolu WAV olarak paketlenir", () => {
  const { graph } = makeGraph();
  assert.equal(graph.startCapture(), true);
  for (let i = 0; i < 375; i++) graph._handleMessage(block());   // 375 * 128 = 1 saniye

  const result = graph.stopCapture();
  assert.ok(result.blob, "blob uretilmeli");
  assert.equal(result.blob.type, "audio/wav");
  assert.ok(Math.abs(result.duration - 1) < 1e-6, "sure 1 saniye olmali");
  assert.equal(result.blob.size, 44 + 48000 * 4, "stereo 16-bit WAV boyutu");
});

test("cift baslatma ve cift durdurma guvenli", () => {
  const { graph } = makeGraph();
  assert.equal(graph.startCapture(), true);
  assert.equal(graph.startCapture(), false, "zaten kaydederken yeniden baslamamali");
  graph._handleMessage(block());
  assert.ok(graph.stopCapture().blob);
  const second = graph.stopCapture();
  assert.equal(second.blob, null, "ikinci durdurma bos donmeli");
  assert.equal(second.duration, 0);
});

test("durdurduktan sonra gelen gec bloklar yok sayilir", () => {
  const { graph } = makeGraph();
  graph.startCapture();
  for (let i = 0; i < 10; i++) graph._handleMessage(block());
  const { duration } = graph.stopCapture();
  // Worklet ile ana is parcacigi arasinda yolda kalmis bloklar gelebilir.
  graph._handleMessage(block());
  graph._handleMessage(block());
  assert.equal(graph.captureSeconds, 0, "yazici serbest birakilmis olmali");
  assert.ok(duration > 0);
});

test("cancelCapture veriyi atar ve kaydi kapatir", () => {
  const { graph } = makeGraph();
  graph.startCapture();
  for (let i = 0; i < 50; i++) graph._handleMessage(block());
  graph.cancelCapture();
  assert.equal(graph.capturing, false);
  assert.equal(graph.wavWriter, null);
  assert.equal(graph.stopCapture().blob, null);
});

test("ses motoru hazir degilken kayit baslamaz", () => {
  const { graph } = makeGraph();
  graph.available = false;
  assert.equal(graph.startCapture(), false);
});

test("mikrofon iki kez istenmez ve ikinci kaynak baglanmaz", async () => {
  const { graph, state } = makeGraph();
  let requestCount = 0;
  let connectCount = 0;
  const track = { readyState: "live", stop() { this.readyState = "ended"; } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };

  stubNavigator({ mediaDevices: { getUserMedia: async () => { requestCount++; return stream; } } });
  graph.ctx.createMediaStreamSource = () => ({ connect() { connectCount++; }, disconnect() {} });
  graph.workletNode = {};

  assert.equal(await graph.enableMicrophone(), true);
  assert.equal(requestCount, 1);
  assert.equal(connectCount, 1);

  // Zaten canli akis varken tekrar cagirmak yeni akis acmamali; aksi halde
  // ayni mikrofon ust uste karisir ve akislar sizar.
  await graph.enableMicrophone();
  await graph.enableMicrophone();
  assert.equal(requestCount, 1, "yeni getUserMedia istegi yapilmamali");
  assert.equal(connectCount, 1, "ikinci kaynak dugumu baglanmamali");
  assert.equal(state.capabilities.microphone, "ready");

  restoreNavigator();
});

test("es zamanli mikrofon istekleri tek istege indirgenir", async () => {
  const { graph } = makeGraph();
  let requestCount = 0;
  const track = { readyState: "live", stop() {} };
  stubNavigator({
    mediaDevices: {
      getUserMedia: async () => {
        requestCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  });
  graph.ctx.createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  graph.workletNode = {};

  await Promise.all([graph.enableMicrophone(), graph.enableMicrophone(), graph.enableMicrophone()]);
  assert.equal(requestCount, 1, "ayni anda gelen istekler tek izin penceresi acmali");

  restoreNavigator();
});

test("mikrofon kapatilinca izler durdurulur ve baglanti kopar", () => {
  const { graph, state } = makeGraph();
  let stopped = 0;
  let disconnected = 0;
  const track = { readyState: "live", stop() { stopped++; this.readyState = "ended"; } };
  graph.micStream = { getAudioTracks: () => [track], getTracks: () => [track] };
  graph.micSource = { disconnect() { disconnected++; } };

  graph.disableMicrophone();
  assert.equal(stopped, 1, "mikrofon izi durdurulmali");
  assert.equal(disconnected, 1, "kaynak dugumu kopmali");
  assert.equal(graph.micReady, false);
  assert.equal(state.capabilities.microphone, "idle");
});

test("stop her seyi temizler ve kayit yarida kalirsa atar", () => {
  const { graph } = makeGraph();
  let closed = 0;
  let trackStopped = 0;
  const track = { readyState: "live", stop() { trackStopped++; } };
  graph.micStream = { getAudioTracks: () => [track], getTracks: () => [track] };
  graph.micSource = { disconnect() {} };
  graph.workletNode = { port: { onmessage: () => {}, postMessage() {} }, disconnect() {} };
  graph.recordDestination = { disconnect() {} };
  graph.ctx = { sampleRate: 48000, state: "running", close: async () => { closed++; }, onstatechange: () => {} };
  graph.startCapture();

  graph.stop();
  assert.equal(trackStopped, 1);
  assert.equal(closed, 1, "AudioContext kapatilmali");
  assert.equal(graph.workletNode, null);
  assert.equal(graph.recordDestination, null);
  assert.equal(graph.ctx, null);
  assert.equal(graph.capturing, false);
  assert.equal(graph.available, false);
});

test("mikrofon hatalari anlasilir mesaja cevrilir", () => {
  assert.match(describeMicrophoneError({ name: "NotAllowedError" }), /izin/i);
  assert.match(describeMicrophoneError({ name: "NotFoundError" }), /bulunamadı/i);
  assert.match(describeMicrophoneError({ name: "NotReadableError" }), /uygulama/i);
  assert.ok(describeMicrophoneError({ name: "Baska" }).length > 0, "bilinmeyen hata icin de mesaj olmali");
});
