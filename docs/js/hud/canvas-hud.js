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

function chamferRect(ctx, x, y, w, h, cut = 10) {
  const c = Math.min(cut, w / 4, h / 4);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function card(ctx, x, y, w, h, theme, { accent = null, alpha = 0.82 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  chamferRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.globalAlpha = alpha * 0.68;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.panel2;
  ctx.stroke();
  if (accent) {
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 1.5);
    ctx.lineTo(x + Math.min(w * 0.42, 180), y + 1.5);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - 18, y + h - 1);
    ctx.lineTo(x + w - 7, y + h - 1);
    ctx.lineTo(x + w - 1, y + h - 7);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
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
  chamferRect(ctx, x, y, w, h, 6);
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

  // ---- Sag ust: canli tempo ----
  const nw = 150;
  const nx = W - nw - 20;
  card(ctx, nx, 18, nw, 92, theme, { accent: theme.primary, alpha: 0.86 });
  label(ctx, "TEMPO", nx + 18, 40, 10.5, theme.muted, "600");
  label(ctx, String(Math.round(v.bpm)), nx + 18, 76, 30, theme.primary, "700");
  label(ctx, "BPM", nx + 74, 74, 10, theme.muted, "700");
  const beatMs = 60000 / Math.max(1, v.bpm);
  const beatIndex = Math.floor(Date.now() / beatMs) % 4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(nx + 82 + i * 14, 94, i === beatIndex ? 4 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = i === beatIndex ? theme.primary : theme.panel2;
    ctx.fill();
  }

  // ---- Alt bilgi satiri: durum ve orkestra ----
  const infoY = H - 154;
  card(ctx, 20, infoY, 250, 48, theme, { alpha: 0.8 });
  ctx.beginPath();
  ctx.arc(38, infoY + 18, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = v.ready ? theme.success : theme.warning;
  ctx.fill();
  label(ctx, v.statusLabel, 52, infoY + 22, 11.5, theme.text, "600");
  const gestureText = [v.gesture, v.gestureDetail].filter(Boolean).join(" · ").slice(0, 42);
  label(ctx, gestureText || "Hareket bekleniyor", 34, infoY + 39, 10, theme.muted);

  // ---- Calan enstrumanlar ----
  const names = v.instruments;
  const text = names.length ? names.join("  ·  ") : "Eşlik için ses bekleniyor";
  const ix = 284;
  const iw = W - ix - 20;
  card(ctx, ix, infoY, iw, 48, theme, { alpha: 0.82 });
  label(ctx, `ORKESTRA · ${names.length} KATMAN`, ix + 16, infoY + 17, 9, theme.muted, "600");
  let shown = text;
  while (shown.length > 8 && measure(ctx, shown, 11) > iw - 32) {
    shown = shown.slice(0, -4) + "…";
  }
  label(ctx, shown, ix + 16, infoY + 36, 11, theme.text);

  // ---- Gelismis ses analizi seridi ----
  const ax = 20;
  const ay = H - 94;
  const aw = W - 40;
  const ah = 72;
  card(ctx, ax, ay, aw, ah, theme, { accent: theme.primary, alpha: 0.9 });

  const cells = [
    { label: "NOTA", value: v.voiced ? v.noteName : "—", width: 86, color: theme.primary },
    { label: "FREKANS", value: v.voiced ? `${v.frequency.toFixed(1)} Hz` : "—", width: 118 },
    { label: "TEMPO", value: `${Math.round(v.bpm)} BPM`, width: 100 },
    { label: "NETLİK", value: v.voiced ? `%${Math.round((v.pitchConfidence || 0) * 100)}` : "—", width: 92 },
    { label: "SAPMA", value: v.voiced ? `${v.pitchCents >= 0 ? "+" : ""}${v.pitchCents.toFixed(0)} ct` : "—", width: 92 },
  ];
  label(ctx, "SES ANALİZİ", ax + 16, ay + 19, 9, theme.muted, "700");
  let cellX = ax + 112;
  for (const item of cells) {
    ctx.beginPath();
    ctx.moveTo(cellX, ay + 13);
    ctx.lineTo(cellX, ay + ah - 13);
    ctx.strokeStyle = theme.panel2;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 1;
    label(ctx, item.label, cellX + 13, ay + 22, 8.5, theme.muted, "600");
    label(ctx, item.value, cellX + 13, ay + 49, 15, item.color || theme.text, "700");
    cellX += item.width;
  }

  const rhythmX = cellX + 13;
  const rhythmW = 126;
  label(ctx, "VURUŞ", rhythmX, ay + 22, 8.5, theme.muted, "600");
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(rhythmX + 8 + i * 25, ay + 42, i === beatIndex ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === beatIndex ? theme.primary : theme.panel2;
    ctx.fill();
  }
  label(ctx, "4 / 4", rhythmX + 101, ay + 46, 9, theme.muted, "600");

  const waveX = rhythmX + rhythmW + 24;
  const waveW = ax + aw - waveX - 16;
  label(ctx, "CANLI DALGA", waveX, ay + 19, 8.5, theme.muted, "600");
  const wf = v.waveform;
  if (wf && wf.length > 1 && waveW > 40) {
    const midY = ay + 45;
    ctx.beginPath();
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < wf.length; i++) {
      const px = waveX + (i / (wf.length - 1)) * waveW;
      const py = midY - Math.max(-1, Math.min(1, wf[i])) * 17;
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
