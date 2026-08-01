import { CAMERA_PROFILES, buildVideoConstraints } from "./camera-math.js?v=20260802-02";

const ERRORS = {
  insecure: ["Güvenli bağlantı gerekli", "Kamera yalnızca HTTPS veya localhost üzerinden çalışır."],
  unsupported: ["Kamera bu tarayıcıda kullanılamıyor", "Güncel Chrome, Edge, Firefox veya Safari ile yeniden deneyin."],
  NotAllowedError: ["Kamera izni verilmedi", "Adres çubuğundaki kamera simgesinden izni açıp Tekrar dene'ye basın."],
  PermissionDismissedError: ["Kamera izni bekleniyor", "İzin penceresini kapattınız. Tekrar deneyip kameraya izin verin."],
  NotFoundError: ["Kamera bulunamadı", "Bir kamera bağlayın veya cihazın kamera erişiminin açık olduğunu kontrol edin."],
  NotReadableError: ["Kamera başka bir uygulama tarafından kullanılıyor", "Zoom, Teams, OBS veya kamerayı kullanan başka bir uygulamayı kapatıp yeniden deneyin."],
  AbortError: ["Kamera bağlantısı kesildi", "Kamerayı yeniden bağlayıp Tekrar dene'ye basın."],
  OverconstrainedError: ["Kamera ayarı desteklenmiyor", "Harmoni daha düşük görüntü kalitesiyle yeniden denemeyi başaramadı."],
  SecurityError: ["Kamera erişimi engellendi", "Tarayıcı ayarlarında bu site için kamera erişimini etkinleştirin."],
  default: ["Kamera başlatılamadı", "Kamera bağlantısını kontrol edip yeniden deneyin."],
};

function userError(error) {
  const key = error?.name === "NotAllowedError" && error?.message?.toLowerCase().includes("dismiss")
    ? "PermissionDismissedError" : error?.name;
  const [title, detail] = ERRORS[key] || ERRORS.default;
  return { title, detail, code: key || "UnknownError" };
}

export class Camera extends EventTarget {
  constructor(video = document.getElementById("camera-video")) {
    super();
    this.video = video;
    this.stream = null;
    this.track = null;
    this.status = "offline";
    this.settings = {};
    this.devices = [];
    this.error = null;
    this.startPromise = null;
    this.generation = 0;
    this.frameRate = 0;
    this.frameCallbackId = 0;
    this._deviceChange = () => this.refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", this._deviceChange);
  }

  _state(status, detail = {}) {
    this.status = status;
    this.dispatchEvent(new CustomEvent("statechange", { detail: { status, ...detail } }));
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter((device) => device.kind === "videoinput").map((device, index) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label || `Kamera ${index + 1}`,
    }));
    const activeId = this.settings?.deviceId;
    if (activeId && this.track?.readyState === "live" && !this.devices.some((device) => device.deviceId === activeId)) {
      this._state("interrupted", { reason: "device-removed" });
    }
    this.dispatchEvent(new CustomEvent("deviceschange", { detail: this.devices }));
    return this.devices;
  }

  start(options = {}) {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start(options).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async _start({ deviceId = "", facingMode = "" } = {}) {
    this.stop({ preserveState: true });
    const generation = ++this.generation;
    this.error = null;
    if (!window.isSecureContext) return this._fail("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return this._fail("unsupported");
    this._state("requesting");
    let lastError;
    let selectedDeviceId = deviceId;
    for (const profile of CAMERA_PROFILES) {
      try {
        this._state("starting", { profile });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(profile, { deviceId: selectedDeviceId, facingMode }), audio: false,
        });
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        await this._attach(stream);
        await this.refreshDevices();
        return true;
      } catch (error) {
        lastError = error;
        if (error.name === "NotFoundError" && selectedDeviceId) selectedDeviceId = "";
        if (!["OverconstrainedError", "NotFoundError", "AbortError"].includes(error.name)) break;
      }
    }
    this.error = userError(lastError);
    this._state("error", { error: this.error });
    return false;
  }

  _fail(key) {
    const [title, detail] = ERRORS[key];
    this.error = { title, detail, code: key };
    this._state("error", { error: this.error });
    return false;
  }

  async _attach(stream) {
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.track.addEventListener("ended", () => this._state("interrupted", { reason: "ended" }), { once: true });
    this.track.addEventListener("mute", () => this._state("interrupted", { reason: "mute" }));
    this.track.addEventListener("unmute", () => this._state("online"));
    this.video.srcObject = stream;
    await this.video.play();
    if (this.video.readyState < 2) {
      await new Promise((resolve) => this.video.addEventListener("loadeddata", resolve, { once: true }));
    }
    this.settings = this.track.getSettings?.() || {};
    this.width = this.settings.width || this.video.videoWidth || 640;
    this.height = this.settings.height || this.video.videoHeight || 480;
    await this._applyQualityHints();
    this._startFrameMonitor();
    this._state("online", { settings: this.settings });
  }

  _startFrameMonitor() {
    if (!this.video.requestVideoFrameCallback) {
      this.frameRate = Number(this.settings.frameRate) || 0;
      return;
    }
    let frames = 0;
    let windowStart = performance.now();
    const onFrame = (now) => {
      frames += 1;
      if (now - windowStart >= 1000) {
        this.frameRate = frames * 1000 / (now - windowStart);
        frames = 0;
        windowStart = now;
      }
      if (this.track?.readyState === "live") this.frameCallbackId = this.video.requestVideoFrameCallback(onFrame);
    };
    this.frameCallbackId = this.video.requestVideoFrameCallback(onFrame);
  }

  async _applyQualityHints() {
    try {
      const caps = this.track?.getCapabilities?.() || {};
      const hint = {};
      if (caps.focusMode?.includes("continuous")) hint.focusMode = "continuous";
      if (caps.exposureMode?.includes("continuous")) hint.exposureMode = "continuous";
      if (caps.whiteBalanceMode?.includes("continuous")) hint.whiteBalanceMode = "continuous";
      if (Object.keys(hint).length) await this.track.applyConstraints({ advanced: [hint] });
    } catch { /* Görüntü ipuçları zorunlu değildir. */ }
  }

  stop({ preserveState = false } = {}) {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.frameCallbackId && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameCallbackId);
    this.frameCallbackId = 0;
    this.video?.pause?.();
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.track = null;
    this.settings = {};
    if (!preserveState) this._state("offline");
  }

  destroy() {
    this.stop();
    navigator.mediaDevices?.removeEventListener?.("devicechange", this._deviceChange);
  }
}
