export const CAMERA_PROFILES = Object.freeze([
  { width: 1920, height: 1080, frameRate: 30 },
  { width: 1280, height: 720, frameRate: 30 },
  { width: 960, height: 540, frameRate: 30 },
  { width: 640, height: 480, frameRate: 30 },
  null,
]);

export function fitCover(srcW, srcH, dstW, dstH) {
  const sourceAspect = srcW / Math.max(1, srcH);
  const destinationAspect = dstW / Math.max(1, dstH);
  if (sourceAspect > destinationAspect) {
    const sw = srcH * destinationAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / destinationAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

export function fitContain(srcW, srcH, dstW, dstH) {
  const scale = Math.min(dstW / Math.max(1, srcW), dstH / Math.max(1, srcH));
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

export function sceneSizeForViewport(viewportWidth, viewportHeight) {
  const portrait = viewportHeight > viewportWidth * 1.12;
  const ratio = viewportHeight / Math.max(1, viewportWidth);

  if (!portrait) {
    // Yatayda da oran viewport'tan gelir. Onceki surum her zaman 1280x720
    // donduruyordu; 16:10 dizustu ekranlarinda (1440x900, 1920x1200,
    // 2560x1600) sahne orani kutu oraniyla tutmadigi icin object-fit:cover
    // canvas'in sag ve sol kenarini kirpiyordu - HUD'un tempo blogu ve
    // kimlik blogu kismen ekran disinda kaliyordu.
    let width = 1280;
    let height = Math.round(width * ratio);
    // Cok genis/alcak ekranlarda mantiksal yukseklik asiri kuculmesin.
    if (height < 560) {
      height = 560;
      width = Math.round(height / ratio);
    }
    return { width, height, portrait: false };
  }
  // Sahne orani viewport oraniyla BIREBIR ayni olmali. Onceki surumde oran
  // 1.35-2.25 arasina kelepcelenmisti; bu araligin disindaki ekranlarda
  // (kucuk tablet, bolunmus ekran, cok uzun telefon) canvas ile CSS kutusu
  // farkli oranlara sahip oluyordu ve object-fit:cover HUD'un ust/alt
  // kenarini kirpiyordu. Artik yukseklik sinirlaniyor, oran degil.
  let height = Math.min(1600, Math.round(720 * ratio));
  let width = Math.round(height / ratio);
  if (width < 480) {
    width = 480;
    height = Math.round(480 * ratio);
  }
  return { width, height, portrait: true };
}

export function buildVideoConstraints(profile, { deviceId = "", facingMode = "" } = {}) {
  const selection = deviceId ? { deviceId: { exact: deviceId } } : (facingMode ? { facingMode: { ideal: facingMode } } : {});
  if (!profile) return selection;
  return {
    ...selection,
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    aspectRatio: { ideal: profile.width / profile.height },
    frameRate: { ideal: profile.frameRate, max: 30 },
  };
}

export function shouldMirror(settings, preference = "auto") {
  if (preference === true || preference === "on") return true;
  if (preference === false || preference === "off") return false;
  return settings?.facingMode !== "environment";
}
