# Harmoni Web Testleri

## Yerel

```bash
npm install
npm run check:web
npm run test:web
npx playwright install chromium
npm run test:browser
```

`node:test` kapsamı: sessizlik, beyaz gürültü, 110/220/440/880 Hz pitch doğruluğu, stable pitch, phrase attack/release/gap ve otomatik Batı armonisi.

Playwright kapsamı: intro atlama ve CTA, standart Tab gezinimi, 390 px portrede yatay taşma, Chromium masaüstü ve mobil viewport.

## Manuel cihaz matrisi

| Platform | Kamera | Mikrofon | Kayıt | Not |
|---|---:|---:|---:|---|
| Chrome/Edge masaüstü | Gerekli | Gerekli | Gerekli | Birincil hedef |
| Chrome Android | Gerekli | Gerekli | Kontrol | Ön/arka kamera cihaz testi |
| Safari iOS/macOS | Manuel | Manuel | Manuel | MIME ve AudioContext resume özellikle kontrol edilmeli |

Sentetik pitch testleri gerçek oda, mikrofon veya cihaz performansı sonucu olarak sunulmaz.
