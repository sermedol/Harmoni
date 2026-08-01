// Yeni modul (Python'da karsiligi yok - scipy.fft dogrudan kullaniliyordu).
// Yerlesik bir JS FFT olmadigindan, PitchTracker'in FFT-otokorelasyon
// yontemini (Milestone 6) desteklemek icin kucuk, bagimsiz bir yerinde
// (in-place) radix-2 Cooley-Tukey FFT. Uzunluk 2'nin kuvveti olmalidir.

/**
 * Yerinde karmasik FFT/IFFT. re/im: ayni uzunlukta Float64Array (uzunluk 2^k).
 * invert=true ise ters donusum uygulanir (1/N ile olceklenir).
 */
export function fftInPlace(re, im, invert = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (invert ? 1 : -1) * (2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * scipy'nin irfft(fft(x) * conj(fft(x))) ile ayni sonucu (dairesel
 * otokorelasyon) verir - x, N=2^k uzunluguna sifir-doldurulmus olmalidir
 * (dogrusal otokorelasyonun dairesel sarmadan etkilenmemesi icin PitchTracker
 * tarafindan pencere boyunun ~2 katina yuvarlanir). Donen dizinin yalnizca
 * ilk N/2 elemani anlamlidir (PitchTracker sadece kisa gecikmeleri arar).
 */
export function autocorrelateFFT(x) {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fftInPlace(re, im, false);
  for (let i = 0; i < n; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    re[i] = power;
    im[i] = 0;
  }
  fftInPlace(re, im, true);
  return re; // im ~= 0 (gercek girdi icin guc spektrumu ciftsimetriktir)
}
