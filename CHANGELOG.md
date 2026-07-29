# Harmoni V3 değişiklikleri

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
