# Harmoni — Müzikal Denetim (2026-08)

Bu belge, kod değiştirilmeden önce mevcut müzikal çekirdeğin **fiilen ne
yaptığını** kayıt altına alır. İddia değil, dosya ve satır referanslı gözlem.

Denetlenen sürüm: `20260802-06` (commit `6bff8ff` sonrası).

---

## 1. Sinyal yolu — mikrofondan çıkışa

```
getUserMedia
  → MediaStreamSource                      audio-graph.js:_acquireMicrophone
  → AudioWorkletNode "harmoni-processor"    (1 giriş, 2 çıkış)
        ├─ PitchTracker.submit(mono)        ham mikrofon, DSP'den ÖNCE
        ├─ VocalDSP.process(mono)           HPF→gate→EQ→komp→doygunluk→reverb→limit
        └─ SynthEngine.render(frames)       orkestra
  → çıkış 0 (MonitorBus) → ctx.destination
  → çıkış 1 (RecordBus)  → MediaStreamDestination → MediaRecorder
```

**Doğrulandı:** Perde analizi `mono` üzerinden, VocalDSP'den **önce** yapılıyor
(`harmoni-processor.js:84`). Bu doğru: gate/kompresör perde tahminini bozmaz.

**Doğrulandı — MonitorBus / RecordBus ayrımı** (`harmoni-processor.js:109-118`):

```js
const monitorMix = synthCh[i] + (this.monitorEnabled ? vocal : 0);
const recordMix  = synthCh[i] + vocal;          // her zaman vokal dahil
```

`monitorEnabled` yalnızca hoparlöre giden yolu etkiler. **RecordBus işlenmiş
vokali her koşulda taşır.** Kabul kriteri karşılanıyor.

İki veri yolu aynı limitleyiciden geçiyor (`tanh(x*1.06)/tanh(1.06)`), yani
müzikal miks aynı. Fark yalnızca vokalin varlığı.

---

## 2. Perde verisi

- `PitchTracker.submit()` her quantum'da çağrılıyor, `stablePitch` ayrı tutuluyor.
- Telemetri **her quantum'da değil**, `telemetryEveryNQuanta` ile seyrekleştirilmiş.
- `state.pitch` ve `state.stablePitch` main thread'e postMessage ile geçiyor.

---

## 3. Armoni — en ciddi bulgu

`western-harmony-engine.js` **bir armoni motoru değil, tonalite dedektörüdür.**

| İddia | Gerçek | Kanıt |
|---|---|---|
| Akor yürüyüşü üretir | Üretmiyor | satır 45: `if (this.current?.id === id) return null;` |
| Fonksiyon adı verir | Sabit `"I"` | satır 59 |
| Mod desteği var | Yalnız majör/minör | satır 1-2, 37 |
| Akor çeşitliliği | Yalnız kök üçlü | satır 57: `[root, root+3ya da4, root+7]` |

**En kritik sonuç:** satır 45 nedeniyle tonalite bir kez oturduğunda motor
`null` döndürür. Yani **tonalite değişmedikçe akor hiç değişmez**. Kullanıcı
bir tonalitede şarkı söylediği sürece eşlik tek bir statik üçlüde kalır.

Bu, brief §2C'de "gerçek akor yürüyüşü oluşturmuyor" tespitinden daha
ağırdır: yürüyüş yok, **akor değişimi de yok**.

Arayüzde dorian/mixolydian gibi modlar seçilebiliyor
(`tonal-systems.js`) ama otomatik motor bunları hiç üretmiyor — yalnızca
kullanıcı elle seçerse `chordNotes` o dizinin notalarıyla dolduruluyor.

---

## 4. Ritim ve zamanlama

`synth-engine.js:_scheduleStep`:

```js
const step = this.stepIndex % 8;
const beatSeconds = 60.0 / music.bpm;
```

