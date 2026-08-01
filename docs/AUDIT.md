# Harmoni Web Gerçek Davranış Denetimi

Tarih: 2026-08-01  
Kapsam: `docs/` web uygulamasının gerçek import, mesaj protokolü ve runtime state yolları. Eski milestone yorumları kanıt olarak kullanılmadı.

## Runtime lifecycle

### AUD-001
- Önem: **critical**
- Dosya: `docs/js/main.js`
- Fonksiyon veya selector: `startExperience()`, `renderLoop()`
- Mevcut davranış: Başlatma kilidi yoktur. Hızlı/tekrarlı çağrı yeni `Camera`, `AudioGraph` ve sonsuz `requestAnimationFrame` döngüsü oluşturabilir.
- Beklenen davranış: Başlatma idempotent olmalı ve yaşam döngüsü tek kaynaktan yönetilmelidir.
- Önerilen düzeltme: Açık lifecycle durumları, start promise/kilidi ve tek render-loop kimliği ekle.
- Doğrulama yöntemi: `startExperience()` iki kez çağrıldığında tek AudioContext, tek kamera stream’i ve tek RAF sayacı testi.

### AUD-002
- Önem: **high**
- Dosya: `docs/js/main.js`, `docs/js/audio/audio-graph.js`, `docs/js/camera/camera.js`
- Fonksiyon veya selector: `visibilitychange`, `pagehide`, `stop()`
- Mevcut davranış: Sayfa gizlenmesi/kapanması için merkezi durdurma yoktur; kamera, mikrofon ve kayıt güvenli kapatılmaz.
- Beklenen davranış: Gizlenmede inference/HUD azaltılmalı, kapanışta bütün track/context/recorder kapatılmalıdır.
- Önerilen düzeltme: Lifecycle controller ve `destroy()` yolu ekle.
- Doğrulama yöntemi: Track `readyState`, AudioContext state ve RAF sayaçlarının pagehide sonrası kontrolü.

## Camera lifecycle

### AUD-003
- Önem: **high**
- Dosya: `docs/js/main.js`, `docs/js/camera/camera.js`
- Fonksiyon veya selector: `tryStartCamera()`, `Camera.start()`
- Mevcut davranış: Tekrar denemeden önce önceki stream durdurulmaz; track `ended`/`mute` olayları UI’a aktarılmaz.
- Beklenen davranış: Eski stream temizlenmeli ve fiziksel kamera kesintisi görünür durum olmalıdır.
- Önerilen düzeltme: Retry öncesi `camera.stop()`, track olayları ve capability state ekle.
- Doğrulama yöntemi: Sahte track olaylarıyla kamera durum testi.

### AUD-004
- Önem: **critical**
- Dosya: `docs/js/camera/hand-tracker.js`, `docs/js/main.js`
- Fonksiyon veya selector: `HandTracker.init()`, `handTracker.process(sceneCanvas, ...)`
- Mevcut davranış: MediaPipe yalnız GPU delegate dener, timeout/CPU fallback yoktur. Çıkarım kaynağı kamera değil; aynı tam çözünürlük canvas üzerindeki önceki HUD/iskelet kalıntılarını da içerebilir.
- Beklenen davranış: Ayrı düşük çözünürlüklü inference canvas, GPU→CPU fallback, timeout ve kullanıcı durumu olmalıdır.
- Önerilen düzeltme: Kamera frame’ini ayrı inference canvas’a çiz; model init timeout ve CPU retry ekle.
- Doğrulama yöntemi: GPU init reddi ve CDN hata enjeksiyonu; ses modunun çalışmayı sürdürmesi.

## Microphone lifecycle

