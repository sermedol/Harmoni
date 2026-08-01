# Harmoni V3 değişiklikleri

## 3.8

- Yeni "Basit Mod" arayuzu eklendi (varsayilan): gesturesynth.com'dan ilham
  alinarak, kamera goruntusu arayuzun kendisi haline geldi - ekranda yalnizca
  su an duyulan nota, calan eslik/akor adi, tonalite rozeti, kamera/ses hazir
  durumu ve alt tarafta kompakt bir "calan enstrumanlar" seridi goruniyor.
  Harmoni'nin tum derinligi (12 katmanli orkestra, makam motoru, oto-duzenleme,
  vokal DSP) hicbir sey kaybetmeden calismaya devam ediyor; Basit Mod yalnizca
  varsayilan gorunumdur.
- Mevcut tam gosterge paneli "Gelismis Mod" olarak korundu; `Tab` tusuyla iki
  gorunum arasinda aninda gecis yapilabiliyor (RuntimeState.simple_mode).
  Baslangic modu `--ui-mode {simple,advanced}` bayragiyla veya
  `harmoni_config.json` icindeki `simple_mode` alaniyla da secilebiliyor.
- Kullanim kilavuzu (`/`) tus listesine `Tab` eklendi.
- --self-test degismedi (25 adim); hem Basit hem Gelismis Mod render yolu ayri
  ayri elle dogrulandi (onizleme goruntuleri).

## 3.7

- Vokal DSP varsayilanlari yukseltildi: warmth 0.12->0.17, clarity 0.15->0.19,
  reverb_mix 0.11->0.16, echo_mix 0.04->0.055 - vokal artik daha "guzel"/
  studyo kaydi gibi, hafif eco ile (pinch jesti hala uzerine kontrol saglar).
- SynthEngine'e VocalDSP ile ayni mimaride (vektorize, gercek-zamanli guvenli)
  hafif, paylasilan bir oda reverb'i eklendi - orkestra artik vokalle ayni
  akustik alanda gibi duyuluyor, kuru/sentetik degil.
- --self-test 24 adimdan 25 adima genisletildi (reverb kuyrugunun gercekten
  sondugu dogrulaniyor: erken blok RMS'i > gec blok RMS'i).

## 3.6

- Vokal ducking gevsetildi (0.44->0.62): sarki soylerken eslik hafifce kisiliyor
  ama net sekilde duyulmaya devam ediyor ("arkada senfoni" hissi).
- 3 yeni enstruman: Gitar (celik telli Karplus-Strong), Keman (solo yayli,
  zamanla derinlesen vibrato), Davul (geleneksel cerceve davulu, dum/tek).
  Orkestra 9'dan 12 katmana cikti.
- Her katman icin dogrudan klavye kisayolu eklendi (P,B,N,W,C,Y,K,G,J,L,I,Z):
  artik hicbir katman yalnizca jestle kontrol edilmiyor, istenen an tusla
  ac/kapa yapilabiliyor. Piyano da dahil zorla acik tutulmuyor (guvenlik agi:
  tum katmanlar kapatilirsa piyanoya donulur).
  - `/` tusuyla acilan tam ekran kullanim kilavuzu: hangi jestin hangi eli/
  enstrumani kontrol ettigini ve tum klavye kisayollarini gosterir. Orkestra
  panelindeki her hucrede de kendi kisayol rozeti goruntuleniyor.
- `--resolution {720p,1080p,4k}` eklendi: kameradan daha yuksek cozunurluk
  istenebilir (best-effort, desteklenmezse otomatik duser). HUD her zaman
  1280x720 tasarim cozunurlugunde bilesimlendigi icin bu, pencereyi
  buyutmez ama el takibi/goruntu netligi icin daha iyi bir kaynak saglar -
  bu sinir README'de acikca belirtildi.
- --self-test 23 adimdan 24 adima genisletildi (yeni enstrumanlar + LAYER_KEYS
  butunlugu testi eklendi).

## 3.5

- Kamera acilma hatasinin kok nedeni bulundu: cozunurluk/FPS/FOURCC ozellikleri
  kamera kare vermeden ONCE zorlaniyordu, bu bircok gercek webcam'de (ozellikle
  DSHOW) kamerayi tamamen susturuyordu. Simdi once hicbir ayar degistirmeden
  dogrulama yapiliyor, cozunurluk sonradan best-effort denenip basarisiz olursa
  geri aliniyor. Acilma bekleme suresi 2s'den 6s'ye cikarildi (bazi surucu
  kombinasyonlarinda backend taramasi bu kadar surebiliyor).
