// harmoni.py'deki `R` ile kayit (cv2.VideoWriter + WAV) ozelliginin tarayici
// karsiligi: canvas'in gorsel akisi ile ses motorunun NIHAI cikisi (orkestra
// + islenmis vokal) tek bir WebM dosyasinda birlestirilir.
//
// Onemli: ses, AudioContext icindeki bir MediaStreamDestination'dan alinir -
// yani hoparlorden cikan sesin aynisi, mikrofonun ham hali degil. Boylece
// kayitta vokal, VocalDSP'den (reverb/eco/sicaklik) gectikten sonraki haliyle
// ve orkestrayla dogru dengede yer alir.

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export class SessionRecorder {
  /**
   * @param {HTMLCanvasElement} canvas - kaydedilecek gorsel sahne
   * @param {MediaStream|null} audioStream - ses motorunun cikis akisi
   */
  constructor(canvas, audioStream) {
    this.canvas = canvas;
    this.audioStream = audioStream;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
    this.startedAt = 0;
    this.lastError = null;
  }

  get supported() {
    return typeof MediaRecorder !== "undefined" && typeof this.canvas.captureStream === "function";
  }

  start(fps = 30) {
    if (this.recording) return true;
    this.lastError = null;
    if (!this.supported) {
      this.lastError = "Bu tarayici kayit (MediaRecorder) desteklemiyor.";
      return false;
    }
    try {
      const videoStream = this.canvas.captureStream(fps);
      const tracks = [...videoStream.getVideoTracks()];
      const audioTracks = this.audioStream?.getAudioTracks?.() || [];
      if (!audioTracks.length) {
        this.lastError = "Kayıt ses yolu hazır değil; yalnız video kaydı başlatılmadı.";
        for (const track of videoStream.getTracks()) track.stop();
        return false;
      }
      tracks.push(...audioTracks);
      const mixed = new MediaStream(tracks);

      const mimeType = pickMimeType();
      this.recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.onerror = (event) => {
        this.lastError = event?.error?.message || "Kayıt sırasında beklenmeyen bir hata oluştu.";
        this.recording = false;
      };
      this.recorder.start(250);
      this.recording = true;
      this.startedAt = performance.now();
      return true;
    } catch (err) {
      this.lastError = err.message || String(err);
      this.recording = false;
      return false;
    }
  }

  /** @returns {Promise<Blob|null>} */
  stop() {
    return new Promise((resolve) => {
      if (!this.recording || !this.recorder) return resolve(null);
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || "video/webm" });
        this.chunks = [];
        this.recording = false;
        resolve(blob);
      };
      try {
        this.recorder.stop();
      } catch {
        this.recording = false;
        resolve(null);
      }
    });
  }

  get elapsedSeconds() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestampName(prefix, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}