### AUD-005
- Önem: **high**
- Dosya: `docs/js/audio/audio-graph.js`
- Fonksiyon veya selector: `AudioGraph.start()`
- Mevcut davranış: Tek sabit hoparlör profili vardır. İzin durumu `OFFLINE` dışında ayrıştırılmaz; track kesintisi izlenmez.
- Beklenen davranış: Hoparlör ve kulaklık/müzik giriş profilleri ile requesting/ready/denied/error durumları bulunmalıdır.
- Önerilen düzeltme: Giriş profili seçimi ve capability state ekle.
- Doğrulama yöntemi: getUserMedia constraint ve hata türü testleri.

## AudioContext lifecycle

### AUD-006
- Önem: **high**
- Dosya: `docs/js/audio/audio-graph.js`
- Fonksiyon veya selector: `AudioGraph.start()`, `stop()`
- Mevcut davranış: `suspended`, `interrupted`, `closed` izlenmez; resume yolu ve idempotent start/stop yoktur.
- Beklenen davranış: Context state UI’a yansıtılmalı ve kullanıcı jestinden sonra resume edilmelidir.
- Önerilen düzeltme: `onstatechange`, start promise ve güvenli destroy ekle.
- Doğrulama yöntemi: Sahte AudioContext state geçiş testleri.

## Pitch pipeline

### AUD-007
- Önem: **critical**
- Dosya: `docs/js/audio/worklet/pitch-tracker.js`, `harmoni-processor.js`, `audio-graph.js`, `main.js`
- Fonksiyon veya selector: `PitchTracker.submit()`, `_handleMessage()`
- Mevcut davranış: Pitch gerçek mikrofondan telemetriyle `state.pitch` alanına gelir, ancak yalnız HUD tarafından okunur. Armoni girdisi değildir.
- Beklenen davranış: Hızlı pitch HUD’a, kararlı pitch event’i phrase ve harmony motorlarına gitmelidir.
- Önerilen düzeltme: `fastPitch`/`stablePitch`, PhraseDetector ve HarmonyController ekle.
- Doğrulama yöntemi: Sentetik nota dizisiyle chord/key revision değişim testi.

### AUD-008
- Önem: **high**
- Dosya: `docs/js/audio/worklet/pitch-tracker.js`
- Fonksiyon veya selector: `submit()`, `detect()`
- Mevcut davranış: Her blokta 8192 örnek `copyWithin`, her tespitte window/FFT/array allocation ve 5 öğelik integer MIDI history vardır. Vibrato/oktav sürekliliği ve stable event yoktur.
- Beklenen davranış: Ring buffer, önceden ayrılmış window/scratch, float MIDI ve iki hızlılık kanalı olmalıdır.
- Önerilen düzeltme: Tracker’ı allocation kontrollü state makinesi olarak refaktör et.
- Doğrulama yöntemi: silence/noise/sine/vibrato/octave geçiş testleri ve süre ölçümü.

## Harmony pipeline

### AUD-009
- Önem: **critical**
- Dosya: `docs/js/constants/tonal-systems.js`, `docs/js/main.js`
- Fonksiyon veya selector: `resolveTonalSelection()`, `setTonalSelection()`
- Mevcut davranış: `western:auto` majör ve MIDI 60 ile çözülür; otomatik tonik/mod tahmini yoktur. `phraseActive` hiçbir gerçek vokal olayından güncellenmez.
- Beklenen davranış: Kararlı pitch geçmişi tonik/mod tahmini ve phrase state üretmelidir; kararsız özellik Beta olarak etiketlenmelidir.
- Önerilen düzeltme: WesternHarmonyEngine, PhraseDetector, manuel kilit ve hysteresis ekle.
- Doğrulama yöntemi: Tonik histogramı, major/minor, hysteresis ve phrase testleri.

### AUD-010
- Önem: **high**
- Dosya: `docs/js/constants/tonal-systems.js`, `makam.js`
- Fonksiyon veya selector: `resolveTonalSelection()`
- Mevcut davranış: Makam seçimi sabit MIDI 60’a taşınır; makam eşliği basit durak/güçlü dizisine indirgenir. Aynı aralıklı makamların seyir/profil ayrımı yoktur.
- Beklenen davranış: Kullanıcı makamı seçmeli, durak tahmin/kilitlenmeli ve deneysel makam profiliyle göreli analiz yapılmalıdır.
- Önerilen düzeltme: MakamEngine ve profil şeması ekle; ürün metnini “Deneysel” yap.
- Doğrulama yöntemi: Kesirli MIDI transpozisyonu ve derece containment testleri.

