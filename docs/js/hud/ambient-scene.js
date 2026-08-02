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

/** #RRGGBB -> rgba(r,g,b,a). Renkler temadan gelir, burada sabit yazilmaz. */
function rgba(hex, alpha) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return `rgba(2,1,1,${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

const FALLBACK_PALETTE = {
  deep: "#020101",
  surface: "#3D0B0D",
  raised: "#53080E",
  botanicalMid: "#53080E",
  petalDark: "#72090F",
  petalBright: "#B21F29",
  dust: "#E8C9CC",
};

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
    this.palette = { ...FALLBACK_PALETTE };
    this.paletteKey = "";
  }

  /**
   * Aktif temayi baglar. Renk degisirse statik silueti yeniden uretir;
   * boylece bu modulde sabit renk kalmaz ve tema tek kaynaktan yonetilir.
   */
  setTheme(theme) {
    if (!theme) return;
    const next = {
      deep: theme.backgroundDeep || theme.bg || FALLBACK_PALETTE.deep,
      surface: theme.backgroundSurface || theme.panel || FALLBACK_PALETTE.surface,
      raised: theme.surfaceRaised || theme.panel2 || FALLBACK_PALETTE.raised,
      botanicalMid: theme.botanicalMid || theme.panel2 || FALLBACK_PALETTE.botanicalMid,
      petalDark: theme.petalDark || FALLBACK_PALETTE.petalDark,
      petalBright: theme.petalBright || theme.secondary || FALLBACK_PALETTE.petalBright,
      dust: theme.petalDust || theme.primary || FALLBACK_PALETTE.dust,
    };
    const key = Object.values(next).join("|");
    if (key === this.paletteKey) return;
    this.palette = next;
    this.paletteKey = key;
    // Siluet renge bagli onbelleklendigi icin tazelenmeli.
    this.width = 0;
    this.height = 0;
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
    const palette = this.palette;

    // Kenar derinligi. Merkez TAMAMEN acik kalir: kullanicinin yuzu ve
    // elleri bordo bir perdenin altinda kalmamali. Ic yaricap genis
    // tutuldu ki guvenli alan korunsun.
    const vignette = ctx.createRadialGradient(
      width / 2, height * 0.48, shortest * 0.34,
      width / 2, height * 0.5, Math.max(width, height) * 0.78
    );
    vignette.addColorStop(0, rgba(palette.deep, 0));
    vignette.addColorStop(0.6, rgba(palette.surface, 0.22));
    vignette.addColorStop(1, rgba(palette.deep, 0.8));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Mahogany taban tonu yalnizca alt koselerde - merkeze tasmaz.
    const floor = ctx.createLinearGradient(0, height * 0.74, 0, height);
    floor.addColorStop(0, rgba(palette.raised, 0));
    floor.addColorStop(1, rgba(palette.raised, 0.34));
    ctx.fillStyle = floor;
    ctx.fillRect(0, height * 0.74, width, height * 0.26);

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

    const palette = this.palette;
    ctx.save();
    ctx.globalAlpha = 0.16 + random() * 0.2;
    ctx.strokeStyle = palette.petalDark;
    ctx.lineWidth = 1.1 + random() * 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + bend * 0.4, (baseY + tipY) / 2, baseX + bend, tipY);
    ctx.stroke();

    // Ucta yumusak bir petal / tohum basi. Parlak terracotta cok seyrek
    // kullanilir; atmosfer sakin kalmali.
    const headRadius = (2.2 + random() * 4.4) * scale;
    const tone = random();
    ctx.globalAlpha = 0.12 + random() * 0.14;
    ctx.fillStyle = tone > 0.88 ? palette.petalBright
      : tone > 0.62 ? palette.petalDark
      : palette.botanicalMid;
    ctx.beginPath();
    ctx.arc(baseX + bend, tipY, headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Ince isinsal tohumlar - yalnizca en buyuk basliklarda.
    if (headRadius > 4) {
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = palette.dust;
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
  draw(ctx, { width, height, level = 0, now = 0, reducedMotion = false, density = 1, theme = null }) {
    if (theme) this.setTheme(theme);
    this.resize(width, height, density);

    // Ses seviyesi ortam isigini en fazla %12 degistirir. Bordo palette
    // daha fazlasi vokalle pompalayan bir kirmizi parlama uretiyordu.
    const target = clamp01(level);
    this.level = approach(this.level, target, target > this.level ? 0.2 : 0.05);
    const lift = this.level * 0.12;

    const previousAlpha = ctx.globalAlpha;

    if (this.silhouette) {
      ctx.globalAlpha = previousAlpha * (0.9 + lift * 0.5);
      ctx.drawImage(this.silhouette, 0, 0, width, height);
    }

    // Merkezde cok hafif sicak isik: ses geldikce guclenir. Yogunlugu
    // dusuk tutuldu ki cilt tonlarina kirmizi bir perde binmesin.
    if (this.level > 0.02) {
      ctx.globalAlpha = previousAlpha * this.level * 0.1;
      const centre = ctx.createRadialGradient(
        width / 2, height * 0.46, 0,
        width / 2, height * 0.46, Math.min(width, height) * 0.42
      );
      centre.addColorStop(0, rgba(this.palette.dust, 0.4));
      centre.addColorStop(1, rgba(this.palette.dust, 0));
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
    ctx.fillStyle = this.palette.dust;

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