- Sekiz adım, her adım **yarım vuruş** → ölçü fiilen sabit **4/4**.
- `meter`, `beatGroups`, `bar`, `downbeat`, `fill`, `pickup` kavramı **yok**.
- 3/4, 6/8, 7/8, 9/8 seçilse bile aynı sekiz adım çalışır.
- Türk usulleri temsil edilmiyor.
- Zaman kaynağı `samplesToStep` sayacı — **sample clock'a bağlı** (doğru),
  ama ölçü kavramı olmadığı için quantization "adım" düzeyinde kalıyor.

**Adım eşlemesi (Batı, `_scheduleWesternStep`):**

| Katman | Tetiklenen adımlar |
|---|---|
| PIANO | 0,4 (akor değişiminde), 2,6 (soft) |
| BASS | 0,4 |
| STRINGS / PAD | akor değişiminde 0,4 |
| WOODWINDS | akor değişiminde 2,6 |
| BRASS | 0,4 (vokal aktif değilse) |
| BAGLAMA / GITAR | 1,3,5,7 |
| KEMAN | 2,6 (vokal aktif değilse) |
| DAVUL | 0,4 (dum) / 2,6 (tek) |
| DRUMS | kick 0,4 / snare 2,6 |

Her tür için aynı tablo. **Groove farkı yok.**

---

## 5. Genre profilleri

`genres.js` her tür için yalnız dört alan taşıyor:

```js
{ id, label, hint, tonal, layers, bpm }
```

Yani tür değiştirmek = **dizi + kadro + tempo** değiştirmek. Ritim kalıbı,
voicing, akor dağarcığı, artikülasyon, mix veya reverb farkı **yok**.

Rock ile pop aynı davul kalıbını, arabesk ile klasik aynı yaylı voicing'ini
kullanıyor. Brief §21'deki tespit doğrulandı.

---

## 6. Makam

`_scheduleMakamStep`:

- Makam bir **derece listesi** (`makamDegrees`) olarak ele alınıyor.
- Seyir, yeden, çeşni, asma karar, geçki **yok**.
- Melodik kalıp sabit: `[0, 2, 1, 4, 3, 2, 1, 0]` — her ölçüde aynı.
- Usul katmanı yok; davul 0/4-2/6 ile 4/4 davranıyor.
- **Kesirli MIDI korunuyor** (yuvarlama yok) — bu doğru çalışıyor.

### 6.1 Doğrulanan ve düzeltilen hata

Brief §2D'nin öngördüğü hata **gerçekti ve düzeltildi**:

| Sorun | Eski davranış |
|---|---|
| `pad` katman kontrolsüz | PAD kapalıyken drone çalıyordu |
| `baglama` katman kontrolsüz | BAGLAMA kapalıyken bağlama çalıyordu |
| PIANO dalı yok | Makamda "yalnız piyano" = piyano **susuyor**, pad+bağlama çalıyor |

Ölçüm (`tests/web/layer-gating.test.js`, düzeltmeden önce):

```
makam + yalnız PIANO  →  duyulan: baglama, pad     (piyano YOK)
tam orkestra → muteExtras  →  duyulan: baglama, pad
```

Düzeltme: pad ve bağlama `layers.has()` arkasına alındı; makam için piyanoya
durak/güçlü üzerinde **açık beşli seyrek pedal** dalı eklendi (Batı üçlüsü
basmaması için). Yedi regresyon testi eklendi.

---

## 7. Miks

- **Ducking:** `duckGain` tek bir geniş bantlı skaler; `DUCK_RATE` yarım-blok
  başına uyarlanmış (`halfBlockRate(0.12)`). Frekans seçici değil.
- **Gain telafisi:** `sqrt(5/layerCount)` — **açık ama o an çalmayan** katmanlar
  da gain'i düşürüyor. Brief §22'deki tespit doğru.
- **Reverb:** tek paylaşımlı `MultiTapReverb`, `reverbMix` sabit 0.15.
  Per-bus send **yok**; kick ile pad aynı reverb'ü alıyor.
- **Limitleyici:** `tanh(x*1.06)/tanh(1.06)` + clamp. Master seviyesinde çalışıyor.
- Bus mimarisi yok; tüm sesler tek toplama noktasında.