## Synth scheduler

### AUD-011
- Önem: **critical**
- Dosya: `docs/js/audio/worklet/synth-engine.js`
- Fonksiyon veya selector: `_scheduleStep()`, `_scheduleWesternStep()`, `setLayers()`
- Mevcut davranış: Sabit 8 adım vardır. `density` yazılır ama örüntü kararlarında kullanılmaz. Boş layer listesi gizlice PIANO’ya döner. Keman `chordChanged` ile step 2/6 aynı anda denk gelirse tetiklenir; revision yanlış sınırda kaybolabilir.
- Beklenen davranış: Meter/pulse modeli, pending harmony boundary uygulaması, gerçek density ve açık boş-orkestra davranışı olmalıdır.
- Önerilen düzeltme: Scheduler state ve boundary queue ekle; sustain’i ölçü sınırında yeniden tetikle.
- Doğrulama yöntemi: Revision boundary, empty layers, density event count testleri.

### AUD-012
- Önem: **high**
- Dosya: `docs/js/audio/worklet/harmoni-processor.js`, `synth-engine.js`, `voices.js`, `vocal-dsp.js`
- Fonksiyon veya selector: `process()`, `render()`, `renderVoice()`
- Mevcut davranış: AudioWorklet quantum başına çok sayıda Float32/64Array oluşturulur; telemetry yaklaşık 47 FPS ve büyük control echo yollar.
- Beklenen davranış: Scratch buffer/in-place mix ve 20–30 FPS sınırlı telemetry kullanılmalıdır.
- Önerilen düzeltme: Önceden ayrılmış render buffer’ları ve azaltılmış protokol ekle.
- Doğrulama yöntemi: Allocation sayacı ve uzun süreli memory profili.

## Gesture pipeline

### AUD-013
- Önem: **high**
- Dosya: `docs/js/camera/gesture-classifier.js`
- Fonksiyon veya selector: `createGestureHistory().stabilize()`
- Mevcut davranış: Çoğunluk yoksa önceki stabil değer yerine ham gesture döner; history zaman/aşım bilgisi taşımaz.
- Beklenen davranış: Önceki stabil değer korunmalı, el kaybında temizlenmelidir.
- Önerilen düzeltme: Per-hand previousStable, timestamp ve reset ekle.
- Doğrulama yöntemi: Çoğunluk ve hand-loss birim testleri.

### AUD-014
- Önem: **high**
- Dosya: `docs/js/camera/gesture-controller.js`
- Fonksiyon veya selector: `_allowed()`, `update()`, `_mapHandDistance()`
- Mevcut davranış: Tutulan PEACE/POINT/FIST cooldown bitince tekrar tetiklenir. El mesafesi hem density hem manuel musicGain’i değiştirir. Pinch aralığı sabit ve hysteresis yoktur.
- Beklenen davranış: Ayrık jestler edge-trigger, el mesafesi yalnız gesture density/expression state ve pinch kalibre edilmiş hysteresis olmalıdır.
- Önerilen düzeltme: entered/held/released state, gestureGain ayrımı ve kalibrasyon ekle.
- Doğrulama yöntemi: Held gesture ve manual volume invariance testleri.

## State synchronization

