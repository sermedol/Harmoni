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
    this.startPromise = null;
    this.inputProfile = "speaker";
  }

  /** Kayit icin ses akisi (bkz. export/recorder.js). */
  get recordStream() {
    return this.recordDestination ? this.recordDestination.stream : null;
  }

  async start(options = {}) {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start(options);
    return this.startPromise;
  }

  async _start({ lowLatency = false, inputProfile = "speaker" } = {}) {
    this.inputProfile = inputProfile;
    this.state.capabilities.microphone = "requesting";
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({
        sampleRate: 48000,
        latencyHint: lowLatency ? "interactive" : "playback",
      });
      await this.ctx.audioWorklet.addModule("js/audio/worklet/harmoni-processor.js?v=20260801-25");
      this.workletNode = new AudioWorkletNode(this.ctx, "harmoni-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 2,
        outputChannelCount: [2, 2],
      });
      this.workletNode.port.onmessage = (event) => this._handleMessage(event.data);
      // Output 0 = MonitorBus, Output 1 = RecordBus.
      this.workletNode.connect(this.ctx.destination, 0, 0);
      this.recordDestination = this.ctx.createMediaStreamDestination();
      this.workletNode.connect(this.recordDestination, 1, 0);
      this.ctx.onstatechange = () => {
        this.state.audioContextState = this.ctx?.state || "closed";
      };
      this.available = true;
    } catch (err) {
      console.warn("AudioGraph: AudioWorklet baslatilamadi.", err);
      this.available = false;
      return false;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: inputProfile !== "music",
          noiseSuppression: inputProfile !== "music",
          autoGainControl: false,
          channelCount: 1,
          latency: { ideal: 0.01 },
        },
        video: false,
      });
      const micSource = this.ctx.createMediaStreamSource(this.micStream);
      micSource.connect(this.workletNode);
      this.state.audioStatus = "ONLINE";
      this.state.capabilities.microphone = "ready";
    } catch (err) {
      console.warn("AudioGraph: mikrofon erisimi reddedildi/bulunamadi; sentetik/sessiz girisle devam.", err);
      this.state.audioStatus = "OFFLINE";
      this.state.capabilities.microphone = err?.name === "NotAllowedError" ? "denied" : "error";
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
    if (data.pitch) this.state.pitch = data.pitch;
    if (data.stablePitch) this.state.stablePitch = data.stablePitch;
    if (data.pitch?.voiced) this.state.capabilities.pitch = "ready";
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
    this.startPromise = null;
    this.available = false;
    this.state.audioStatus = "OFFLINE";
  }
}
