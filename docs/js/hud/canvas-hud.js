// CANVAS TABANLI HUD KATMANI
//
// Neden gerekli: paneller HTML/CSS ile ciziliyordu, ancak kayit
// canvas.captureStream() ile alindigi icin videoya YALNIZCA kamera goruntusu
// giriyordu (DOM katmani canvas'a dahil degildir). Bu modul, harmoni.py'deki
// HUDRenderer gibi, bilgi panellerini dogrudan sahne canvas'ina cizer -
// boylece hem ekranda hem de kayitta gorunurler.
//
// Etkilesimli kontroller (secenekler paneli, butonlar) DOM'da kalir; onlarin
// kayda girmemesi zaten istenen davranistir (bir DAW'in mikser penceresinin
// kayda girmemesi gibi).

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function card(ctx, x, y, w, h, theme, { accent = null, alpha = 0.82 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.globalAlpha = alpha * 0.75;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.panel2;
  ctx.stroke();
  if (accent) {
    // Ust kenarda ince aksan seridi.
    ctx.globalAlpha = 1;
    roundRect(ctx, x, y, w, 3, 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }
  ctx.restore();
}

function label(ctx, text, x, y, size, color, weight = "400") {
  ctx.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function measure(ctx, text, size, weight = "400") {
  ctx.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;
  return ctx.measureText(text).width;
}

function pill(ctx, x, y, text, bg, fg, size = 12) {
  const padX = 10;
  const w = measure(ctx, text, size, "600") + padX * 2;
  const h = size + 10;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  label(ctx, text, x + padX, y + h - 7, size, fg, "600");
  return w;
}

/**
 * Sahne canvas'ina tum bilgi panellerini cizer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v - gorunum verisi (bkz. main.js buildHudView)
 * @param {object} theme
 * @param {number} W @param {number} H - tasarim cozunurlugu (1280x720)
 */
export function drawCanvasHud(ctx, v, theme, W, H) {
  ctx.save();
  ctx.textBaseline = "alphabetic";

  const accent = v.tonalSystem === "makam" ? theme.accent : theme.secondary;

  // ---- Sol ust: marka + secili tur ----
  const brandW = 208;
  card(ctx, 20, 18, brandW, 58, theme, { accent });
  label(ctx, "HARMONI", 34, 42, 19, theme.text, "700");
  label(ctx, v.genreLabel || "Serbest mod", 34, 62, 11.5, theme.muted);

  // ---- Ust orta: su an calan eslik ----
  const cw = 430;
  const cx = W / 2 - cw / 2;
  card(ctx, cx, 18, cw, 92, theme, { accent, alpha: 0.86 });
  label(ctx, "ŞU ANKİ EŞLİK", cx + 20, 40, 10.5, theme.muted, "600");
  label(ctx, (v.chordName || "--").slice(0, 22), cx + 20, 74, 30, theme.text, "700");
  label(ctx, `${Math.round(v.bpm)} BPM`, cx + 20, 96, 12, theme.muted);
  pill(ctx, cx + cw - 96, 74, v.tonalBadge, accent, theme.bg, 11);

  // ---- Sag ust: soylenen nota ----
  const nw = 150;
  const nx = W - nw - 20;
  card(ctx, nx, 18, nw, 92, theme, { accent: theme.primary, alpha: 0.86 });
  label(ctx, v.voiced ? "SESİN" : "MİKROFON GİRİŞİ", nx + 18, 40, 10.5, theme.muted, "600");
  if (v.voiced) {
    label(ctx, v.noteName || "--", nx + 18, 76, 32, theme.primary, "700");
    label(ctx, `${v.frequency.toFixed(1)} Hz`, nx + 18, 98, 11, theme.muted);
  } else {
    const meterX = nx + 18;
    const meterY = 57;
    const meterW = nw - 36;
    const level = Math.min(1, Math.max(0, v.inputLevel || 0));
    roundRect(ctx, meterX, meterY, meterW, 9, 4.5);
    ctx.fillStyle = theme.panel2;
    ctx.fill();
    if (level > 0.01) {
      roundRect(ctx, meterX, meterY, Math.max(9, meterW * level), 9, 4.5);
      ctx.fillStyle = level > 0.82 ? theme.warning : theme.primary;
      ctx.fill();
    }
    label(ctx, `Giriş  %${Math.round(level * 100)}`, meterX, 89, 11, level > 0.03 ? theme.text : theme.muted, "600");
  }

  // ---- Sol alt: durum + jest ----
  const sy = H - 96;
  card(ctx, 20, sy, 250, 74, theme, { alpha: 0.78 });
  ctx.beginPath();
  ctx.arc(38, sy + 24, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = v.ready ? theme.success : theme.warning;
  ctx.fill();
  label(ctx, v.statusLabel, 52, sy + 28, 11.5, theme.text, "600");
  label(ctx, (v.gesture || "").slice(0, 30), 34, sy + 48, 11, theme.muted);
  label(ctx, (v.gestureDetail || "").slice(0, 32), 34, sy + 64, 10.5, theme.muted);

  // ---- Alt orta: calan enstrumanlar ----
  const names = v.instruments;
  const text = names.length ? names.join("  ·  ") : "Eşlik için ses bekleniyor";
  const tw = Math.min(W - 620, measure(ctx, text, 12) + 40);
  const ix = W / 2 - tw / 2;
  const iy = H - 74;
  card(ctx, ix, iy, tw, 52, theme, { alpha: 0.8 });
  label(ctx, `ORKESTRA — ${names.length} KATMAN`, ix + 18, iy + 19, 9.5, theme.muted, "600");
  // Tasarsa kirp.
  let shown = text;
  while (shown.length > 8 && measure(ctx, shown, 12) > tw - 36) {
    shown = shown.slice(0, -4) + "…";
  }
  label(ctx, shown, ix + 18, iy + 39, 12, theme.text);

  // ---- Sag alt: dalga formu (yatay, kayda da girsin diye canvas'ta) ----
  const ww = 200;
  const wx = W - ww - 20;
  const wy = H - 96;
  card(ctx, wx, wy, ww, 74, theme, { alpha: 0.78 });
  label(ctx, "CANLI DALGA", wx + 16, wy + 18, 9.5, theme.muted, "600");
  const wf = v.waveform;
  if (wf && wf.length > 1) {
    const midY = wy + 46;
    ctx.beginPath();
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < wf.length; i++) {
      const px = wx + 16 + (i / (wf.length - 1)) * (ww - 32);
      const py = midY - Math.max(-1, Math.min(1, wf[i])) * 20;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ---- Kayit gostergesi (kayitta da gorunur) ----
  if (v.recording) {
    const rt = `● REC  ${v.recordTime}`;
    const rw = measure(ctx, rt, 13, "700") + 24;
    const rx = W / 2 - rw / 2;
    roundRect(ctx, rx, 120, rw, 28, 14);
    ctx.fillStyle = theme.danger;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    label(ctx, rt, rx + 12, 139, 13, "#ffffff", "700");
  }

  ctx.restore();
}
