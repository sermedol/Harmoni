// harmoni.py AudioEngine'in tarayici karsiligi (ust-duzey orkestrasyon).
// Gercek ses render zinciri AudioWorkletProcessor icinde calisir (bkz.
// worklet/harmoni-processor.js); bu sinif yalnizca AudioContext/worklet
// kurulumunu, mikrofon baglantisini ve MessagePort protokolunu yonetir.
import { WavWriter } from "../export/wav-encoder.js";

export class AudioGraph {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.workletNode = null;
    this.micStream = null;
    this.micSource = null;
    this.recordDestination = null;
    this.available = false;
    this.startPromise = null;
    this.micPromise = null;
    this.inputProfile = "speaker";
    this.wavWriter = null;
    this.capturing = false;
  }

  get micReady() {
    return !!this.micStream && this.micStream.getAudioTracks().some((track) => track.readyState === "live");
  }

  get sampleRate() { return this.ctx?.sampleRate || 48000; }

  /**
   * iOS/Safari AudioContext'i yalnizca bir kullanici hareketi icinde
   * baslatir ve sekme arka plana alininca askiya alir. Ses uretmesi
   * beklenen her etkilesimden once cagrilmali.
   */
  async resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* kullanici hareketi disinda reddedilebilir */ }
    }
    return this.ctx?.state === "running";
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
      await this.ctx.audioWorklet.addModule("js/audio/worklet/harmoni-processor.js?v=20260802-04");
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

    await this.enableMicrophone();
    return true;
  }

  /**
   * Mikrofonu acar. Tekrar tekrar cagrilabilir: zaten canli bir akis varsa
   * yenisini istemez ve ikinci bir kaynak dugumu baglamaz - aksi halde ayni
   * mikrofon ust uste karisir ve akislar sizdirir.
   */
  async enableMicrophone() {
    if (this.micReady) return true;
    if (this.micPromise) return this.micPromise;
    this.micPromise = this._acquireMicrophone().finally(() => { this.micPromise = null; });
    return this.micPromise;
  }

  async _acquireMicrophone() {
    if (!this.ctx || !this.workletNode) return false;
    // Onceki basarisiz/bitmis akisi tamamen birak.
    this._releaseMicrophone();
    this.state.capabilities.microphone = "requesting";
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: this.inputProfile !== "music",
          noiseSuppression: this.inputProfile !== "music",
          autoGainControl: false,
          channelCount: 1,
          latency: { ideal: 0.01 },
        },
        video: false,
      });
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.workletNode);
      this.state.audioStatus = "ONLINE";
      this.state.capabilities.microphone = "ready";
      this.state.microphoneError = "";
      return true;
    } catch (err) {
      console.warn("AudioGraph: mikrofon erisimi reddedildi/bulunamadi; sentetik/sessiz girisle devam.", err);
      this.state.audioStatus = "OFFLINE";
      this.state.capabilities.microphone = err?.name === "NotAllowedError" ? "denied" : "error";
      this.state.microphoneError = describeMicrophoneError(err);
      return false;
    }
  }

  _releaseMicrophone() {
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* zaten kopmus olabilir */ }
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
  }

  /** Mikrofonu kullanicinin istegiyle kapatir (gizlilik + kaynak birakma). */
  disableMicrophone() {
    this._releaseMicrophone();
    this.state.audioStatus = "OFFLINE";
    this.state.capabilities.microphone = "idle";
  }

  // --- Vokal kaydi (islenmis ses, WAV) -----------------------------------

  startCapture() {
    if (!this.available || this.capturing) return false;
    this.wavWriter = new WavWriter({ sampleRate: this.sampleRate, channels: 2 });
    this.capturing = true;
    this.postControl({ captureEnabled: true });
    return true;
  }

  /** @returns {{blob: Blob|null, duration: number, truncated: boolean}} */
  stopCapture() {
    if (!this.capturing) return { blob: null, duration: 0, truncated: false };
    this.capturing = false;
    this.postControl({ captureEnabled: false });
    const writer = this.wavWriter;
    this.wavWriter = null;
    return {
      blob: writer ? writer.toBlob() : null,
      duration: writer ? writer.durationSeconds : 0,
      truncated: writer ? writer.truncated : false,
    };
  }

  cancelCapture() {
    if (!this.capturing) return;
    this.capturing = false;
    this.postControl({ captureEnabled: false });
    this.wavWriter = null;
  }

  get captureSeconds() { return this.wavWriter?.durationSeconds || 0; }

  postControl(payload) {
    this.workletNode?.port.postMessage({ type: "control", payload });
  }

  _handleMessage(data) {
    if (!data) return;
    if (data.type === "capture") {
      // Kayit durdurulduktan sonra yolda kalmis blok gelebilir; yazici
      // yoksa sessizce yok sayilir.
      if (this.capturing && this.wavWriter) this.wavWriter.push([data.left, data.right]);
      return;
    }
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
    if (typeof data.vocalInputPeak === "number") this.state.vocalInputPeak = data.vocalInputPeak;
    this.state.outputLevel = data.synthMaxAbs || 0;
    this.state._lastTelemetry = data;
  }

  stop() {
    this.cancelCapture();
    this._releaseMicrophone();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try { this.workletNode.disconnect(); } catch { /* zaten kopmus olabilir */ }
      this.workletNode = null;
    }
    if (this.recordDestination) {
      try { this.recordDestination.disconnect(); } catch { /* zaten kopmus olabilir */ }
      this.recordDestination = null;
    }
    if (this.ctx) {
      this.ctx.onstatechange = null;
      if (this.ctx.state !== "closed") this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.startPromise = null;
    this.micPromise = null;
    this.available = false;
    this.state.audioStatus = "OFFLINE";
  }
}

/** Tarayici hatasini kullanicinin anlayacagi bir cumleye cevirir. */
export function describeMicrophoneError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Mikrofon izni verilmedi. Tarayıcının adres çubuğundaki kilit simgesinden mikrofona izin verip tekrar deneyin.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Kullanılabilir bir mikrofon bulunamadı. Cihazın bağlı olduğundan emin olun.";
    case "NotReadableError":
      return "Mikrofona ulaşılamıyor. Başka bir uygulama kullanıyor olabilir; onu kapatıp tekrar deneyin.";
    default:
      return "Mikrofon başlatılamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}
