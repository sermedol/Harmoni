# Harmoni Web Müzikal Modeli

## Ne ölçülüyor?

- Mikrofon RMS seviyesi
- Monofonik temel frekans, float MIDI, nota, cent ve güven
- Kararlı nota süresi
- El landmark’ları, açıklık, hız, pinch ve iki el mesafesi

## Ne tahmin ediliyor?

- Vokal cümlesinin attack/active/release/gap durumu
- `western:auto` seçiliyken ağırlıklı pitch-class histogramından majör/minör tonal merkez
- Tahminler hysteresis ve minimum kanıt süresi kullanır; otomatik tonalite **Beta** kabul edilir.

## Ne kullanıcı tarafından seçiliyor?

- Sahne/preset, Batı dizisi veya makam
- Tempo, aktif katmanlar, ana eşlik seviyesi
- Hoparlör veya kulaklık/müzik giriş profili
- Vokal duyumu

## Ne deneysel?

- Makam eşliği ve koma tabanlı sentez
- Otomatik Batı tonal merkezi
- Tarayıcı tabanlı sentetik enstrüman tınıları

## Ne henüz desteklenmiyor?

- Otomatik makam sınıflandırması ve geçki
- Polifonik vokal/instrument pitch ayrıştırma
- Pitch correction
- Sample/SoundFont tabanlı gerçek enstrüman iddiası

Makam yalnız bir dizi olarak değerlendirilmez. Mevcut web sürümündeki makam eşliği deneysel ve seçilen makam/durak çevresinde sınırlıdır; geleneksel icranın eksiksiz modeli değildir.
