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
  if (!portrait) return { width: 1280, height: 720, portrait: false };
  return {
    width: 720,
    height: Math.round(720 * Math.min(2.25, Math.max(1.35, viewportHeight / Math.max(1, viewportWidth)))),
    portrait: true,
  };
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
