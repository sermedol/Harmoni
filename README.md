# Harmoni V3

Harmoni; kamera açıkken elleri takip eden, mikrofondan söylenen melodiyi analiz eden, vokalin altında piyano eşliği üreten ve el hareketleriyle ek enstrüman katmanlarını yöneten masaüstü Python uygulamasıdır.

Bu sürüm özellikle iki sorunu düzeltir:

- Kamera okuma, el algılama ve arayüz çizimi artık aynı döngüde değildir.
- Piyano varsayılan olarak vokalin belirgin biçimde altındadır ve vokal başladığında otomatik olarak daha da kısılır.

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

- Başlangıç piyano seviyesi `0.27` olarak ayarlanmıştır.
- Şarkı söylenirken side-chain ducking piyano ve diğer katmanları yaklaşık 7-10 dB geri çeker.
- Vokal miks seviyesi artırılmıştır.
- Piyano arpeji şarkı sırasında seyrekleşir; nefes boşluklarında biraz daha dolu çalar.
- Yaylı, pad, bas ve davul katmanlarının seviyeleri düşürülmüştür.

## Kurulum

Python 3.10 veya 3.11 önerilir.

```bash
python -m pip install -r requirements.txt
```

Linux'ta `sounddevice` için PortAudio gerekebilir:

```bash
sudo apt install libportaudio2 portaudio19-dev
```

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

Canlı mikrofon monitoring olmadan başlatmak:

```bash
python harmoni.py --no-monitor
```

## Performans profilleri

| Profil | Kamera | El algılama | Kullanım |
|---|---:|---:|---|
| `fast` | 640×360 | 384 px, 3 karede bir | Eski veya düşük güçlü bilgisayar |
| `balanced` | 960×540 | 512 px, 2 karede bir | Varsayılan |
| `quality` | 1280×720 | 640 px, her kare | Güçlü bilgisayar |

## Tuşlar

| Tuş | İşlev |
|---|---|
| `Q` / `Esc` | Çıkış |
| `H` | Arayüzü aç/kapat |
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
| `S` | Ekran görüntüsü |
| `R` | Video kaydı |
| `1-4` | Tema değiştir |

## Jestler

| Jest | İşlev |
|---|---|
| Sağ açık el | Yaylıları açar |
| Sol açık el | Yumuşak pad katmanını açar |
| İki açık el | Tam orkestrayı açar; el mesafesi yoğunluğu değiştirir |
| Peace | Ritmi açar/kapatır |
| Yumruk | Ek katmanları susturur |
| İşaret | Katmanlar arasında seçim yapar |
| Pinch | Reverb ve echo miktarını değiştirir |

## İlk ayar

Daha önce gönderilen vokal örneğine göre başlangıç tonalitesi `G# minor`, tempo `88 BPM` ve vokal merkez bölgesi yaklaşık `B3` çevresine ayarlanmıştır. Sistem yeterli nota duyduğunda tonaliteyi otomatik olarak değiştirir.

## Test

Kamera ve mikrofon açmadan çekirdek testleri çalıştırmak:

```bash
python harmoni.py --self-test
```

Testler pitch algılama, vokal DSP, armoni motoru, synth, vokal ducking ve arayüz performansını denetler. Bu paketteki test çalışmasında arayüz yaklaşık 46 FPS üretmiştir; gerçek sonuç bilgisayara göre değişir.

## Ses kullanımı

Canlı vokal monitoring sırasında kulaklık kullan. Hoparlörden çıkan işlenmiş ses tekrar mikrofona girerse gecikmeli yankı, ötme ve pitch algılama hatası oluşabilir.
