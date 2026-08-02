// Harmoni performans HUD'u.
//
// Sahne canvas'ina cizilir; boylece kayit videosunda da performansciyla
// ayni bilgi gorunur. Etkilesim gerektiren kontroller DOM'da kalir.
//
// ONCEKI SURUMDEN NEDEN AYRILDI
// Eski HUD bir cihaz paneli gibi gorunuyordu: dort kose nisangahi, sert
// dikdortgen tam genislik konsol, "PERFORMANS / 01" cihaz metni, bastan
// sona monospace ve FREKANS/SAPMA/NETLIK/VURUS metrik yigini. Bu, sahneyi
// bir olcum ekranina cevirip kamerayi ikinci plana atiyordu.
//
// Yeni yerlesim uc bolge:
//   UST     sol kimlik + durum | orta guncel eslik | sag tempo
//   DOCK    ortalanmis yuzen cam serit: nota, dalga formu, orkestra, kayit
//   JEST    kisa sureli, elin yakininda, ana metinle yarismayan geri bildirim
//
// Tipografi iki seviyeli: arayuz metinleri sans, yalnizca guncel eslik adi
// serif. Buyuk harf yalnizca kucuk kategori etiketlerinde.
import {
  FONT, text, fitText, fitFontSize, line, roundRect,
  glassPanel, topScrim, bottomScrim, glow, clamp01, measure, fontString,
} from "./draw-utils.js";

// --- Yumusatilmis degerler (kare arasi gecisler icin) --------------------
const smooth = {
  level: 0,
  confidence: 0,
  chordFade: 1,
  lastChord: "",
};

function approachValue(current, target, rate) {
  return current + (target - current) * rate;
}

