// Harmoni performance HUD. Everything here is drawn onto the scene canvas so
// recordings contain the same instrument display the performer sees.

const FONT = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const MONO = '"Cascadia Mono", "SFMono-Regular", monospace';

function text(ctx, value, x, y, size, color, weight = 500, align = "left", family = FONT) {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(value), x, y);
}

function fitText(ctx, value, maxWidth, size, weight = 500, family = FONT) {
  ctx.font = `${weight} ${size}px ${family}`;
  let output = String(value);
  if (ctx.measureText(output).width <= maxWidth) return output;
  while (output.length > 3 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function line(ctx, x1, y1, x2, y2, color, width = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function corner(ctx, x, y, sx, sy, color, length = 15) {
  line(ctx, x, y, x + sx * length, y, color, 1.4, 0.8);
  line(ctx, x, y, x, y + sy * length, color, 1.4, 0.8);
}

function glass(ctx, x, y, w, h, theme, alpha = 0.74) {
  ctx.save();
  const gradient = ctx.createLinearGradient(x, y, x, y + h);
  gradient.addColorStop(0, `${theme.panel}f2`);
  gradient.addColorStop(1, `${theme.bg}e8`);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.56;
  ctx.strokeStyle = theme.panel2;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

function drawBeat(ctx, x, y, bpm, theme, spacing = 17) {
  const duration = 60000 / Math.max(1, bpm);
  const phase = (performance.now() % duration) / duration;
  const active = Math.floor(performance.now() / duration) % 4;
  for (let i = 0; i < 4; i++) {
    const r = i === active ? 3.3 + (1 - phase) * 2.4 : 2.2;
    ctx.beginPath();
    ctx.arc(x + i * spacing, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === active ? theme.primary : theme.panel2;
    ctx.fill();
  }
  return active;
}

function drawWave(ctx, waveform, x, y, w, h, color) {
  line(ctx, x, y + h / 2, x + w, y + h / 2, color, 0.7, 0.2);
  if (!waveform || waveform.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.lineWidth = 1.35;
  for (let i = 0; i < waveform.length; i++) {
    const px = x + (i / (waveform.length - 1)) * w;
    const py = y + h / 2 - Math.max(-1, Math.min(1, waveform[i])) * h * 0.42;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function metric(ctx, label, value, x, y, theme, width) {
  text(ctx, label, x, y, 8, theme.muted, 700, "left", MONO);
  text(ctx, fitText(ctx, value, width, 14, 650, MONO), x, y + 23, 14, theme.text, 650, "left", MONO);
}

export function drawCanvasHud(ctx, v, theme, W, H) {
  ctx.save();
  const now = performance.now();
  const safe = 22;
  const accent = v.tonalSystem === "makam" ? theme.accent : theme.primary;

  // Subtle cinematic framing — camera remains the interface, not a dashboard.
  const vignette = ctx.createRadialGradient(W / 2, H * 0.43, H * 0.12, W / 2, H * 0.45, W * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.72, "rgba(8,2,5,.08)");
  vignette.addColorStop(1, "rgba(8,2,5,.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  corner(ctx, safe, safe, 1, 1, accent, 28);
  corner(ctx, W - safe, safe, -1, 1, accent, 28);
  corner(ctx, safe, H - safe, 1, -1, accent, 28);
  corner(ctx, W - safe, H - safe, -1, -1, accent, 28);

  // Left identity rail.
  text(ctx, "HARMONİ", 34, 46, 17, theme.text, 760);
  text(ctx, "PERFORMANS / 01", 34, 63, 8, theme.muted, 650, "left", MONO);
  line(ctx, 34, 73, 182, 73, accent, 2, 0.8);
  const statusColor = v.ready ? theme.success : theme.warning;
  ctx.beginPath(); ctx.arc(35, 91, 3.5, 0, Math.PI * 2); ctx.fillStyle = statusColor; ctx.fill();
  text(ctx, fitText(ctx, v.statusLabel || "Hazırlanıyor", 145, 9, 600), 46, 94, 9, theme.text, 600);

  // Central musical readout: typography and rails instead of another card.
  const centerY = 48;
  text(ctx, "ŞU ANKİ EŞLİK", W / 2, 27, 8, theme.muted, 700, "center", MONO);
  text(ctx, fitText(ctx, v.chordName || "—", 360, 31, 720), W / 2, centerY + 14, 31, theme.text, 720, "center");
  text(ctx, `${v.tonalBadge || "BATI"}  ·  ${v.genreLabel || "SERBEST"}`, W / 2, centerY + 34, 9, accent, 700, "center", MONO);
  line(ctx, W / 2 - 215, 89, W / 2 + 215, 89, theme.panel2, 1, 0.72);
  const scanX = W / 2 - 215 + ((now / 7) % 430);
  line(ctx, scanX - 35, 89, scanX, 89, accent, 2, 0.75);

  // Right tempo rail — large enough to glance at, compact enough not to cover video.
  text(ctx, "TEMPO", W - 34, 31, 8, theme.muted, 700, "right", MONO);
  text(ctx, Math.round(v.bpm), W - 34, 60, 27, theme.text, 720, "right", MONO);
  text(ctx, "BPM", W - 34, 75, 8, accent, 700, "right", MONO);
  drawBeat(ctx, W - 91, 92, v.bpm, theme, 19);

  // Gesture reticle only appears when a meaningful gesture exists.
  if (v.gesture && v.gesture !== "NONE") {
    const pulse = 0.5 + Math.sin(now / 260) * 0.16;
    ctx.save(); ctx.globalAlpha = pulse;
    corner(ctx, W / 2 - 58, H * 0.49 - 26, 1, 1, accent, 12);
    corner(ctx, W / 2 + 58, H * 0.49 - 26, -1, 1, accent, 12);
    text(ctx, fitText(ctx, v.gestureDetail || v.gesture, 150, 9, 650), W / 2, H * 0.49 + 34, 9, theme.text, 650, "center", MONO);
    ctx.restore();
  }

  // One unified performance console.
  const deckX = safe;
  const deckH = 112;
  const deckY = H - deckH - safe;
  const deckW = W - safe * 2;
  glass(ctx, deckX, deckY, deckW, deckH, theme, 0.83);
  line(ctx, deckX, deckY, deckX + deckW, deckY, accent, 1.5, 0.9);

  text(ctx, "LIVE INPUT", deckX + 14, deckY + 18, 8, accent, 750, "left", MONO);
  const note = v.voiced ? v.noteName : "—";
  text(ctx, note, deckX + 14, deckY + 55, 31, theme.text, 720, "left", MONO);
  text(ctx, v.voiced ? `${v.frequency.toFixed(1)} Hz` : "SES BEKLENİYOR", deckX + 15, deckY + 76, 9, theme.muted, 600, "left", MONO);
  const confidence = Math.max(0, Math.min(1, v.pitchConfidence || 0));
  line(ctx, deckX + 15, deckY + 93, deckX + 133, deckY + 93, theme.panel2, 3, 0.75);
  line(ctx, deckX + 15, deckY + 93, deckX + 15 + 118 * confidence, deckY + 93, accent, 3, 0.95);

  const metricX = deckX + 164;
  metric(ctx, "FREKANS", v.voiced ? `${v.frequency.toFixed(1)} Hz` : "—", metricX, deckY + 26, theme, 92);
  metric(ctx, "SAPMA", v.voiced ? `${v.pitchCents >= 0 ? "+" : ""}${v.pitchCents.toFixed(0)} ct` : "—", metricX + 105, deckY + 26, theme, 76);
  metric(ctx, "NETLİK", v.voiced ? `%${Math.round(confidence * 100)}` : "—", metricX + 194, deckY + 26, theme, 62);
  metric(ctx, "VURUŞ", `${Math.round(v.bpm)} BPM`, metricX + 271, deckY + 26, theme, 82);
  drawBeat(ctx, metricX + 276, deckY + 76, v.bpm, theme, 18);

  const waveX = metricX + 370;
  const waveW = Math.max(120, deckX + deckW - waveX - 18);
  text(ctx, "CANLI SES İZİ", waveX, deckY + 18, 8, theme.muted, 700, "left", MONO);
  drawWave(ctx, v.waveform, waveX, deckY + 29, waveW, 48, accent);

  const names = v.instruments || [];
  const orchestra = names.length ? names.join("  ·  ") : "Eşlik için ses bekleniyor";
  text(ctx, `ORKESTRA / ${names.length} KATMAN`, metricX, deckY + 90, 8, theme.muted, 700, "left", MONO);
  text(ctx, fitText(ctx, orchestra, Math.max(120, waveX - metricX - 18), 9, 550), metricX, deckY + 105, 9, theme.text, 550);

  if (v.recording) {
    ctx.fillStyle = theme.danger;
    ctx.beginPath(); ctx.arc(W / 2 - 37, 116, 4, 0, Math.PI * 2); ctx.fill();
    text(ctx, `REC ${v.recordTime}`, W / 2 - 26, 120, 10, theme.text, 700, "left", MONO);
  }

  ctx.restore();
}