- "Su anki eslik" karti en ust satira (baslik kartlari arasina) tasindi, buyutuldu.
- Koyu temalarda soluk metin/kenarlik renkleri belirgin sekilde parlatildi (okunabilirlik).
- Varsayilan piyano/eslik seviyesi 0.27->0.30, ikincil katmanlarin vurus siddeti
  ~%20-30 arttirildi; kazanc telafisi/ducking degismedi (vokal gölgelenmiyor).
- Dizi rengi (D tusu): Batida elle secilebilen Dorian ve Mixolydian renkleri
  eklendi (otomatik tespit degil, kullanici secimi; "auto" ile geri donulur).
- --self-test 22 adimdan 23 adima genisletildi (dizi rengi testi eklendi).

## 3.4

- --low-latency bayragi eklendi: Windows'ta WASAPI exclusive modu dener, basarisiz olursa sessizce paylasimli moda duser. Aygit yeniden baslatildiginda (restart_if_unhealthy) tercih korunur.
- Ritim hissi tespiti eklendi (aksak/duz), nota baslangic araliklarinin degiskenligine bakan bir sezgiseldir (HarmonyEngine._estimate_rhythm_feel, MusicSnapshot.rhythm_feel).
- AutoArranger eklendi: tonalite sistemi + tempo + ritim hissine gore her sarkiya uygun bir varsayilan katman seti onerir (orn. yavas/duz makam -> bagimsiz+ney+pad ritimsiz "alaturka" duzeni; aksak makam -> bas+ritim eklenir). A tusuyla ac/kapat, kullanici jestleri her zaman ustun gelir.
- README'ye ses gecikmesi butcesi ve "kamera indeksi" kavraminin dogrudan aciklamasi eklendi.
- --self-test 20 adimdan 22 adima genisletildi (AutoArranger, dusuk gecikme baslatma testleri eklendi).

## 3.3

- Uc yeni orkestra sesi eklendi: NEY (makam nefeslisi), FLUTE/nefesli (woodwind), BRASS/bakir nefesli - Bati orkestrasinin 4 klasik ailesi (yayli/nefesli/bakir/vurmali) artik tam temsil ediliyor.
- Otomatik kazanc telafisi: aktif katman sayisi arttikca (5->9) toplam eslik seviyesi sqrt-oranli telafi ile sabit tutuluyor; zengin orkestrasyon vokali bastirmiyor (olculen RMS orani ~1.0).
- Muzik egitimi bilgi katmani: makam modunda soylenen nota ve durak, klasik perde adiyla (Rast, Dugah, Segah, Cargah, Neva, Huseyni, Evic, Gerdaniye, Yegah, Muhayyer) ve sapma cinsiyle gosteriliyor; Bati modunda akor adinin yaninda islev etiketi (Tonik/Dominant/Subdominant) gorunuyor.
- Orkestra paneli 9 katmani sigdirmak icin kompakt 2 sutunlu mikser-izgarasina yeniden tasarlandi.
- Canli akis paneline dalga formunun yanina gercek zamanli bir FFT spektrum cubuk grafigi eklendi (teknik/profesyonel gorunum).
- BAGLAMA katmani artik Bati modunda da (arpej benzeri) calisiyor; onceden yalnizca makam modunda sesliydi.
- --self-test 17 adimdan 20 adima genisletildi (perde adi, yeni orkestra sesleri, katman kazanc telafisi testleri eklendi).

## 3.2

- Türk makam sistemi eklendi: 53 komalı (AEU) 12 makam, `T` ile Batı/Makam gecisi. Perde tablolari sonic-pi-net/sonic-pi #1705'ten alinmistir (bkz. README - Kaynaklar).
- Bağlama enstrümanı: Karplus-Strong dijital dalga kılavuzu (physical modeling) ile yeni bir procedural ses katmani.
- Makam modunda esllik artik blok akor degil, durak/guclu dron + bagimsiz melodik cevap (baglama) seklinde calisir.
- Kamera acilma guvenilirligi: coklu backend denemesi (DSHOW/MSMF/ANY), gercek kare okuma dogrulamasi, belirtilen index basarisiz olursa otomatik diger indekslerin taranmasi.
- Arayuz tamamen yeniden tasarlandi: PEARL/LILAC/PEACH/SAGE pastel temalari yerine MIDNIGHT/STUDIO/ANADOLU (koyu, profesyonel) ve DAYLIGHT (acik) temalari; segmentli LED-tarzi VU-metreler, ince aksan seritli panel tasarimi.
- README'ye arastirma kaynaklari (GitHub projeleri, akademik kavramlar) ve kapsam disi birakilan ozelliklerin (HTDemucs, DDSP, torchcrepe, tam TD-PSOLA, GTMM) gerekceli listesi eklendi.