### AUD-015
- Önem: **critical**
- Dosya: `docs/js/app-state.js`, `main.js`, `synth-engine.js`
- Fonksiyon veya selector: `state.activeLayers`, `setLayers()`
- Mevcut davranış: State doğrudan birçok yerden mutasyona uğrar. UI boş set gösterebilirken synth gizli piyano fallback uygular. Worklet echo yalnız debug alanına yazılır.
- Beklenen davranış: Tek dispatch yolu ve uygulanan worklet state doğrulaması olmalıdır.
- Önerilen düzeltme: Action/subscribe store ve telemetry reconciliation ekle.
- Doğrulama yöntemi: UI/worklet active layer eşitlik testi.

## Recording path

### AUD-016
- Önem: **critical**
- Dosya: `docs/js/audio/worklet/harmoni-processor.js`, `audio-graph.js`, `export/recorder.js`
- Fonksiyon veya selector: `monitorEnabled`, `recordDestination`, `SessionRecorder.start()`
- Mevcut davranış: Worklet tek stereo output üretir. Monitor kapalıyken VocalDSP hiç çalışmaz; record destination aynı output’a bağlı olduğu için kayıtta vokal yoktur. Audio track varlığı zorunlu doğrulanmaz.
- Beklenen davranış: MonitorBus ve RecordBus ayrılmalı; kayıt her zaman işlenmiş vokali içermelidir.
- Önerilen düzeltme: Worklet’te iki output, ayrı gain/limiter ve audio-track doğrulaması ekle.
- Doğrulama yöntemi: Monitor off + record vokal sinyal testi.

### AUD-017
- Önem: **high**
- Dosya: `docs/js/main.js`, `docs/js/export/recorder.js`
- Fonksiyon veya selector: `toggleRecording()`, `SessionRecorder.stop()`
- Mevcut davranış: Durdurma sonrası blob otomatik indirilir; önizleme/sonuç/hata ekranı yoktur. `MediaRecorder.onerror` yönetilmez.
- Beklenen davranış: Önizleme ve açık indirme/silme/yeni performans kararları olmalıdır.
- Önerilen düzeltme: Recorder result view ve hata state’i ekle.
- Doğrulama yöntemi: Sahte MediaRecorder stop/error testleri.

## HUD rendering / Advanced view

### AUD-018
- Önem: **high**
- Dosya: `docs/index.html`, `docs/js/main.js`, `docs/js/hud/canvas-hud.js`
- Fonksiyon veya selector: `#hud-advanced`, `applyModeVisibility()`
- Mevcut davranış: Gelişmiş görünüm DOM’u placeholder içerir, toggle gizlenmiştir ve live binding’lerin çoğu yoktur. Performans HUD’u frekans/cent/confidence gibi teknik verileri varsayılan gösterir.
- Beklenen davranış: Performans sade; çalışan teknik modüller Stüdyo görünümünde olmalıdır.
- Önerilen düzeltme: Placeholder’ı kaldır veya gerçek binding ekle; görünür view switch ekle.
- Doğrulama yöntemi: Görünen her modülün state binding smoke testi.

## Mobile layout

### AUD-019
- Önem: **critical**
- Dosya: `docs/styles/layout.css`, `docs/js/main.js`
- Fonksiyon veya selector: `.scene-canvas`, `CAM_WIDTH/CAM_HEIGHT`
- Mevcut davranış: 1280×720 canvas CSS ile `width:100%; height:100%` kullanılarak portre viewport’a non-uniform gerilir; kamera, eller ve metinler deforme olur.
- Beklenen davranış: Uniform scale+offset ve portrede kameradan ayrı DOM dock kullanılmalıdır.
- Önerilen düzeltme: Render transform sistemi ve responsive performance shell ekle.
- Doğrulama yöntemi: 390×844 pixel/aspect ve yatay taşma browser testi.

## Accessibility

### AUD-020
- Önem: **high**
- Dosya: `docs/js/main.js`, `docs/index.html`
- Fonksiyon veya selector: `handleKeydown()`, drawer/dialog markup, canvas HUD
- Mevcut davranış: Tab global view kısayolu olarak engellenir; form hedefi kontrol edilmez; drawer inert/focus trap/return focus ve canvas live text yoktur. Intro karakter karakter `aria-live` duyurabilir.
- Beklenen davranış: Standart Tab, modal focus yönetimi, semantic status ve reduced-motion yolu olmalıdır.
- Önerilen düzeltme: Merkezi COMMANDS, typing guard, focus manager ve aria-live status ekle.
- Doğrulama yöntemi: Klavye gezinimi ve axe smoke testi.

