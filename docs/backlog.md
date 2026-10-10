# Runner — Backlog

Öncelik: **P1** sonraki sürüm · **P2** yakın dönem · **P3** fikir/araştırma.

## P1

### Akıllı saat entegrasyonu
Kullanıcılar aktiviteyi telefonsuz başlatabilmeli, bilekten takip edebilmeli ve kazandığı hücreleri saatten görebilmeli.

- **Apple Watch uygulaması** (watchOS, SwiftUI): başlat/duraklat/bitir, süre/mesafe/tempo, GPS durumu, kazanılan hücre sayısı.
  - Telefon yanındayken WatchConnectivity ile canlı senkron; telefonsuz koşuda saatin GPS'iyle kayıt (HKWorkoutSession + CLLocation), bitince rota telefona aktarılır.
  - Komplikasyon / Smart Stack: haftalık hedef halkası, sahip olunan hücre sayısı.
  - Expo tarafında: watch target için config plugin (ör. `@bacons/apple-targets`) veya ayrı Xcode target; JS ile WatchConnectivity köprüsü.
- **Wear OS uygulaması** (Kotlin, Compose for Wear OS): aynı akış; Health Services `ExerciseClient` ile kayıt, Data Layer API ile telefonla senkron; Tile ve komplikasyon.
- **Üçüncü taraf saatler (Garmin, Polar, Coros, Suunto)**: saat uygulaması yerine **aktivite içe aktarma**.
  - Garmin Connect / Polar AccessLink / Coros / Suunto API'leri üzerinden OAuth ile bağlanma, tamamlanan aktivitelerin (GPX/FIT) otomatik içe aktarılması.
  - İsteğe bağlı: Garmin Connect IQ veri alanı/uygulaması.
- **Sunucu tarafı**
  - `submit_activity` için kaynak alanı (`source`: phone / apple_watch / wear_os / garmin …) ve cihaz kimliği.
  - İçe aktarılan aktivitelerde de aynı hile önleme kontrolleri; harici kaynaklarda `mocked` bilgisi olmadığından ek sezgiler (ör. FIT dosyası cihaz bilgisi, nabız verisinin varlığı).
  - Aynı aktivitenin hem telefondan hem saatten gelmesini engelleme (zaman çakışması kuralı zaten var; kaynak önceliği eklenmeli).
- **Sağlık platformları**: HealthKit / Health Connect entegrasyonu (şu an yok; ayarlarda "desteklenmiyor" yazıyor). Saat verisinin büyük kısmı buradan gelir; önce bunun yapılması önerilir.
- **Açık sorular**: Saatte harita gösterilecek mi (pil/performans)? Telefonsuz kayıt MVP'ye girecek mi? Hangi üçüncü taraf markalar öncelikli?

### Push bildirimleri
Expo push token kaydı + `notifications` tablosuna yapılan insert'leri gönderen Edge Function (bölge kaybı, takip isteği, kulüp daveti).

### Gerçek cihaz testleri
2+ saatlik aktivitelerde pil tüketimi ve veri kaybı; Android üretici pil optimizasyonları (Xiaomi, Samsung vb.) için kullanıcı yönlendirmesi.

## P2

- **Onaylı marka kılavuzu**: `theme.ts` (marka ana rengi, görüntü yazı tipi) ve ikon/splash kaynağının (`scripts/generate-brand-assets.mjs`) güncellenmesi.
- **Davet kodlu arkadaş yarışmaları** (`challenges` tabloları hazır) ve kulüp bölgeleri (üyelerin hücreleri).
- **Bölge savunma / çürüme mekaniği**: uzun süre ziyaret edilmeyen hücrelerin zayıflaması; yeni ele geçirilen hücreye kısa koruma süresi.
- **İlçe/şehir adıyla sıralama**: ters geocoding servisi; şu an yarıçap tabanlı (5 / 25 km).
- **Sıralama değişim okları**: haftalık sıralama anlık görüntüleri.
- **Topluluk görevleri** (tasarımdaki "50 boş hücreyi birlikte doldurun").

## P3

- Güvenli rota önerileri (yalnızca uygun veri sağlayıcısıyla; güvenlik garantisi gibi sunulmamalı).
- Canlı Etkinlik (iOS kilit ekranı) ve Android kalıcı bildirimde duraklat/bitir eylemleri.
- İş ortaklığı içeriği: onaylı kampanyalar geldiğinde sponsorlu görev akışı (ayrı ürün/hukuk incelemesi).
