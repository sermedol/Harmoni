// harmoni.py CameraWorker'in tarayici karsiligi. Python, kamerayi ayri bir
// thread'de okuyup her zaman "en yeni kare"yi tutar (kuyruklama yok);
// tarayicida <video> elementinin kendisi zaten bu semantigi saglar (bir
// onceki kare islenmemis olsa da <video> daima en guncel dekode edilmis
// kareyi tutar), bu yuzden ayri bir worker thread'ine gerek yoktur.
//
// Python'daki _fallback_frame ile ayni ruhta: kamera acilamazsa nedenini
// (izin reddi, cihaz yok, guvensiz baglanti (https) vb.) acikca ayirt edip
// kullanicinin ne yapmasi gerektigini soyleyen bir mesaj uretir.
const ERROR_MESSAGES = {
  insecure: {
    title: "Guvenli baglanti (HTTPS) gerekli",
    detail: "Kamera yalnizca https:// veya localhost uzerinden calisir. GitHub Pages'te yayinlandiginda bu sorun olmaz.",
  },
  unsupported: {
    title: "Bu tarayici kamera erisimini desteklemiyor",
    detail: "Guncel bir Chrome, Edge, Firefox veya Safari surumu deneyin.",
  },
  NotAllowedError: {
    title: "Kamera izni reddedildi",
    detail: "Adres cubugundaki kilit/kamera simgesine tiklayip izni acin, sonra sayfayi yenileyin.",
  },
  NotFoundError: {
    title: "Kamera bulunamadi",
    detail: "Bilgisayarda/telefonda bagli bir kamera oldugundan emin olun.",
  },
  NotReadableError: {
    title: "Kameraya erisilemiyor",
    detail: "Baska bir uygulama (Teams/Zoom/OBS) kamerayi kullaniyor olabilir, kapatip tekrar deneyin.",
  },
  OverconstrainedError: {
    title: "Kamera istenen ayarlari desteklemiyor",
    detail: "Farkli bir kamera secmeyi veya tarayiciyi guncellemeyi deneyin.",
  },
  SecurityError: {
    title: "Guvenlik kisitlamasi",
    detail: "Tarayici ayarlarinda bu site icin kamera erisimi engellenmis olabilir.",
  },
  default: {
    title: "Kamera baslatilamadi",
    detail: "Sayfayi yenileyip tekrar deneyin; sorun devam ederse baska bir tarayici deneyin.",
  },
};

export class Camera {
  constructor() {
    this.video = document.getElementById("camera-video");
    this.stream = null;
    this.status = "OFFLINE";
    this.width = 0;
    this.height = 0;
    this.error = null; // { title, detail } - kullanici mesaji
  }

  async start() {
    this.error = null;
    if (!window.isSecureContext) {
      this.error = ERROR_MESSAGES.insecure;
      this.status = "OFFLINE";
      return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = ERROR_MESSAGES.unsupported;
      this.status = "OFFLINE";
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: { ideal: "user" },
          resizeMode: { ideal: "none" },
        },
        audio: false,
      });
      const track = this.stream.getVideoTracks()[0];
      track.addEventListener("ended", () => { this.status = "OFFLINE"; });
      track.addEventListener("mute", () => { this.status = "INTERRUPTED"; });
      track.addEventListener("unmute", () => { this.status = "ONLINE"; });
      try {
        const capabilities = track?.getCapabilities?.() || {};
        const advanced = {};
        if (capabilities.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
        if (capabilities.exposureMode?.includes("continuous")) advanced.exposureMode = "continuous";
        if (capabilities.whiteBalanceMode?.includes("continuous")) advanced.whiteBalanceMode = "continuous";
        if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
      } catch (qualityError) {
        console.info("Camera: gelişmiş görüntü ayarları bu cihazda kullanılamıyor.", qualityError);
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      await new Promise((resolve) => {
        if (this.video.readyState >= 2) return resolve();
        this.video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      });
      this.width = this.video.videoWidth || 1280;
      this.height = this.video.videoHeight || 720;
      this.settings = track?.getSettings?.() || {};
      this.status = "ONLINE";
      return true;
    } catch (err) {
      console.warn("Camera: baslatilamadi.", err);
      this.error = ERROR_MESSAGES[err.name] || ERROR_MESSAGES.default;
      this.status = "OFFLINE";
      return false;
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.status = "OFFLINE";
  }
}