## Caching/versioning

### AUD-021
- Önem: **high**
- Dosya: `docs/index.html`, `docs/js/main.js`, `audio-graph.js`
- Fonksiyon veya selector: ES module import URL’leri
- Mevcut davranış: v15/v20/v22/v23 ve sürümsüz importlar aynı runtime graph’ında karışıktır; sayfa query parametresi asset bütünlüğü sağlamaz.
- Beklenen davranış: Tek APP_VERSION veya build hash kaynağı olmalıdır.
- Önerilen düzeltme: Merkezi sürüm modülü ve tutarlı bootstrap/import stratejisi ekle.
- Doğrulama yöntemi: Import graph’ında farklı `?v=` kalmadığını doğrulayan statik test.

## CSS architecture

### AUD-022
- Önem: **high**
- Dosya: `docs/styles/layout.css`, `theme.css`
- Fonksiyon veya selector: `.options-panel`, `.start-panel`, `.panel-toggle`
- Mevcut davranış: Aynı selector çok sayıda tasarım katmanında tekrar tanımlanır; radius/clip/glass stilleri birbirini ezer ve `!important` yaygındır. Dört tema tanımlı, runtime sıfıra zorlanmış, UI tek tema gösterir.
- Beklenen davranış: Tek bordo token kaynağı ve bileşen başına tek stil tanımı olmalıdır.
- Önerilen düzeltme: CSS’i token/reset/shell/performance/studio/overlay/component dosyalarına ayır; ölü temaları kaldır.
- Doğrulama yöntemi: Selector tekrar raporu ve responsive görsel test.

## Product truth

### AUD-023
- Önem: **high**
- Dosya: `docs/index.html`, `genres.js`, `tonal-systems.js`
- Fonksiyon veya selector: başlangıç metinleri, preset hint’leri
- Mevcut davranış: “melodiyi algılar / sesine uygun eşlik” iddiası gerçek harmony yolu olmadan gösterilir; makam/tür açıklamalarında indirgemeci sıfatlar vardır.
- Beklenen davranış: Ölçülen, seçilen ve deneysel davranış ayrılmalı; presetler yaratıcı sahne olarak sunulmalıdır.
- Önerilen düzeltme: Metinleri doğrula, Beta/Deneysel etiketleri ve capability status ekle.
- Doğrulama yöntemi: Ürün metni–runtime capability matrisi.

## Tests and CI

### AUD-024
- Önem: **critical**
- Dosya: `.github/workflows/ci.yml`, `docs/js/debug/self-test.js`
- Fonksiyon veya selector: `jobs.self-test`, `runSelfTest()`
- Mevcut davranış: CI yalnız Python lint/self-test çalıştırır. Web self-test yalnız makam toplamını tarayıcıda elle kontrol eder.
- Beklenen davranış: Web lint/unit/static/browser smoke CI başarısının parçası olmalıdır.
- Önerilen düzeltme: Node test paketi, saf modül testleri ve Chromium desktop/mobile smoke job ekle.
- Doğrulama yöntemi: CI web job’ının bilinçli test hatasında kırılması.

## Öncelik sırası

1. AUD-001, 007, 009, 011, 015, 016, 019, 024
2. AUD-003, 004, 005, 006, 008, 012, 013, 014, 017, 018, 020, 021, 022, 023
3. Makam/scheduler/tını geliştirmeleri ve performans optimizasyonlarının ölçümlü iterasyonu

Bu belge bir “tamamlandı” listesi değildir. Bulgular kod/test ile kapatılana kadar açık kabul edilir.
