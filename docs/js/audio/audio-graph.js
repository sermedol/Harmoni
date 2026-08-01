// harmoni.py AudioEngine'in tarayici karsiligi (ust-duzey orkestrasyon).
// Gercek ses render zinciri AudioWorkletProcessor icinde calisir (bkz.
// worklet/harmoni-processor.js); bu sinif yalnizca AudioContext/worklet
// kurulumunu, mikrofon baglantisini ve MessagePort protokolunu yonetir.
export class AudioGraph {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.workletNode = null;
    this.micStream = null;
    this.recordDestination = null;
    this.available = false;
  }

  /** Kayit icin ses akisi (bkz. export/recorder.js). */
  get recordStream() {
    return this.recordDestination ? this.recordDestination.stream : null;
  }

  async start({ lowLatency = false } = {}) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({
        sampleRate: 48000,
        latencyHint: lowLatency ? "interactive" : "playback",
      });
      await this.ctx.audioWorklet.addModule("js/audio/worklet/harmoni-processor.js");
      this.workletNode = new AudioWorkletNode(this.ctx, "harmoni-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.port.onmessage = (event) => this._handleMessage(event.data);
      this.workletNode.connect(this.ctx.destination);
      // Kayit icin ikinci bir cikis: hoparlore giden NIHAI karisimin (orkestra
      // + islenmis vokal) aynisini bir MediaStream olarak sunar; boylece
      // MediaRecorder mikrofonun ham halini degil, duyulan sesi kaydeder.
      this.recordDestination = this.ctx.createMediaStreamDestination();
      this.workletNode.connect(this.recordDestination);
      this.available = true;
    } catch (err) {
      console.warn("AudioGraph: AudioWorklet baslatilamadi.", err);
      this.available = false;
      return false;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const micSource = this.ctx.createMediaStreamSource(this.micStream);
      micSource.connect(this.workletNode);
      this.state.audioStatus = "ONLINE";
    } catch (err) {
      console.warn("AudioGraph: mikrofon erisimi reddedildi/bulunamadi; sentetik/sessiz girisle devam.", err);
      this.state.audioStatus = "OFFLINE";
    }
    return true;
  }

  postControl(payload) {
    this.workletNode?.port.postMessage({ type: "control", payload });
  }

  _handleMessage(data) {
    if (!data) return;
    if (data.type === "error") {
      console.error("HarmoniProcessor worklet hatasi:", data.where, data.message, data.stack);
      this.state._lastWorkletError = data;
      return;
    }
    if (data.type !== "telemetry") return;
    this.state.latencyMs = this.ctx ? (this.ctx.baseLatency || 0) * 1000 : 0;
    if (data.waveform) this.state.waveform = data.waveform;
    this.state.vocalLevel = data.vocalLevel || 0;
    this.state.outputLevel = data.synthMaxAbs || 0;
    this.state._lastTelemetry = data;
  }

  stop() {
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
    }
    this.workletNode?.disconnect();
    this.ctx?.close();
    this.state.audioStatus = "OFFLINE";
  }
}
