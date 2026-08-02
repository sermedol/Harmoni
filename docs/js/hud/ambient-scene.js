// Organik ortam katmani.
//
// Amac: kamera goruntusunu "canli bir dijital bahcenin icinde" gostermek.
// Dekorasyon degil, derinlik sistemi: kenarlarda karanlik ve bitki
// siluetleri, merkezde temiz alan. Kullanicinin yuzu ve elleri asla
// kapanmaz.
//
// TASARIM KARARLARI
// - Statik siluetler bir kez offscreen canvas'a cizilir, her karede yalnizca
//   blit edilir. Her karede egri cizmek kare suresini gereksiz uzatirdi.
// - Parcaciklar sabit bir havuzda tutulur; her karede yeni nesne uretilmez.
// - Ses seviyesi ortam isigini en fazla %15 degistirir. Daha fazlasi
//   goruntuyu dalgalandirir ve dikkat dagitir.
// - Merkez bolge (yuz ve el alani) hicbir zaman cizilmez.
// - prefers-reduced-motion: parcaciklar ve sis hareketi durur, katman
//   statik kalir.
// - Bu modul KENDI requestAnimationFrame dongusunu ACMAZ; mevcut render
//   dongusunden cagrilir.
import { approach, clamp01 } from "./draw-utils.js";

const POLLEN_DESKTOP = 26;
const POLLEN_MOBILE = 10;

function makePollen(width, height, random) {
  return {
    x: random() * width,
    y: random() * height,
    radius: 0.6 + random() * 1.5,
    speed: 4 + random() * 12,
    drift: (random() - 0.5) * 6,
    phase: random() * Math.PI * 2,
    alpha: 0.18 + random() * 0.4,
  };
}