## 3.1

- Vokal DSP'deki per-sample Python döngüleri `scipy.signal.lfilter` ile vektörize edildi (gerçek-zamanlı callback guvenliği).
- Piyano/yaylı/pad/bas sesleri inharmonisite, unison detune, hafif çekiç gürültüsü ve doygunlukla zenginleştirildi; not kesintilerinde click önleyici sönme rampası eklendi.
- El açıklık derecesi ve hareket hızından türetilen sürekli "parlaklık" ve "artikülasyon" kontrolleri eklendi (HUD'da görünür).
- Opsiyonel `FluidSynthBackend`: `--soundfont` ile gerçek bir .sf2 dosyası verildiğinde `pyfluidsynth` üzerinden gerçek enstrüman sesi kullanılabiliyor; aksi halde procedural synth'e sessizce düşülüyor.
- `R` ile kayıt artık video yanında oturumun WAV karışımını (her zaman) ve MIDI dosyasını (mido kuruluysa) da üretiyor.
- `harmoni_config.json` ile tema, piyano seviyesi, performans profili, kamera indeksi, monitoring ve ayna modu oturumlar arası kalıcı hale getirildi (`--reset-config` ile sıfırlanabilir).
- Kamera art arda kare alamazsa otomatik yeniden bağlanmayı dener; `--camera auto` ile çalışan ilk kamera aranır.
- Ses callback'i art arda hata verirse ses akışı otomatik olarak yeniden başlatılır.
- `pyproject.toml` (pip ile kurulabilir, `harmoni` komutu), `ruff` yapılandırması, GitHub Actions CI (`--self-test`, Linux + Windows, Python 3.10/3.11) ve PyInstaller derleme betiği (`harmoni.spec`, `build_exe.bat`) eklendi.
- `--self-test` 7 adımdan 13 adıma çıkarıldı: yeni synth ifade kontrolleri, FluidSynth yoksayma, jest ifadesi, config kalıcılığı, MIDI ve WAV dışa aktarım testleri eklendi.

## 3.0

- Kamera yakalama ayrı iş parçacığına taşındı.
- En yeni kare politikası eklendi; kamera tampon birikmesi kaldırıldı.
- Dengeli profilde yakalama 960×540, el algılama 512 px ve iki karede bir yapılıyor.
- MediaPipe model karmaşıklığı 1'den 0'a indirildi.
- El landmark yumuşatma ve kısa süreli sonuç koruma eklendi.
- Tam-kare ve kart başına pahalı blur işlemleri kaldırıldı.
- Piyano varsayılan seviyesi düşürüldü.
- Vokal aktifken side-chain ducking eklendi.
- Akor seçiminde yakın melodi geçmişi, tonalite, geçiş olasılığı ve voice-leading kullanılıyor.
- Akorlar vokal merkezinin altında seslendiriliyor.
- Tonalite değişimine doğrulama süresi eklendi.
- Melodik nota başlangıçlarından yumuşak tempo tahmini eklendi.
- `fast`, `balanced`, `quality` performans profilleri eklendi.
- `9` ve `0` ile canlı piyano seviyesi kontrolü eklendi.
- Uygulama ve dosya adı yalnızca Harmoni olarak güncellendi.

## 2026.08.01 — Web üretim sağlamlaştırma

- Gerçek davranış denetimi (`docs/AUDIT.md`).
- Idempotent başlatma ve güvenli lifecycle cleanup.
- Ayrı MonitorBus/RecordBus; monitör kapalıyken kayıtta işlenmiş vokal.
- Fast/stable pitch telemetrisi, PhraseDetector ve `western:auto` Beta armoni girdisi.
- Density örüntü etkisi, pending harmony ölçü sınırı ve gizli piyano fallback’inin kaldırılması.
- Gesture majority/edge-trigger düzeltmeleri.
- MediaPipe timeout, GPU→CPU fallback ve ayrı inference canvas.
- Kayıt önizleme/indirme/silme akışı.
- Node birim testleri ve Chromium masaüstü/mobil CI smoke testleri.

