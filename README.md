# Harmoni V3

Harmoni; kamera açıkken elleri takip eden, mikrofondan söylenen melodiyi analiz eden, vokalin altında piyano eşliği üreten ve el hareketleriyle ek enstrüman katmanlarını yöneten masaüstü Python uygulamasıdır.

Bu sürüm özellikle iki sorunu düzeltir:

- Kamera okuma, el algılama ve arayüz çizimi artık aynı döngüde değildir.
- Piyano varsayılan olarak vokalin belirgin biçimde altındadır ve vokal başladığında otomatik olarak daha da kısılır.

### 3.8 güncellemesi

- **Basit Mod (yeni varsayılan arayüz)**: [gesturesynth.com](https://www.gesturesynth.com)'un minimalizminden ilham alınarak, kamera görüntüsünün kendisinin arayüz olduğu yeni bir görünüm eklendi — ekranda yalnızca şu an duyulan nota, çalan eşlik/akor adı, tonalite rozeti, kamera/ses hazır durumu ve alt tarafta kompakt bir "çalan enstrümanlar" şeridi var. Harmoni'nin temel mantığı ve derinliği (12 katmanlı orkestra, makam motoru, otomatik düzenleme, vokal DSP) hiçbir şey kaybetmeden arka planda aynen çalışmaya devam ediyor.
- **Gelişmiş Mod** (önceki tam gösterge paneli) korundu ve hâlâ erişilebilir — `Tab` tuşu iki görünüm arasında anında geçiş yapar.
- Başlangıç modu `--ui-mode {simple,advanced}` bayrağıyla veya `harmoni_config.json` içindeki `simple_mode` alanıyla seçilebilir; varsayılan Basit Mod'dur.
- Kullanım kılavuzuna (`/` tuşu) `Tab` kısayolu eklendi.

### 3.7 güncellemesi

- **Vokal daha güzel duyuluyor**: Varsayılan sıcaklık (warmth) ve netlik (clarity) yükseltildi; varsayılan hafif reverb ve eco artırıldı (pinch jesti hâlâ üstüne kontrol sağlar) — vokal artık kulaklıkla dinlerken daha "stüdyo kaydı" gibi hissettiriyor, çıplak/kuru değil.
- **Orkestra "aynı odada" hissi**: Eşliğe, vokalinkiyle aynı mimaride (vektörize, gerçek-zamanlı güvenli) hafif, paylaşılan bir oda reverb'i eklendi — orkestra artık kuru/sentetik değil, vokalle aynı akustik alanda gibi duyuluyor.
- `--self-test` 24 adımdan 25 adıma genişletildi (reverb kuyruğunun gerçekten söndüğü doğrulanıyor).

### 3.6 güncellemesi

- **Vokal ile eşlik dengesi**: Şarkı söylerken eşlik artık daha az kısılıyor (duck seviyesi 0.44→0.62) — "arkada senfoni duyulmalı" isteğine göre, eşlik nefes boşluklarındaki kadar olmasa da şarkı sırasında da net şekilde duyuluyor.
- **3 yeni enstrüman**: **Gitar** (çelik telli, Karplus-Strong), **Keman** (solo yaylı, zamanla derinleşen vibrato), **Davul** (geleneksel çerçeve davulu, dum/tek). Orkestra artık **12 katman**.
- **Doğrudan klavye kontrolü**: Artık her katman jestlere bağlı kalmadan, istediğin an bir tuşla açılıp kapatılabiliyor (bkz. [Enstrüman tuşları](#enstrüman-tuşları)). Piyano da dahil — hiçbir katman zorla açık tutulmuyor.
- **Kullanım kılavuzu (`/` tuşu)**: Tam ekran, her zaman güncel bir yardım katmanı — hangi jestin hangi eli/enstrümanı kontrol ettiğini ve tüm klavye kısayollarını gösterir. Orkestra panelindeki her hücrede de kendi kısayol rozeti görünür.
- **Kamera çözünürlüğü**: `--resolution {720p,1080p,4k}` ile kameradan daha yüksek çözünürlük istenebilir (bkz. [Kamera çözünürlüğü](#kamera-çözünürlüğü) — önemli bir kısıtla birlikte).
- `--self-test` 23 adımdan 24 adıma genişletildi.

### 3.5 güncellemesi

- **Kamera açılma hatası kök nedeni bulundu ve düzeltildi**: Eski kod, kamera hiçbir kare vermeden ÖNCE çözünürlük/FPS/FOURCC gibi özellikleri zorluyordu — bu, birçok gerçek webcam'de (özellikle DSHOW ile) kamerayı tamamen sessiz bırakabiliyordu. Artık önce hiçbir ayar değiştirilmeden kameranın yerel ayarlarla kare verip vermediği doğrulanır, çözünürlük ayarı yalnızca bundan SONRA en iyi çaba (best-effort) olarak denenir ve kamerayı bozarsa geri alınır. Ayrıca kamera açılma bekleme süresi 2 saniyeden 6 saniyeye çıkarıldı — bazı Windows sürücü kombinasyonlarında backend taraması bundan uzun sürebiliyor ve erken vazgeçmek çalışan bir kamerayı "bulunamadı" gösteriyordu.
- **"Şu anki eşlik" kartı en üst satıra taşındı**: Artık başlık ve durum kartlarının arasında, daha büyük ve belirgin.
- **Okunabilirlik**: Koyu temalardaki soluk (muted) metin ve kart kenarlıkları belirgin şekilde parlatıldı; kontrast önemli ölçüde arttı.
- **Enstrüman seviyeleri** hafifçe yükseltildi (varsayılan piyano/eşlik seviyesi 0.27→0.30, ikincil katmanların vuruş şiddeti ~%20-30 arttı); otomatik kazanç telafisi ve vokal ducking değişmedi — zenginlik arttı, vokal gölgelenmedi.
- **Dizi rengi (`D` tuşu)**: Batı sisteminde artık yalnızca majör/minör değil, elle seçilebilen **Dorian** ve **Mixolydian** renkleri de var (folk/rock/caz tınısı için) — bu otomatik bir tespit değil, kullanıcının bilinçli seçimidir; "auto"ya dönünce otomatik majör/minör tespiti kaldığı yerden sürer.

### 3.4 güncellemesi

- **Düşük ses gecikmesi**: `--low-latency` bayrağı Windows'ta WASAPI **exclusive** modunu dener (paylaşımlı moda göre host tarafındaki tampon gecikmesini büyük ölçüde azaltır). Aygıt başka bir uygulama tarafından kullanılıyorsa veya modu desteklemiyorsa sessizce normal moda düşer — asla hata vermez. Gerçek gecikme her zaman HUD'da (`latency_ms`) canlı görünür (bkz. [Ses gecikmesi](#ses-gecikmesi)).
- **Otomatik düzenleme (AutoArranger)**: Uygulama artık tonalite sistemi (Batı/Makam), tempo ve ritim hissine (aksak/düz) göre **her şarkıya uygun** bir varsayılan enstrüman seti seçer — örneğin yavaş bir alaturka makam parçası bağlama+ney+pad (ritimsiz) alırken, aksak/canlı bir Anadolu parçası bas+ritim de kazanır. `A` tuşu ile açılıp kapatılabilir; kapatıldığında tüm kontrol jestlere geçer. Bkz. [Otomatik düzenleme](#otomatik-düzenleme).
- Kamera indeksi kavramı README'de netleştirildi (bkz. [Kamera sorun giderme](#kamera-sorun-giderme)).

### 3.3 güncellemesi

- **Tam orkestra**: 9 enstrüman katmanı — Piyano, Bağlama, **Ney** (makam nefeslisi), **Nefesli** (flüt-benzeri), **Bakır nefesli**, Yaylılar, Pad, Bas, Ritim. Batı'nın 4 klasik orkestra ailesini (yaylı/nefesli/bakır/vurmalı) ve Türk makamının iki temel öncü sesini (bağlama+ney) bir arada barındırır.
- **Otomatik kazanç telafisi**: Daha fazla katman açmak artık toplam eşlik seviyesini yükseltmiyor (5 katmandan 9 katmana çıkışta ölçülen RMS oranı ~1.0) — enstrüman zenginliği vokali bastırmaz.
- **Müzik eğitimi bilgi katmanı**: Makam modunda söylenen her nota, klasik **perde adıyla** (Rast, Dügah, Segah, Çargah, Neva, Hüseyni, Eviç, Gerdaniye...) ve sapmasıyla (cent) gösterilir; durak da perde adıyla etiketlenir. Batı modunda ise akor adının yanında **işlev etiketi** (Tonik, Dominant, Subdominant...) görünür.
- **Orkestra paneli** 9 katmanı sığdırmak için kompakt 2 sütunlu mikser-ızgarasına yeniden tasarlandı.
- **Spektrum analizörü**: Canlı akış panelinde dalga formunun yanına, teknik/profesyonel görünüm için gerçek zamanlı bir FFT çubuk grafiği eklendi.

### 3.2 güncellemesi

- **Türk makam sistemi** eklendi: `T` tuşu ile Batı (majör/minör) ve Türk makamı arasında geçiş yapılabilir. 12 makam (Çargâh, Bûselik, Kürdî, Râst, Hicaz, Uşşak, Nihavent, Hüzzam, Karcığar, Segâh, Nevâ, Hüseynî), 53 komalı (AEU) sisteme göre komma-hassasiyetinde modellenmiştir (bkz. [Türk makam sistemi](#türk-makam-sistemi)).
- **Bağlama** enstrümanı: Karplus-Strong dijital dalga kılavuzu (physical modeling) ile sentezlenen, gerçek bir telli çalgı gibi doğal sönen yeni bir katman. Makam modunda otomatik olarak öncü ses olur.
- Makam modunda eşlik, Batı'daki blok akorlar yerine **dron (durak+güçlü) + bağımsız melodik cevap figürü** kullanır — gerçek makam icrasındaki heterofonik dokuya daha sadık bir yaklaşım.
- **Kamera açılma güvenilirliği** iyileştirildi: Windows'ta DSHOW başarısız olursa MSMF ve genel backend otomatik denenir; `isOpened()` yaniltıcı şekilde başarılı dönerse gerçek bir kare okunana kadar doğrulanır; belirtilen kamera indeksi açılamazsa diğer indeksler otomatik taranır.
- **Arayüz tamamen yeniden tasarlandı**: pastel/yuvarlak kart görünümü yerine, profesyonel ses yazılımlarından ilham alan koyu stüdyo temaları (MIDNIGHT, STUDIO, ANADOLU) ve segmentli LED-tarzı VU-metreler kullanılıyor. Aydınlık ortamlar için DAYLIGHT teması korunuyor.
- Araştırma bulguları ve ilham alınan açık kaynak projeler [Kaynaklar ve araştırma](#kaynaklar-ve-araştırma) bölümünde, kapsam dışı bırakılan (ve neden bırakıldığı açıklanan) öğeler [Kapsam dışı bırakılanlar](#kapsam-dışı-bırakılanlar) bölümünde listelidir.

### 3.1 güncellemesi

- Vokal efekt zincirindeki filtreler vektörize edildi; ses callback'inde gerçek-zamanlı gecikme riski azaltıldı.
- Piyano/yaylı/pad/bas sesleri inharmonisite, unison detune ve hafif çekiç gürültüsüyle daha gerçekçi hale getirildi.
- El açıklığı ve hareket hızı artık **sürekli** olarak parlaklık ve artikülasyonu (staccato/legato) kontrol ediyor.
- Opsiyonel gerçek soundfont (`--soundfont`) desteği eklendi (`pyfluidsynth` gerektirir).
- Kayıt (`R`) artık video yanında **WAV** ve (kurulu ise) **MIDI** dosyası da üretiyor.
- Tema, piyano seviyesi, performans profili ve kamera indeksi oturumlar arası hatırlanıyor (`harmoni_config.json`).
- Kamera koptuğunda otomatik yeniden bağlanma, ses callback'i art arda hata verirse otomatik yeniden başlatma eklendi.
- `pyproject.toml`, CI iş akışı ve PyInstaller derleme betiği eklendi.

## Yenilikler

### Daha akıcı kamera

- Kamera ayrı bir `CameraWorker` iş parçacığında çalışır.
- Ana uygulama yalnızca en yeni kareyi kullanır; eski kareler birikmez.
- MediaPipe tam kamera çözünürlüğünde çalışmaz.
- El algılama dengeli profilde her iki karede bir, 512 piksel genişlikte yapılır.
- MediaPipe `model_complexity=0` ile çalışır.
- Son el sonucu ara karelerde korunur ve landmark noktaları yumuşatılır.
- Arayüzdeki tam-kare Gaussian blur ve her karta ayrı bulanık gölge kaldırıldı.

### Vokale göre eşlik

- Söylenen notalar 12 saniyelik hareketli bellekte tutulur.
- Tonalite değişimi birkaç saniye doğrulanmadan uygulanmaz.
- Akorlar yalnızca vuruş sınırlarında değişir.
- Güncel nota, yakın geçmişteki melodi ve önceki akor birlikte puanlanır.
- Akorlar arasında küçük ses hareketi tercih edilir.
- Piyano voicing'i sesinin merkez notasından yaklaşık 4-17 yarım ses aşağıda tutulur.
- Notalar değiştikçe yaklaşık tempo tahmini yapılır; `Space` ile tap tempo hâlâ kullanılabilir.

### Piyano-vokal dengesi

- Başlangıç piyano/eşlik seviyesi `0.30` olarak ayarlanmıştır.
- Şarkı söylenirken side-chain ducking eşliği hafifçe geri çeker (~4 dB) — tamamen kısmaz, "arkada senfoni" hissi korunur; nefes boşluklarında tam seviyeye döner.
- Piyano arpeji şarkı sırasında seyrekleşir; nefes boşluklarında biraz daha dolu çalar.
- Katman sayısı arttıkça (bkz. [Orkestra](#orkestra)) toplam seviye otomatik kazanç telafisiyle sabit tutulur; zenginlik vokali bastırmaz.

## Kurulum

Python 3.10 veya 3.11 önerilir.

```bash
python -m pip install -r requirements.txt
```

Linux'ta `sounddevice` için PortAudio gerekebilir:

```bash
sudo apt install libportaudio2 portaudio19-dev
```

Opsiyonel özellikler (MIDI dışa aktarım, gerçek soundfont sesi) için `requirements_optional.txt` içindeki paketler kurulabilir:

```bash
python -m pip install mido pyfluidsynth
```

Bu paketler kurulu değilse ilgili özellikler sessizce devre dışı kalır; uygulama normal şekilde çalışmaya devam eder.

## Çalıştırma

Dengeli profil:

```bash
python harmoni.py
```

Kamera hâlâ yavaşsa hızlı profil:

```bash
python harmoni.py --performance fast
```

Daha yüksek görüntü kalitesi:

```bash
python harmoni.py --performance quality
```

Piyanoyu daha da kısık başlatmak:

```bash
python harmoni.py --piano-volume 0.20
```

Kamera indeksi farklıysa:

```bash
python harmoni.py --camera 1
```

Kamera indeksini bilmiyorsan otomatik bulma:

```bash
python harmoni.py --camera auto
```

Canlı mikrofon monitoring olmadan başlatmak:

```bash
python harmoni.py --no-monitor
```

Gerçek bir piyano soundfont'u ile çalmak (opsiyonel, `pip install pyfluidsynth` gerektirir):

```bash
python harmoni.py --soundfont C:\yol\FluidR3_GM.sf2
```

Kaydedilmiş ayarları yok sayıp varsayılanlarla başlamak:

```bash
python harmoni.py --reset-config
```

En düşük ses gecikmesi için (Windows, WASAPI exclusive dener):

```bash
python harmoni.py --low-latency
```

Gelişmiş Mod (tam gösterge paneli) ile başlatmak — varsayılan Basit Mod'dur, `Tab` ile çalışırken de geçilebilir:

```bash
python harmoni.py --ui-mode advanced
```

`--camera`, `--performance`, `--piano-volume` ve `--ui-mode` belirtilmezse bir önceki oturumda kaydedilen değerler kullanılır (bkz. [Ayarların kalıcılığı](#ayarların-kalıcılığı)).

## Performans profilleri

| Profil | Kamera | El algılama | Kullanım |
|---|---:|---:|---|
| `fast` | 640×360 | 384 px, 3 karede bir | Eski veya düşük güçlü bilgisayar |
| `balanced` | 960×540 | 512 px, 2 karede bir | Varsayılan |
| `quality` | 1280×720 | 640 px, her kare | Güçlü bilgisayar |

## Kamera çözünürlüğü

```bash
python harmoni.py --resolution 4k
```

`--resolution {720p,1080p,4k}` kameradan bu çözünürlüğü ister (kamera desteklemiyorsa donanım/sürücü otomatik olarak desteklediği en yakın değere düşer — hata vermez). **Önemli ve dürüst bir sınır**: arayüz (HUD) her zaman 1280×720 tasarım çözünürlüğünde bileşimlenir; bu, düzinelerce panel/metin/ölçer için test edilmiş sabit bir yerleşimdir. Daha yüksek bir yakalama çözünürlüğü istemek, el takibi ve nihai görüntü için daha detaylı bir kaynaktan faydalanır (supersampling), ancak pencerenin kendisini büyütmez veya native 4K keskinliğinde bir çıktı vermez. Pencerenin/kaydın kendisinin gerçek 4K olması, tüm HUD koordinatlarının ölçekli yeniden yazılmasını gerektiren ayrı ve daha büyük bir iş olur — istenirse bir sonraki adım olarak yapılabilir.

## Tuşlar

| Tuş | İşlev |
|---|---|
| `Q` / `Esc` | Çıkış |
| `H` | Arayüzü aç/kapat |
| `Tab` | Basit Mod ↔ Gelişmiş Mod arayüz görünümü |
| `E` | Vokal efektlerini aç/kapat |
| `V` | Canlı vokal monitoring aç/kapat |
| `9` | Piyano sesini azalt |
| `0` | Piyano sesini artır |
| `Space` | Tap tempo |
| `[` / `]` | BPM azalt/artır |
| `-` / `+` | Reverb azalt/artır |
| `F` | Tüm eşlik katmanlarını aç |
| `X` | Yalnızca piyano |
| `M` | Ayna modu |
| `T` | Tonalite sistemi: Batı ↔ Türk makamı |
| `A` | Otomatik düzenleme aç/kapat |
| `D` | Dizi rengi: Major → Minor → Dorian → Mixolydian → Otomatik |
| `S` | Ekran görüntüsü |
| `R` | Kayıt (video + WAV + MIDI) aç/kapat |
| `1-4` | Tema değiştir (Midnight / Studio / Anadolu / Daylight) |
| `/` | Tam ekran kullanım kılavuzunu aç/kapat |
| `P B N W C Y K G J L I Z` | Enstrüman katmanlarını tek tek aç/kapat (bkz. [Enstrüman tuşları](#enstrüman-tuşları)) |

## Jestler

Katmanlar **yalnızca** jestlerle kontrol edilmez — her katmanın kendi klavye kısayolu da vardır (bkz. [Enstrüman tuşları](#enstrüman-tuşları)) ve istediğin an, elin kamerada olmasa bile kullanılabilir. Jestler; elini kullanmaya devam etmek isteyenler için ek, hızlı bir kontrol katmanıdır:

| Jest | İşlev |
|---|---|
| Sağ açık el | Yaylıları açar |
| Sol açık el | Yumuşak pad katmanını açar |
| İki açık el | Tam orkestrayı açar; el mesafesi yoğunluğu değiştirir |
| Peace | Ritmi açar/kapatır |
| Yumruk | Ek katmanları susturur |
| İşaret | Katmanlar arasında seçim yapar (yaylı → pad → bas → ritim → bağlama → nefesli → bakır nefesli → ney → gitar → keman → davul) |
| Pinch | Reverb ve echo miktarını değiştirir |

Bunlara ek olarak iki **sürekli** (aç/kapa olmayan) kontrol her zaman aktiftir:

| Sürekli kontrol | Kaynak | Etki |
|---|---|---|
| Parlaklık | El açıklık derecesi (yumruk → açık el) | Eşliğin tonunu koyulaştırır/parlatır (alçak geçiren filtre) |
| Artikülasyon | El hareket hızı (yavaş → hızlı) | Notaları legato'dan staccato'ya doğru kısaltır |

Bu iki değer HUD'da "Eşlik" kartının altında canlı ölçek olarak görünür.

## İlk ayar

Daha önce gönderilen vokal örneğine göre başlangıç tonalitesi `G# minor`, tempo `88 BPM` ve vokal merkez bölgesi yaklaşık `B3` çevresine ayarlanmıştır. Sistem yeterli nota duyduğunda tonaliteyi otomatik olarak değiştirir.

## Orkestra

Hepsi tek dosyada, örnekleme kütüphanesi olmadan prosedürel olarak (fiziksel modelleme + additive/subtractive sentez) üretilen **12 katman**, Batı orkestrasının 4 klasik ailesini (yaylı/nefesli/bakır/vurmalı), rock/pop'un temel çalgılarını (gitar, bateri) ve Türk makamının üç temel sesini (bağlama, ney, davul) kapsar:

| Katman | Tuş | Aile | Sentez yöntemi |
|---|---|---|---|
| Piyano | `P` | Klavyeli | Additive + inharmonisite + çekiç gürültüsü |
| Bağlama | `B` | Telli (makam) | Karplus-Strong dijital dalga kılavuzu |
| Gitar | `G` | Telli (rock/pop) | Karplus-Strong (daha parlak, daha uzun sustain) |
| Ney | `N` | Nefesli (makam) | Nefes gürültülü sinüs + vibrato |
| Nefesli (flüt) | `W` | Woodwind | Saf sinüse yakın + hafif nefes gürültüsü |
| Bakır nefesli | `C` | Brass | Zengin harmonik yığın + doygunluk |
| Yaylılar | `Y` | Strings | Unison detune'lu harmonik yığın + vibrato |
| Keman | `K` | Strings (solo) | Zamanla derinleşen vibrato + yay gürültüsü |
| Pad | `J` | Strings (yumuşak) | Yaylı motorunun alçak, uzun sürümü |
| Bas | `L` | Bas | Sinüs + 2. harmonik + doygunluk |
| Ritim (bateri) | `I` | Percussion | Gürültü + süpürmeli sinüs (kick/snare/hat) |
| Davul | `Z` | Percussion (geleneksel) | Derin "dum" darbesi + keskin "tek" sesi |

Daha fazla katman açmak eşliğin toplam ses seviyesini **yükseltmez** — aktif katman sayısına göre otomatik kazanç telafisi uygulanır (bkz. `SynthEngine.render`), böylece zengin bir orkestra vokali bastırmaz.

## Enstrüman tuşları

Yukarıdaki her katman, el hareketi gerektirmeden **istediğin an** yukarıdaki tuşla açılıp kapatılabilir — jestler hâlâ çalışır, ama artık zorunlu değildir. Piyano da dahil hiçbir katman kalıcı olarak zorlanmaz (hepsi kapatılırsa tam sessizlik yerine piyanoya dönülür). Tam liste, orkestra panelindeki her hücrenin üzerinde rozet olarak ve `/` tuşuyla açılan tam ekran kılavuzda da görünür.

## Otomatik düzenleme

Her şarkının enstrümantasyonu ve ritmi aynı olmamalı: yavaş bir alaturka parça ile aksak bir Anadolu rock parçası aynı katmanlarla çalınmamalı. `A` tuşuyla açılıp kapatılan **AutoArranger**, halihazırda hesaplanan üç sinyale bakarak birkaç saniyede bir mantıklı bir varsayılan katman seti önerir:

| Tonalite | Tempo/his | Önerilen katmanlar | Örnek |
|---|---|---|---|
| Makam | Yavaş/düzenli | Piyano, Bağlama, Ney, Pad (ritimsiz) | Alaturka/klasik makam baladı |
| Makam | Aksak (düzensiz) | Piyano, Bağlama, Ney, Bas, Ritim | Anadolu rock/halk oyunu havası |
| Batı | Hızlı (≥105 BPM) | Piyano, Bas, Ritim, Yaylılar | Pop/rock |
| Batı | Yavaş (<80 BPM) | Piyano, Pad, Yaylılar | Balad |
| Batı | Orta | Piyano, Bas, Yaylılar, Pad | Genel amaçlı |

**Dürüstçe belirtilmeli**: "Aksak" tespiti, nota başlangıç aralıklarının değişkenliğine bakan kaba bir sezgiseldir (`HarmonyEngine._estimate_rhythm_feel`) — gerçek bir usul/meter analizi veya ses tabanlı tür sınıflandırıcı (bunun için eğitilmiş bir ses modeli gerekir) değildir. Kullanıcının jestle yaptığı katman değişiklikleri her zaman geçerlidir; AutoArranger yalnızca tonalite/tempo/ritim hissi belirgin şekilde değiştiğinde (en fazla ~6 saniyede bir) yeni bir taban önerir, sürekli müdahale etmez.

## Türk makam sistemi

`T` tuşu ile Batı (majör/minör) sisteminden Türk makam sistemine geçilir. Motor, Arel-Ezgi-Uzdilek (AEU) kuramındaki **53 komalı** (1 koma ≈ 22.64 cent) oktav bölümlemesini kullanır; 12-TET'in yarım ses hassasiyetinin çok ötesinde, komma-doğru perdelerle çalışır.

**Perde aralık tabloları** — Sonic Pi projesinin ([sonic-pi-net/sonic-pi](https://github.com/sonic-pi-net/sonic-pi), MIT lisanslı) [#1705 numaralı pull request'inde](https://github.com/sonic-pi-net/sonic-pi/pull/1705) (kivancguckiran tarafından) tanımlanan dörtlü/beşli (tetrachord/pentachord) yapı taşlarından alınmıştır: Çargâh, Bûselik, Kürdî, Râst, Hicaz, Uşşak, Nihavent, Hüzzam, Karcığar, Segâh, Nevâ, Hüseynî.

**Algılama** — söylenen notalar 53 komalık bir "koma-chroma" histogramında biriktirilir ve her makamın durak (tonik) + güçlü (5. derece) ağırlıklı profiliyle karşılaştırılır (Krumhansl-Schmuckler'ın Batı tonalite profillerindeki tonik/dominant ağırlıklandırma ilkesiyle aynı mantık). Birkaç saniye kararlılık doğrulanmadan makam/durak değişmez.

**Eşlik** — Batı modundaki blok akorlar yerine, gerçek makam icrasındaki dron + heterofoni dokusuna sadık kalınarak: durak+güçlü üzerinde sürekli bir **dron** (pad katmanı), **bağlama** (Karplus-Strong) ile çalınan plektif bir melodik cevap figürü ve **ney** ile çalınan uzun nefesli tonlar kullanılır.

**Perde adları (müzik eğitimi)** — HUD, söylenen her notayı yalnızca modern nota adıyla (`RE3` gibi) değil, klasik **perde adıyla** da gösterir: Yegâh, Rast, Dügâh, Segâh, Çargâh, Nevâ, Hüseynî, Eviç, Gerdâniye, Muhayyer, Tiz Çargâh. Bu isimler `Rast ≈ G3` geleneksel/pedagojik referansına göre komma-hassasiyetinde hesaplanır. **Önemli**: gerçek icrada referans perde topluluğa, bölgeye ve enstrümana göre değişir; bu mutlak bir frekans standardı değil, göreli ve eğitim amaçlı bir isimlendirmedir.

**Bilinçli sadeleştirmeler** (dürüstçe belirtilmelidir):

- Bir makam yalnızca bir perde dizisi değildir; *seyir* (melodik ilerleyiş), *güçlü* vurgusu ve *asma karar* gibi icra kuralları da kimliğinin parçasıdır. Bu motor yalnızca dizi/perde boyutunu modeller. Örneğin **Nevâ ve Hüseynî tam olarak aynı ham perde dizisini paylaşır** ve bu basit modelle ayrıştırılamaz; gelenekte yalnızca seyirleriyle ayrışırlar.
- **Saba** makamı, oktava düzgün oturmayan kendine özgü yapısı nedeniyle bu dizi tablosuna dahil edilmemiştir (yanlış/yanıltıcı bir tanım vermektense hariç tutulmuştur).
- FluidSynth (`--soundfont`) ve MIDI dışa aktarım (`mido`) standart 12-TET/GM altyapısını kullanır; bu iki çıkışta mikrotonal perdeler en yakın yarım sese yuvarlanır. Komma hassasiyeti yalnızca dahili procedural synth'te tam olarak duyulur.

## Kayıt ve dışa aktarım

`R` tuşuna basıldığında `harmoni_captures/` klasörüne aynı zaman damgasıyla üç dosya üretilir:

- `harmoni_<tarih>.mp4` — ekran görüntüsü (her zaman).
- `harmoni_<tarih>.wav` — o oturumda çalınan tüm ses karışımı (her zaman, ek bağımlılık gerekmez).
- `harmoni_<tarih>.mid` — o oturumda tetiklenen notaların standart MIDI dosyası (yalnızca `mido` kuruluysa; değilse bu dosya sessizce atlanır ve toast mesajı bunu bildirir).

WAV kaydı bellekte biriktirilir ve `R` ile kayıt durdurulduğunda diske yazılır; bu yüzden çok uzun (saatler süren) kayıtlar bellek kullanımını artırabilir.

## Ayarların kalıcılığı

Tema, piyano seviyesi, performans profili, kamera indeksi, mikrofon monitoring ve ayna modu `harmoni.py` ile aynı klasördeki `harmoni_config.json` dosyasına kaydedilir ve bir sonraki çalıştırmada otomatik yüklenir. Komut satırı argümanları her zaman bu dosyadaki değerleri geçersiz kılar. Sıfırlamak için `--reset-config` kullanılabilir.

## Paketleme ve dağıtım

Geliştirme kurulumu (komut satırından `harmoni` olarak çalıştırılabilir hale getirir):

```bash
python -m pip install -e .
```

Bağımsız çalıştırılabilir dosya (Windows, PyInstaller gerektirir):

```bash
build_exe.bat
```

Bu, `dist\Harmoni.exe` dosyasını üretir. MediaPipe büyük ikili varlıklar içerdiğinden çıktı boyutu derleme ortamında kurulu olan pakete bağlı olarak değişir (yalnızca `requirements.txt` kuruluyken tipik olarak ~150 MB civarındadır). CI, `.github/workflows/ci.yml` altında `--self-test`'i Linux ve Windows üzerinde Python 3.10/3.11 ile çalıştırır.

## Test

Kamera ve mikrofon açmadan çekirdek testleri çalıştırmak:

```bash
python harmoni.py --self-test
```

25 adımlık test seti; pitch algılama, vokal DSP, armoni motoru, synth, vokal ducking, parlaklık/artikülasyon kontrolleri, opsiyonel FluidSynth katmanının zarifçe devre dışı kalması, sürekli jest ifadesi, ayar kalıcılığı, MIDI/WAV dışa aktarım, makam ölçek bütünlüğü ve algılama, bağlama sentezi, perde adlandırma, yeni orkestra sesleri (gitar/keman/davul dahil), katman sayısı kazanç telafisi, otomatik düzenleme, dizi rengi, klavye kısayolu bütünlüğü, orkestra oda reverb'inin gerçekten sönmesi, düşük gecikme başlatma, kamera backend yedekleme ve arayüz performansını denetler. Bu paketteki test çalışmasında arayüz yaklaşık 15-40 FPS üretmiştir; gerçek sonuç bilgisayara göre değişir.

## Ses gecikmesi

Ses gecikmesi (mikrofon → işlem → hoparlör arasındaki süre) hiçbir dijital ses sisteminde matematiksel olarak sıfır olamaz — fiziksel olarak en az bir arabellek (buffer) süresi kadar gecikme her zaman vardır. Harmoni bunu pratikte fark edilmeyecek kadar düşük tutmaya çalışır:

- Ses bloğu **256 örnek** (48 kHz'de ~5.3 ms) — zaten çok düşük bir değer.
- `--low-latency` bayrağı Windows'ta **WASAPI exclusive** modunu dener; bu, işletim sisteminin paylaşımlı ses karıştırıcısını (audio mixer) atlayarak host tarafındaki ek gecikmeyi (genelde paylaşımlı modda 20-40 ms) büyük ölçüde azaltır. Aygıt uygun değilse (başka bir uygulama kullanıyor, format desteklenmiyor) sessizce normal moda döner — asla çökme veya sessizlik yaratmaz.
- Gerçek toplam gecikme HUD'un sağ üst kartında canlı olarak `ms` cinsinden gösterilir; bu sayı bilgisayara, ses sürücüsüne ve seçilen moda göre değişir.
- Vokal DSP zincirindeki tüm filtreler (Bölüm 3.1'de) vektörize edilmiştir; ses geri çağırma (callback) fonksiyonu içinde yavaş Python döngüsü kalmamıştır — bu, gecikmeden çok kesinti/pop sesi riskini azaltır ama dolaylı olarak gecikmeyi de öngörülebilir kılar.

## Kamera sorun giderme

**"Kamera indeksi" ne demek?** Bilgisayarınıza bağlı her kamera (dahili webcam, USB kamera, sanal kamera yazılımları) işletim sistemi tarafından `0`'dan başlayan bir numarayla sıralanır. Çoğu bilgisayarda dahili kamera `0`'dır, ama başka bir kamera veya sanal kamera sürücüsü kuruluysa gerçek kameranız `1`, `2`... olabilir. `--camera 1` gibi bir bayrak, "0 yerine 1 numaralı kamerayı dene" demektir.

Kamera açılmazsa veya "Kamera bekleniyor" ekranında kalırsa:

1. Konsoldaki `[UYARI] Kamera bulunamadi: ...` mesajını oku — hangi backend'in hangi hatayla başarısız olduğunu gösterir.
2. `python harmoni.py --camera auto` ile bulunan ilk kamerayı otomatik kullan.
3. Kamerayı başka bir uygulama (Teams, tarayıcı, OBS vb.) kullanıyor olabilir; o uygulamayı kapatıp tekrar dene.
4. Belirttiğin indeks açılamazsa uygulama artık otomatik olarak diğer indeksleri (0-4) dener; konsolda hangi indeksin kullanıldığı yazar.
5. Windows'ta uygulama sırasıyla DSHOW, MSMF ve genel (ANY) backend'lerini dener; `isOpened()` başarılı görünse bile gerçek bir kare okunamıyorsa o backend atlanır.

## Kaynaklar ve araştırma

Bu sürümdeki geliştirmeler için araştırılan ve (belirtilenler ölçüsünde) uygulamaya entegre edilen kaynaklar:

- **Türk makam perde tabloları**: [sonic-pi-net/sonic-pi #1705](https://github.com/sonic-pi-net/sonic-pi/pull/1705) — AEU 53 komalı sistemin dörtlü/beşli yapı taşları (uygulandı).
- **SymbTr / makam MIR araçları**: [MTG/SymbTr](https://github.com/MTG/SymbTr) (2200+ eser, 155 makam sembolik veri kümesi), [MTG/tomato](https://github.com/sertansenturk/tomato) (Türk-Osmanlı makam analiz araç kutusu), [MTG/otmm_makam_recognition_dataset](https://github.com/MTG/otmm_makam_recognition_dataset) — referans alındı, veri kümesi boyutu nedeniyle indirilip gömülmedi; gelecekte makam algılama motorunu kalibre etmek için kullanılabilir.
- **Fiziksel modelleme (Karplus-Strong)**: [luciopaiva/karplus](https://github.com/luciopaiva/karplus), Karplus & Strong (1983) — bağlama sentezinin temel algoritması (uygulandı).
- **CREPE tabanlı nöral perde tespiti**: [maxrmorrison/torchcrepe](https://github.com/maxrmorrison/torchcrepe) — araştırıldı, entegre edilmedi (bkz. [Kapsam dışı bırakılanlar](#kapsam-dışı-bırakılanlar)).
- **Kaynak ayırma**: [facebookresearch/demucs (HTDemucs)](https://github.com/facebookresearch/demucs) — araştırıldı, entegre edilmedi.
- **Nöral tını sentezi**: [magenta/ddsp](https://github.com/magenta/ddsp) — araştırıldı, entegre edilmedi.
- **Benzer jest-müzik projeleri**: [eoinfennessy/webcam-theremin](https://github.com/eoinfennessy/webcam-theremin), [Jayesh-git-hub/air_music](https://github.com/Jayesh-git-hub/air_music) — mimari fikir alışverişi için incelendi.

## Kapsam dışı bırakılanlar

Aşağıdakiler araştırıldı ve bilinçli olarak **uygulanmadı**; sebep şeffaflık için burada belirtilmiştir (yanlış/eksik bir uygulamayı "tamamlandı" gibi göstermemek için):

- **HTDemucs kaynak ayırma**: Bu uygulama canlı mikrofon girişiyle çalışan bir performans aracıdır, önceden kaydedilmiş karışık şarkı dosyalarını analiz etmez; HTDemucs (vokal/davul/bas ayırma) bu akışa uymaz. Ayrıca modeli indirmek gigabaytlarca veri ve GPU/CPU'da yavaş çıkarım gerektirir.
- **DDSP nöral tını transferi**: Enstrüman başına eğitilmiş TensorFlow modelleri gerektirir; gerçek-zamanlı, tek dosyalı, CPU-öncelikli bu uygulamaya entegre etmek ayrı ve büyük bir mühendislik projesidir.
- **torchcrepe (nöral perde tespiti)**: Mevcut otokorelasyon tabanlı `PitchTracker` gerçek zamanlı ve donanımsız çalışıyor; torch tabanlı CREPE modeli CPU'da gözle görülür gecikme ekler ve büyük bir bağımlılık (torch) getirir. Gelecekte opsiyonel bir "yüksek doğruluk" modu olarak eklenebilir.
- **Tam TD-PSOLA vokal düzeltme**: Gerçek periyot-senkron grain pencereleme, çoklu periyotluk arabellek ve daha yüksek gecikme gerektirir; bu uygulamanın 256 örneklik (~5ms) düşük gecikme hedefiyle gerilir. Mevcut `HarmonyEngine`, notaları zorla perdeye çekmek yerine yalnızca **eşliği** söylenen sese uydurur — vokalin kendisine dokunulmaz, bu yüzden ifade/duygu hiç kaybolmaz.
- **GTMM (Üretici Makam Teorisi) bilişsel/semiyotik modeli**: Araştırma düzeyinde bir modelleme çerçevesidir; makam motoru burada yalnızca perde dizisi + durak/güçlü ağırlıklandırması kullanan basitleştirilmiş bir yaklaşım uygular (bkz. [Türk makam sistemi](#türk-makam-sistemi)).
- **Mikrotonal MIDI/MPE dışa aktarım**: `mido` ile yazılan `.mid` dosyaları standart 12-TET'tir; MPE/MTS ile tam komma-hassasiyetinde dışa aktarım ayrı bir özellik olarak eklenebilir.

## Ses kullanımı

Canlı vokal monitoring sırasında kulaklık kullan. Hoparlörden çıkan işlenmiş ses tekrar mikrofona girerse gecikmeli yankı, ötme ve pitch algılama hatası oluşabilir.