/** #RRGGBB -> rgba(). Tema renkleriyle saydam gecis uretmek icin. */
function hexToRgba(hex, alpha) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return `rgba(232,201,204,${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/** Dort yumusak vurus isareti. Sert yanip sonme yok: buyume + opaklik. */
function drawBeat(ctx, x, y, bpm, theme, spacing, reducedMotion) {
  const duration = 60000 / Math.max(1, bpm);
  const now = performance.now();
  const active = Math.floor(now / duration) % 4;
  const phase = (now % duration) / duration;
  for (let i = 0; i < 4; i++) {
    const isActive = i === active && !reducedMotion;
    // Aktif nokta hizla buyuyup yavasca soner.
    const decay = isActive ? 1 - phase : 0;
    const radius = 1.9 + decay * 2.1;
    const alpha = 0.28 + decay * 0.62;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = decay > 0.15 ? theme.primary : theme.muted;
    ctx.beginPath();
    ctx.arc(x + i * spacing, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Dalga formu - kuvars renginde ince cizgi, golge yok. */
function drawWave(ctx, waveform, x, y, w, h, color, level) {
  line(ctx, x, y + h / 2, x + w, y + h / 2, color, 0.7, 0.16);
  if (!waveform || waveform.length < 2) return;
  const amplitude = h * 0.42 * (0.55 + level * 0.45);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  const step = Math.max(1, Math.floor(waveform.length / Math.max(1, w)));
  for (let i = 0; i < waveform.length; i += step) {
    const px = x + (i / (waveform.length - 1)) * w;
    const py = y + h / 2 - Math.max(-1, Math.min(1, waveform[i])) * amplitude;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.globalAlpha = 0.55 + level * 0.45;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Perde guveni: LED metre degil, ince kuvars yayi.
 * Dolulugu netligi gosterir; renk surekli degismez.
 */
function drawConfidenceArc(ctx, cx, cy, radius, value, theme) {
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI * 0.78, Math.PI * 2.22);
  ctx.strokeStyle = theme.panel2;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.65;
  ctx.stroke();

  if (value > 0.01) {
    const sweep = (Math.PI * 2.22 - Math.PI * 0.78) * value;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.78, Math.PI * 0.78 + sweep);
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4 + value * 0.55;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
}

/** Sol ust kimlik ve sistem durumu. Durum yalnizca renkle anlatilmaz. */
function drawIdentity(ctx, v, theme, x, y, compact) {
  text(ctx, "HARMONİ", x, y, {
    size: compact ? 12 : 13, weight: 600, color: theme.text,
    family: FONT.sans, align: "left",
  });
  // Harf araligi buyuk metinlerde kullanilmaz; burada kucuk kimlik isareti
  // oldugu icin hafif aralik okunabilirligi artirir.
  const statusY = y + (compact ? 16 : 19);
  const dotColor = v.ready ? theme.success : v.hasError ? theme.danger : theme.warning;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + 3, statusY - 3.5, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  text(ctx, v.statusLabel || "Hazırlanıyor", x + 13, statusY, {
    size: compact ? 10.5 : 11.5, weight: 500, color: theme.muted, align: "left",
  });
}

/** Ust orta: guncel eslik. Ana tipografik odak, serif. */
function drawChord(ctx, v, theme, cx, top, maxWidth, compact) {
  text(ctx, "Şu anki eşlik", cx, top, {
    size: compact ? 10 : 11, weight: 600, color: theme.muted, align: "center",
  });

  const name = String(v.chordName || "—");
  if (name !== smooth.lastChord) {
    smooth.lastChord = name;
    smooth.chordFade = 0;
  }
  smooth.chordFade = approachValue(smooth.chordFade, 1, v.reducedMotion ? 1 : 0.14);

  // Uzun makam adlari once kuculur, ancak son care olarak kirpilir.
  const maxSize = compact ? 30 : 42;
  const size = fitFontSize(ctx, name, maxWidth, maxSize, compact ? 18 : 22, 400, FONT.serif);
  const shown = fitText(ctx, name, maxWidth, size, 400, FONT.serif);

  // Metnin arkasinda cok dusuk yogunluklu isik - halo degil.
  if (smooth.chordFade > 0.2) {
    // Renk temadan gelir; burada sabit yazilmaz.
    glow(ctx, cx, top + size * 0.62, size * 2.4, hexToRgba(theme.primary, 0.42), 0.06 * smooth.chordFade);
  }

  text(ctx, shown, cx, top + size * 0.98 + 6, {
    size, weight: 400, color: theme.text, align: "center", family: FONT.serif,
    alpha: 0.35 + smooth.chordFade * 0.65,
  });

  const meta = `${v.tonalBadge || "BATI"} · ${(v.genreLabel || "Serbest").toUpperCase()}`;
  text(ctx, fitText(ctx, meta, maxWidth, compact ? 9.5 : 10.5, 600), cx, top + size * 0.98 + (compact ? 22 : 28), {
    size: compact ? 9.5 : 10.5, weight: 600, color: theme.accent, align: "center", alpha: 0.85,
  });
}

/** Sag ust: tempo. */
function drawTempo(ctx, v, theme, right, top, compact, reducedMotion) {
  const size = compact ? 22 : 28;
  text(ctx, Math.round(v.bpm), right, top + size * 0.86, {
    size, weight: 600, color: theme.text, align: "right",
  });
  text(ctx, "BPM", right, top + size * 0.86 + (compact ? 13 : 15), {
    size: compact ? 9.5 : 10.5, weight: 600, color: theme.muted, align: "right",
  });
  const spacing = compact ? 9 : 11;
  drawBeat(ctx, right - spacing * 3, top + size * 0.86 + (compact ? 24 : 28), v.bpm, theme, spacing, reducedMotion);
}

/**
 * Alt dock: ortalanmis, yuzen, yari saydam.
 * Tam genislikte agir konsol degil - yuzu ve elleri kapatmaz.
 */
function drawDock(ctx, v, theme, W, H, compact) {
  const maxWidth = 1180;
  const width = Math.min(maxWidth, W * (compact ? 0.94 : 0.78));
  const height = compact ? 138 : 106;
  const x = (W - width) / 2;
  const y = H - height - (compact ? 18 : 26);

  bottomScrim(ctx, W, height + 60, y - 30, 0.42);
  glassPanel(ctx, x, y, width, height, { radius: compact ? 20 : 24, alpha: 0.9 });

  const padding = compact ? 16 : 22;
  const innerX = x + padding;
  const innerRight = x + width - padding;

  if (compact) return drawDockCompact(ctx, v, theme, innerX, innerRight, y, height);

  // --- Bolum 1: canli nota ---
  const noteWidth = 190;
  drawNoteBlock(ctx, v, theme, innerX, y + 20, noteWidth, false);

  // --- Bolum 2: dalga formu ---
  const waveX = innerX + noteWidth + 26;
  const orchestraWidth = 216;
  const recWidth = v.recording ? 96 : 0;
  const waveWidth = Math.max(90, innerRight - waveX - orchestraWidth - recWidth - 26);
  text(ctx, "Ses izi", waveX, y + 26, { size: 10, weight: 600, color: theme.muted });
  drawWave(ctx, v.waveform, waveX, y + 34, waveWidth, 48, theme.primary, smooth.level);

  // --- Bolum 3: orkestra ---
  const orchestraX = waveX + waveWidth + 26;
  const names = v.instruments || [];
  text(ctx, `Orkestra · ${names.length} katman`, orchestraX, y + 26, {
    size: 10, weight: 600, color: theme.muted,
  });
  const listing = names.length ? names.join(" · ") : "Eşlik için ses bekleniyor";
  wrapTwoLines(ctx, listing, orchestraX, y + 46, orchestraWidth, 11.5, theme, names.length ? theme.text : theme.muted);

  // --- Bolum 4: kayit ---
  if (v.recording) drawRecording(ctx, v, theme, innerRight - 84, y + 26);
}

/** Dikey ekranda dock iki satira doner. */
function drawDockCompact(ctx, v, theme, innerX, innerRight, y, height) {
  drawNoteBlock(ctx, v, theme, innerX, y + 18, innerRight - innerX, true);

  const waveY = y + 74;
  const recWidth = v.recording ? 84 : 0;
  const waveWidth = Math.max(80, innerRight - innerX - recWidth - 16);
  drawWave(ctx, v.waveform, innerX, waveY, waveWidth, 30, theme.primary, smooth.level);

  const names = v.instruments || [];
  const summary = names.length ? `${names.length} katman · ${names[0]}` : "Eşlik için ses bekleniyor";
  text(ctx, fitText(ctx, summary, innerRight - innerX - recWidth - 8, 10.5, 500), innerX, y + height - 14, {
    size: 10.5, weight: 500, color: theme.muted,
  });

  if (v.recording) drawRecording(ctx, v, theme, innerRight - 72, waveY + 4);
}

/** Canli nota alani: ses yokken bekleme metni, varken nota + ayrintilar. */
function drawNoteBlock(ctx, v, theme, x, y, width, compact) {
  if (!v.voiced) {
    text(ctx, "Sesini bekliyorum", x, y + (compact ? 22 : 30), {
      size: compact ? 15 : 17, weight: 500, color: theme.muted, alpha: 0.85,
    });
    return;
  }

  const noteSize = compact ? 30 : 38;
  text(ctx, v.noteName, x, y + noteSize * 0.82, {
    size: noteSize, weight: 500, color: theme.text,
  });

  const noteWidth = measure(ctx, String(v.noteName), fontString(noteSize, 500, FONT.sans));
  const detailX = x + noteWidth + 14;

  text(ctx, `${v.frequency.toFixed(1)} Hz`, detailX, y + (compact ? 16 : 20), {
    size: compact ? 10.5 : 11.5, weight: 500, color: theme.muted,
  });
  const cents = v.pitchCents || 0;
  const centsLabel = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cent`;
  text(ctx, centsLabel, detailX, y + (compact ? 30 : 36), {
    size: compact ? 10.5 : 11.5, weight: 500,
    color: Math.abs(cents) > 35 ? theme.warning : theme.muted,
  });

  // Netlik yayi - metnin sagina, kucuk.
  const arcX = Math.min(x + width - 18, detailX + 96);
  drawConfidenceArc(ctx, arcX, y + (compact ? 22 : 26), compact ? 12 : 14, smooth.confidence, theme);
}