---

## 8. Enstrüman sesleri

`voices.js` tamamen sentez: osilatör + harmonik + gürültü + Karplus–Strong.
**Gerçek enstrüman örneği yok.** Arayüzde "Piyano", "Ney", "Bağlama" adları
kullanılıyor ama bunlar sentez yaklaşımları.

Brief §2A doğrulandı: bu motor hafif fallback olarak korunmalı, "gerçek
enstrüman" diye sunulmamalı.

---

## 9. Worklet performansı

`process()` içinde her quantum'da yeni tahsis edilenler:

- `new Float64Array(frames)` (mono)
- `VocalDSP.process` içinde `work`, `left`, `right`
- `MultiTapReverb.process` içinde `wetL/wetR/echoL/echoR` + `feedbackL/R`
- `SynthEngine.render` çıkış tamponları

Sample engine eklenmeden önce bunların havuzlanması gerekir. Şu an ölçülebilir
bir sorun yaratmıyor ama sample voice'lar eklendiğinde GC baskısı artar.

Olumlu: worklet içinde `fetch`, `decodeAudioData`, `JSON.parse`, DOM erişimi
**yok**. Telemetri seyrekleştirilmiş.

---

## 10. Çelişen belge ve yorumlar

- `synth-engine.js:1` "harmoni.py SynthEngine - birebir port" diyor; ancak
  `harmoni.py` içindeki AutoArranger mantığı web sürümünde kullanıcı seçimine
  dönüştürülmüş (`genres.js` başlığı bunu söylüyor). İki yorum çelişiyor.
- `themes.js` eskiden dört tema tanımlıyordu ama uygulama tek temayı zorluyordu
  (bu tur temizlendi).

---

## 11. Özet

### Çalışanlar
Perde analizi, stabil perde, vokal DSP zinciri, MonitorBus/RecordBus ayrımı,
kesirli MIDI korunması, sample-clock tabanlı adım sayacı, katman aç/kapa
(Batı modunda), jest kontrolleri, kayıt hattı.

### Yüzeysel çalışanlar
Genre profilleri (yalnız kadro+tempo), makam eşliği (derece listesi),
"tam orkestra" (hepsini aynı anda açmak), reverb (tek send), gain telafisi.

### Gerçek hatalar
1. **Makam katman kapısı** — düzeltildi, teste bağlandı.
2. **Akor hiç değişmiyor** — tonalite sabitken motor `null` döndürüyor.
3. **`functionName` sabit `"I"`** — gerçek fonksiyon üretilmiyor.

### Riskli kod
Worklet'te quantum başına tahsisler; sample engine öncesi havuzlanmalı.

---

## 12. Sonraki adımlar

Brief §32'deki aşama planına göre:

- **AŞAMA 1** — bu belge + makam hatası + regresyon testleri → **tamam**
- **AŞAMA 2** — Transport / Meter / RhythmPattern → bu turda başlandı
- **AŞAMA 3** — Sample engine → **asset tedariki gerekiyor** (bkz. §13)
- **AŞAMA 4** — Gerçek armoni motoru
- **AŞAMA 5-8** — Arrangement, makam, paketler, QA

---

## 13. Bu ortamda yapılamayanlar

Dürüstlük gereği açıkça yazılmıştır:

- **Gerçek sample paketleri indirilemez.** VSCO 2, Salamander, VCSL, Virtuosity
  gibi kütüphaneleri indirip lisanslarını indirme tarihinde doğrulayıp
  onlarca MB'lık ses dosyasını repository'ye eklemek bu ortamda mümkün değil.
  Sampler **motoru** yazılabilir; **içeriği** yazılamaz.
- **Müzisyen dinleme testi yapılamaz** (§31). Hiçbir profil bu nedenle
  `verified` işaretlenmemelidir.
- **Bağlama/ney kayıt oturumu yapılamaz** (§10).

Bu üçü tamamlanmadan §33'teki "en az bir gerçek sample-based piyano çalışıyor"
kriteri karşılanamaz.
