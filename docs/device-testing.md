# Gerçek cihaz test protokolü

Simülatör ve emülatör; GPS kalitesini, pil tüketimini, arka planda uygulamanın durdurulmasını ve saat–telefon eşitlemesini
gerçekçi göstermez. Her sürümden önce aşağıdaki senaryolar gerçek cihazlarda koşulur ve sonuçlar tabloya yazılır.

## Hazırlık

- Telefon şarjı %100, ekran parlaklığı otomatik, düşük güç modu kapalı (ayrıca bir tur açık).
- Runner'da konum izni "Her zaman"; Android'de pil optimizasyonu kapalı (Ayarlar → Gizlilik → Pil optimizasyonu).
- Sunucu bağlıysa hesapla giriş yapılmış; değilse "yalnızca bu cihaz" modunda da bir tur.

## Senaryolar

| # | Senaryo | Nasıl | Beklenen |
|---|---|---|---|
| 1 | Uzun yürüyüş, ekran kilitli | 2+ saat yürüyüş, telefon cepte | Rota kesintisiz; pil tüketimi kayıt başına not edilir (hedef: saatte ≤ %8) |
| 2 | Uygulama sistemden kapatılırsa | Kayıt sırasında başka ağır uygulamalar aç, 20 dk sonra Runner'a dön | Kayıt sürüyor; dönüşte rota ve süre eksiksiz |
| 3 | Telefon yeniden başlarsa | Kayıt sırasında telefonu yeniden başlat, Runner'ı aç | Kayıt duraklatılmış olarak geri gelir, veri kaybı yok |
| 4 | Tünel / kapalı alan | Metro veya alt geçitten geç | "GPS yok" uyarısı; çıkışta düz çizgi yerine yeni nokta; hata mesajı gösterilmez |
| 5 | Çevrimdışı kayıt | Uçak modunda kayıt + kaydet, sonra interneti aç | Aktivite kuyrukta bekler, internet gelince yüklenir |
| 6 | Saatte telefonsuz kayıt (Apple Watch) | Telefonu evde bırak, saatten 30+ dk koşu | Saatte mesafe/tempo makul; telefona dönünce Runner açılınca özet gelir |
| 7 | Saatle yansıtma | Telefonda kayıt başlat, saatte Runner'ı aç | Saat canlı metrikleri gösterir; Duraklat/Devam/Bitir telefonda uygulanır |
| 8 | Saat bildirim titreşimi | Saatte 2+ km kayıt | Her km'de bir titreşim (telefonda titreşim ayarı açıksa) |
| 9 | Health Connect (Android) | Wear OS / Samsung Health / Garmin ile kayıtlı antrenmanı içe aktar | Rota izni istenir; özet ve hücre tahmini gelir |
| 10 | Komplikasyon | Saat kadranına Runner komplikasyonunu ekle, bir aktivite kaydet | Haftalık halka ve hücre sayısı birkaç dakika içinde güncellenir |

## Android üretici notları

Bazı üreticiler sistem ayarına ek olarak kendi uygulama kapatıcılarını kullanır. Runner, başlat ekranında pil
optimizasyonu açıksa uyarı ve üreticiye özel adımları gösterir (`mobile/src/services/batteryGuidance.ts`). Testte
özellikle Xiaomi (MIUI/HyperOS), Samsung (One UI), Huawei/Honor ve Oppo/Realme/OnePlus cihazlarında senaryo 1 ve 2 koşulmalı.

## Sonuç tablosu

| Tarih | Cihaz / OS | Senaryo | Süre | Pil % | Sonuç | Not |
|---|---|---|---|---|---|---|
| | | | | | | |