/** Iki satira kadar sigdirir; ucuncu satira tasmaz. */
function wrapTwoLines(ctx, value, x, y, maxWidth, size, theme, color) {
  const font = fontString(size, 500, FONT.sans);
  const words = String(value).split(" · ");
  let first = "";
  let index = 0;
  while (index < words.length) {
    const candidate = first ? `${first} · ${words[index]}` : words[index];
    if (measure(ctx, candidate, font) > maxWidth) break;
    first = candidate;
    index++;
  }
  if (!first) first = fitText(ctx, words[0] || "", maxWidth, size, 500);
  text(ctx, first, x, y, { size, weight: 500, color });

  if (index < words.length) {
    const rest = words.slice(index).join(" · ");
    text(ctx, fitText(ctx, rest, maxWidth, size, 500), x, y + size + 5, {
      size, weight: 500, color, alpha: 0.72,
    });
  }
}

/** Kayit gostergesi - kayit videosunda da gorunmesi icin canvas uzerinde. */
function drawRecording(ctx, v, theme, x, y) {
  const pulse = v.reducedMotion ? 1 : 0.62 + Math.sin(performance.now() / 520) * 0.38;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = theme.danger;
  ctx.beginPath();
  ctx.arc(x + 5, y + 6, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  text(ctx, "REC", x + 15, y + 10, { size: 11, weight: 700, color: theme.danger });
  text(ctx, v.recordTime, x + 15, y + 26, { size: 12.5, weight: 600, color: theme.text });
}

/**
 * Jest geri bildirimi: elin yakininda degil, merkezden biraz asagida
 * ve kisa sureli. Ana akor metniyle yarismaz.
 */
function drawGesture(ctx, v, theme, W, H, compact) {
  if (!v.gestureLabel) return;
  const alpha = clamp01(v.gestureAlpha ?? 1);
  if (alpha <= 0.01) return;

  const size = compact ? 12 : 13.5;
  const label = v.gestureLabel;
  const width = measure(ctx, label, fontString(size, 600, FONT.sans)) + 34;
  const x = W / 2 - width / 2;
  const y = H * (compact ? 0.6 : 0.62);

  ctx.globalAlpha = alpha * 0.85;
  glassPanel(ctx, x, y, width, 32, { radius: 16, alpha: 0.9 });
  ctx.globalAlpha = alpha;
  text(ctx, label, W / 2, y + 21, { size, weight: 600, color: theme.text, align: "center" });
  ctx.globalAlpha = 1;
}

/**
 * HUD'un kapladigi mantiksal bolgeler [x1, y1, x2, y2].
 *
 * Tek kaynak: hem cizim hem de DOM kromunun konumlandirilmasi ve testler
 * bu fonksiyondan beslenir. Onceki surumde koordinatlar cizim kodunda ve
 * testte ayri ayri yaziliydi; HUD degisince test sessizce yanlis bolgeyi
 * olcuyordu.
 */
export function hudZones(W, H) {
  const compact = H > W;
  const margin = compact ? 18 : 30;
  const topY = compact ? 30 : 38;
  const sideWidth = compact ? 96 : 150;
  const chordHalf = Math.min(compact ? (W - margin * 2 - 60) / 2 : 280, W / 2 - margin - sideWidth);
  const dockWidth = Math.min(1180, W * (compact ? 0.94 : 0.78));
  const dockHeight = compact ? 138 : 106;
  const dockY = H - dockHeight - (compact ? 18 : 26);

  return {
    identity: [margin, topY - 22, margin + 160, topY + (compact ? 22 : 26)],
    chord: [W / 2 - chordHalf, topY - 16, W / 2 + chordHalf, topY + (compact ? 72 : 96)],
    tempo: [W - margin - 110, topY - 26, W - margin + 4, topY + (compact ? 46 : 58)],
    dock: [(W - dockWidth) / 2, dockY, (W + dockWidth) / 2, dockY + dockHeight],
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v buildHudView ciktisi
 * @param {object} theme
 * @param {number} W @param {number} H mantiksal sahne olculeri
 */
export function drawCanvasHud(ctx, v, theme, W, H) {
  const compact = H > W;
  const reducedMotion = !!v.reducedMotion;

  // Yumusatilmis degerler: sayilar kare arasinda ziplamasin.
  smooth.level = approachValue(smooth.level, clamp01(v.inputLevel || 0), 0.2);
  smooth.confidence = approachValue(smooth.confidence, clamp01(v.pitchConfidence || 0), 0.12);

  ctx.save();
  ctx.textBaseline = "alphabetic";

  // Ust perde: metinlerin kamera uzerinde okunmasi icin agir golge yerine.
  topScrim(ctx, W, compact ? 150 : 170, 0.5);

  const margin = compact ? 18 : 30;
  const topY = compact ? 30 : 38;

  drawIdentity(ctx, v, theme, margin, topY, compact);

  // Orta blok, sol ve sag bloklarla cakismayacak genislikte.
  const sideWidth = compact ? 96 : 150;
  const chordMaxWidth = Math.min(compact ? W - margin * 2 - 60 : 560, W - (margin + sideWidth) * 2);
  drawChord(ctx, v, theme, W / 2, compact ? topY - 4 : topY, chordMaxWidth, compact);

  drawTempo(ctx, v, theme, W - margin, topY - 12, compact, reducedMotion);

  drawDock(ctx, v, theme, W, H, compact);
  drawGesture(ctx, v, theme, W, H, compact);

  ctx.restore();
}

/** Sahne boyutu degistiginde onbellekleri tazelemek icin. */
export function resetHudState() {
  smooth.level = 0;
  smooth.confidence = 0;
  smooth.chordFade = 1;
  smooth.lastChord = "";
}
