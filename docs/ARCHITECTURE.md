# Harmoni Web Mimarisi

Harmoni Web, GitHub Pages üzerinde çalışan Vanilla JavaScript/ES module uygulamasıdır. Kamera ve mikrofon verisi tarayıcı içinde işlenir; performans medyası bir sunucuya yüklenmez.

## Runtime yolları

- `main.js`: bootstrap, lifecycle, görünüm bağlama ve controller orkestrasyonu.
- `camera/`: kamera stream’i, 640×360 inference yüzeyi, MediaPipe GPU→CPU fallback ve jest verisi.
- `audio/audio-graph.js`: AudioContext, mikrofon stream’i, MonitorBus ve RecordBus bağlantıları.
- `audio/worklet/`: gerçek zamanlı pitch, vokal DSP, synth ve scheduler.
- `harmony/phrase-detector.js`: SILENT/ATTACK/ACTIVE/RELEASE/GAP vokal cümle durumu.
- `harmony/western-harmony-engine.js`: kararlı pitch histogramından hysteresis uygulanmış otomatik tonik/mod adayı.
- `hud/`: performans canvas çizimi.
- `export/recorder.js`: canvas+RecordBus MediaRecorder yolu.

## Ses bus’ları

```text
Mikrofon → PitchTracker
          → VocalDSP ───────────────→ RecordBus
                      └ monitor açık → MonitorBus
SynthEngine ─────────────────────────→ MonitorBus + RecordBus
```

Monitor kapalı olması vokal analizini veya kayıttaki işlenmiş vokali kapatmaz.

## Lifecycle

`BOOT → INTRO → AWAITING_USER → STARTING_MEDIA → PARTIAL_READY/READY → RECORDING → STOPPING → DESTROYED`

Başlatma promise kilidiyle idempotenttir. `pagehide` kamera, mikrofon, AudioContext, RAF ve etkin kaydı kapatır.

## Üçüncü taraf bağımlılık

MediaPipe Tasks Vision `0.10.14` ve hand-landmarker modeli sabit sürüm URL’lerinden indirilir. CDN/model yüklenemezse el modeli `partial` olur; ses yolu çalışmaya devam eder.
