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
/**
 * Ses izi — akiskan, katmanli dalga seridi.
 *
 * Onceki surum tek 1.3px'lik duz bir polyline ciziyordu; dock'ta neredeyse
 * gorunmuyordu. Yeni cizim referanstaki "akan serit" hissini bordo palette
 * kurar:
 *   - Uc katman, birbirine gore faz ve genlik kaydirmali (derinlik)
 *   - Yatay gradient dolgu (gul -> terracotta -> gul), kenarlarda soner
 *   - Katmanlar arasinda cok saydam dolgu (serit kutlesi)
 *   - Tepe noktalarinda kucuk parcaciklar
 * Ses yokken bile sakin bir dalga akar; seviye geldikce genlik ve parlaklik
 * artar. Boylece alan "olu" gorunmez ve kullanicinin dikkatini ceker.
 *
 * Performans: gradient x/w/renk anahtariyla onbelleklenir, her karede
 * yeniden uretilmez. shadowBlur kullanilmaz.
 */
function drawWave(ctx, waveform, x, y, w, h, theme, level, now, reducedMotion) {
  const midY = y + h / 2;
  const gradient = waveGradient(ctx, x, w, theme);
  const hasSignal = waveform && waveform.length > 1;
  // Sessizken bile GORUNUR bir akis olur; ses geldikce buyur. Taban deger
  // dusuk tutulursa serit duz bir cizgiye donuyor ve alan olu gorunuyor.
  const drive = 0.58 + level * 0.42;
  const phase = reducedMotion ? 0 : now / 1000;
  // Sinyal yokken tasiyici dalga tek basina calisir; varsa ikisi karisir.
  const signalWeight = hasSignal ? 0.6 : 0;
  const carrierWeight = hasSignal ? 0.4 : 1;

  // --- Katmanlar: arkadan one dogru --------------------------------------
  // Frekanslar birbirine gore asal olmayan oranlarda secildi ki katmanlar
  // ust uste binip tek bir kalin cizgiye donmesin. Genis olcuda 3-4 gorunur
  // salinim olusur; tek bir kambur "olu cizgi" gibi okunuyordu.
  const layers = [
    { amp: 0.34, freq: 3.3, speed: 0.62, alpha: 0.26, width: 1.0, offset: 0.0 },
    { amp: 0.48, freq: 2.4, speed: -0.44, alpha: 0.40, width: 1.4, offset: 1.7 },
    { amp: 0.62, freq: 1.7, speed: 0.30, alpha: 1.0, width: 2.1, offset: 3.4 },
  ];

  const samples = Math.max(28, Math.min(120, Math.round(w / 5)));
  const pointsY = new Array(samples);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    const amplitude = h * 0.72 * layer.amp * drive;

    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const px = x + t * w;

      // Sinyal varsa dalga formunu, yoksa yumusak bir tasiyici kullan.
      let value;
      if (hasSignal) {
        const index = Math.min(waveform.length - 1, Math.round(t * (waveform.length - 1)));
        value = Math.max(-1, Math.min(1, waveform[index]));
      } else {
        value = 0;
      }
      // Tasiyici dalga: katmanlara faz farki vererek derinlik yaratir.
      const carrier = Math.sin(t * Math.PI * 2 * layer.freq + phase * layer.speed + layer.offset);
      // Kenarlarda soner: serit havada asili gorunur.
      const envelope = Math.sin(t * Math.PI) ** 0.7;
      const py = midY - (value * signalWeight + carrier * carrierWeight) * amplitude * envelope;

      if (layerIndex === layers.length - 1) pointsY[i] = py;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }

    ctx.globalAlpha = layer.alpha * (0.68 + level * 0.32);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = layer.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // On katmanin altini cok saydam doldur: serit kutlesi hissi.
    if (layerIndex === layers.length - 1) {
      ctx.lineTo(x + w, midY);
      ctx.lineTo(x, midY);
      ctx.closePath();
      ctx.globalAlpha = 0.16 * (0.5 + level * 0.5);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  // --- Parcaciklar: tepe noktalarinda kucuk isik noktalari ----------------
  if (!reducedMotion) {
    ctx.fillStyle = theme.primary;
    for (let i = 2; i < samples - 2; i += 7) {
      const px = x + (i / (samples - 1)) * w;
      const py = pointsY[i];
      const distance = Math.abs(py - midY) / (h * 0.5);
      if (distance < 0.18) continue;                 // merkeze yapisanlari atla
      ctx.globalAlpha = 0.16 + distance * 0.5 * (0.4 + level * 0.6);
      ctx.beginPath();
      ctx.arc(px, py, 1.1 + distance * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
}

/** Yatay serit gradyani. Boyut/renk anahtariyla onbelleklenir. */
const waveGradients = new Map();
function waveGradient(ctx, x, w, theme) {
  const key = `${Math.round(x)}:${Math.round(w)}:${theme.primary}:${theme.secondary}`;
  const existing = waveGradients.get(key);
  if (existing) return existing;
  const gradient = ctx.createLinearGradient(x, 0, x + w, 0);
  gradient.addColorStop(0, hexToRgba(theme.primary, 0.15));
  gradient.addColorStop(0.22, theme.primary);
  gradient.addColorStop(0.5, theme.secondary);
  gradient.addColorStop(0.78, theme.primary);
  gradient.addColorStop(1, hexToRgba(theme.primary, 0.15));
  if (waveGradients.size > 24) waveGradients.clear();
  waveGradients.set(key, gradient);
  return gradient;
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
  const height = compact ? 150 : 120;
  const x = (W - width) / 2;
  // hudZones ile ayni deger: alt bosluk imza icin ayrilir.
  // Alt bosluk imza icin ayrilir (DOM .feza-signature dock altinda, ortada).
  const y = H - height - 52;

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
  text(ctx, "Ses izi", waveX, y + 24, { size: 10, weight: 600, color: theme.muted });
  drawWave(ctx, v.waveform, waveX, y + 28, waveWidth, 78, theme, smooth.level, performance.now(), v.reducedMotion);

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
  drawWave(ctx, v.waveform, innerX, waveY, waveWidth, 46, theme, smooth.level, performance.now(), v.reducedMotion);

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
  const dockHeight = compact ? 150 : 120;
  // Alt bosluk imza icin ayrilir (DOM'daki .feza-signature dock'un altinda,
  // ortada durur). Deger degisirse layout.css'teki imza da kayar.
  const dockY = H - dockHeight - 52;

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
  // Serit gradyani boyuta ve temaya bagli onbelleklenir; sahne yeniden
  // olculendiginde tazelenmeli.
  waveGradients.clear();
}
