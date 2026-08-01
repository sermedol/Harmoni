// Yeni gorsel modul (Python'daki _draw_waveform'un dikey/yan panel versiyonu
// - kullanicinin istegiyle Basit Mod'da yan tarafa eklendi). Genislik=genlik,
// yukseklik=zaman ekseninde dikey bir osiloskop cizer.
export function drawSideWaveform(ctx, waveform, theme, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = theme.panel2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 4);
  ctx.lineTo(width / 2, height - 4);
  ctx.stroke();

  if (!waveform || waveform.length < 2) return;
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const n = waveform.length;
  for (let i = 0; i < n; i++) {
    const y = 4 + (i / (n - 1)) * (height - 8);
    const amp = Math.max(-1, Math.min(1, waveform[i]));
    const x = width / 2 + amp * (width * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
