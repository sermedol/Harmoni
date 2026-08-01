# Kamera sistemi

## Yaşam döngüsü

`Camera`, tek aktif stream ilkesini uygular. `start()` eşzamanlı çağrıları tek promise
üzerinde birleştirir; her yeni başlangıç eski track'leri kapatır. Durumlar
`requesting`, `starting`, `online`, `interrupted`, `offline` ve `error` olarak
`statechange` olayıyla yayınlanır.

Kamera sırasıyla 1080p, 720p, 540p, 640×480 ve cihaz varsayılanını dener. Arayüz
talep edilen değerleri değil `MediaStreamTrack.getSettings()` sonucunu gösterir.

## Görüntü ve koordinatlar

Ana sahne ile MediaPipe girdisi aynı merkezî `cover` kırpmasını ve aynı ayna
dönüşümünü kullanır. Ön kamera otomatik aynalanır; arka kamera aynalanmaz.
Sahne canvas'ı cihaz piksel oranını en fazla 1.5× kullanır. MediaPipe çözünürlüğü
ana görüntüden bağımsızdır ve otomatik profilde işlem maliyetine göre
768×432, 640×360 veya 480×270 arasında kademeli değişir.

## Gizlilik

Kamera karesi yalnızca tarayıcı içinde Canvas ve MediaPipe tarafından işlenir.
Kodda kamera karesini bir sunucuya gönderen `fetch`, WebSocket veya upload hattı
yoktur. Kayıt yalnızca kullanıcı açıkça başlattığında yerel Blob olarak üretilir.

## Tarayıcı sınırları

Gerçek çözünürlük, FPS, kamera etiketi ve ön/arka kamera davranışı donanım ile
tarayıcıya bağlıdır. iOS Safari ekran kilidinden dönüşte track'i sonlandırabilir;
Harmoni bunu algılar ve kullanıcıya yeniden başlatma sunar. Fiziksel odak,
pozlama ve beyaz dengesi yalnızca cihaz destekliyorsa sürekli moda alınır.
