# Performans notları

Test ortamında 1280×720 sentetik kare üzerinde, eller olmadan yalnızca arayüz çizimi ölçüldü.

- Önceki sürüm: yaklaşık **0.84 FPS**
- Harmoni V3, önbellek ısındıktan sonra: yaklaşık **93.7 FPS**
- Harmoni V3 self-test içinde ilk önbellek kurulumu dâhil: yaklaşık **46 FPS**

Bu ölçüm gerçek kamera ve MediaPipe maliyetini içermez; bilgisayardaki gerçek sonuç farklı olur. Büyük farkın ana nedeni önceki sürümde her karede yapılan şu işlemlerin kaldırılmasıdır:

- 105 sigma tam-kare Gaussian blur
- Her arayüz kartı için ayrı tam-kare gölge maskesi ve Gaussian blur
- Tam çözünürlükte MediaPipe çalıştırma
- Kamera okumasını ana arayüz döngüsünde bekletme

Gerçek kullanımda önce `balanced`, sorun devam ederse `fast` profili önerilir.