/** Tekrarlanabilir dagilim: her acilista ayni kompozisyon olusur. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class AmbientScene {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.silhouette = null;
    this.silhouetteCtx = null;
    this.pollen = [];
    this.level = 0;
    this.lastTime = 0;
    this.density = 1;
  }

  /**
   * Sahne boyutu degistiginde statik katmani yeniden uretir.
   * @param {number} width @param {number} height
   * @param {number} density 0-1 arasi yogunluk (mobilde dusuk)
   */
  resize(width, height, density = 1) {
    if (this.width === width && this.height === height && this.density === density) return;
    this.width = width;
    this.height = height;
    this.density = density;

    if (!this.silhouette) {
      this.silhouette = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
    }
    this.silhouette.width = width;
    this.silhouette.height = height;
    this.silhouetteCtx = this.silhouette.getContext("2d");
    this._paintSilhouette(this.silhouetteCtx, width, height);

    const random = seededRandom(20260802);
    const target = Math.round((width < 720 ? POLLEN_MOBILE : POLLEN_DESKTOP) * density);
    this.pollen.length = 0;
    for (let i = 0; i < target; i++) this.pollen.push(makePollen(width, height, random));
  }

  /**
   * Statik katman: kenar karartmasi + kose bitki siluetleri.
   * Yari soyut ve dusuk kontrastli; fotograf kolaji gibi gorunmez.
   */
  _paintSilhouette(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    const random = seededRandom(913371);
    const shortest = Math.min(width, height);

    // Kenar derinligi: merkez tamamen acik kalir.
    const vignette = ctx.createRadialGradient(
      width / 2, height * 0.48, shortest * 0.28,
      width / 2, height * 0.5, Math.max(width, height) * 0.78
    );
    vignette.addColorStop(0, "rgba(6,16,15,0)");
    vignette.addColorStop(0.62, "rgba(6,16,15,0.28)");
    vignette.addColorStop(1, "rgba(4,11,10,0.82)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Petrol yesili taban tonu yalnizca alt koselerde.
    const floor = ctx.createLinearGradient(0, height * 0.72, 0, height);
    floor.addColorStop(0, "rgba(17,48,43,0)");
    floor.addColorStop(1, "rgba(17,48,43,0.4)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);

    // Kose bitkileri. Merkezden uzak tutulur; govde ve yaprak sadelestirilmis.
    const clusters = [
      { x: 0, y: height, dir: 1, scale: 1.0, count: 7 },
      { x: width, y: height, dir: -1, scale: 1.0, count: 7 },
      { x: 0, y: 0, dir: 1, scale: 0.62, count: 4, flip: true },
      { x: width, y: 0, dir: -1, scale: 0.62, count: 4, flip: true },
    ];
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.count; i++) {
        this._paintStem(ctx, cluster, i, shortest, random);
      }
    }
  }

  _paintStem(ctx, cluster, index, shortest, random) {
    const { x, y, dir, scale, flip } = cluster;
    const height = shortest * (0.16 + random() * 0.26) * scale;
    const baseX = x + dir * (10 + index * (shortest * 0.045) + random() * 18);
    const baseY = flip ? y - random() * 12 : y + random() * 12;
    const tipY = flip ? baseY + height : baseY - height;
    const bend = dir * (18 + random() * 46) * scale;

    ctx.save();
    ctx.globalAlpha = 0.16 + random() * 0.2;
    ctx.strokeStyle = "#0F2A25";
    ctx.lineWidth = 1.1 + random() * 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + bend * 0.4, (baseY + tipY) / 2, baseX + bend, tipY);
    ctx.stroke();

    // Ucta yumusak bir cicek/tohum basi.
    const headRadius = (2.2 + random() * 4.4) * scale;
    const tone = random();
    ctx.globalAlpha = 0.13 + random() * 0.16;
    ctx.fillStyle = tone > 0.82 ? "#E6B4C5" : tone > 0.62 ? "#DDD39E" : "#A8C983";
    ctx.beginPath();
    ctx.arc(baseX + bend, tipY, headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Ince isinsal tohumlar - yalnizca en buyuk basliklarda.
    if (headRadius > 4) {
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = "#DDF1E9";
      ctx.lineWidth = 0.6;
      for (let ray = 0; ray < 6; ray++) {
        const angle = (ray / 6) * Math.PI * 2 + random();
        ctx.beginPath();
        ctx.moveTo(baseX + bend, tipY);
        ctx.lineTo(
          baseX + bend + Math.cos(angle) * headRadius * 2.1,
          tipY + Math.sin(angle) * headRadius * 2.1
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} options
   * @param {number} options.width @param {number} options.height
   * @param {number} options.level 0-1 ses seviyesi
   * @param {number} options.now performance.now()
   * @param {boolean} options.reducedMotion
   * @param {number} options.density
   */
  draw(ctx, { width, height, level = 0, now = 0, reducedMotion = false, density = 1 }) {
    this.resize(width, height, density);

    // Ses seviyesi ortam isigini en fazla %15 degistirir; dusus yavas
    // olsun diye asimetrik yumusatma.
    const target = clamp01(level);
    this.level = approach(this.level, target, target > this.level ? 0.22 : 0.05);
    const lift = this.level * 0.15;

    const previousAlpha = ctx.globalAlpha;

    if (this.silhouette) {
      ctx.globalAlpha = previousAlpha * (0.9 + lift * 0.6);
      ctx.drawImage(this.silhouette, 0, 0, width, height);
    }

    // Merkezde cok hafif kuvars isigi: ses geldikce guclenir.
    if (this.level > 0.02) {
      ctx.globalAlpha = previousAlpha * this.level * 0.14;
      const centre = ctx.createRadialGradient(
        width / 2, height * 0.46, 0,
        width / 2, height * 0.46, Math.min(width, height) * 0.42
      );
      centre.addColorStop(0, "rgba(221,241,233,0.5)");
      centre.addColorStop(1, "rgba(221,241,233,0)");
      ctx.fillStyle = centre;
      ctx.fillRect(0, 0, width, height);
    }

    if (!reducedMotion && this.pollen.length) {
      this._drawPollen(ctx, width, height, now, previousAlpha);
    }

    ctx.globalAlpha = previousAlpha;
  }

  _drawPollen(ctx, width, height, now, baseAlpha) {
    const delta = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0.016;
    this.lastTime = now;
    // Ses geldikce parcaciklar biraz hizlanir - "ortam uyaniyor" hissi.
    const speedScale = 1 + this.level * 0.5;
    ctx.fillStyle = "#DDF1E9";

    for (const particle of this.pollen) {
      particle.y -= particle.speed * delta * speedScale;
      particle.phase += delta * 0.6;
      if (particle.y < -6) {
        particle.y = height + 6;
        particle.x = Math.random() * width;
      }
      const x = particle.x + Math.sin(particle.phase) * particle.drift;

      // Merkez bolgeyi bos birak: yuz ve el alani.
      const centreDistance = Math.abs(x - width / 2) / (width / 2);
      if (centreDistance < 0.34 && particle.y > height * 0.18 && particle.y < height * 0.82) continue;

      ctx.globalAlpha = baseAlpha * particle.alpha * (0.5 + this.level * 0.5);
      ctx.beginPath();
      ctx.arc(x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose() {
    this.pollen.length = 0;
    this.silhouette = null;
    this.silhouetteCtx = null;
    this.width = 0;
    this.height = 0;
  }
}
