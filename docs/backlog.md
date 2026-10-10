# Runner — Backlog

Öncelik: **P1** sonraki sürüm · **P2** yakın dönem · **P3** fikir/araştırma.

## Tamamlanan

- **Apple Sağlık içe/dışa aktarma** — Apple Watch (veya başka uygulama) antrenmanları rotasıyla içe aktarılıp hücre kazandırıyor;
  aktiviteler isteğe bağlı olarak Sağlık'a yazılıyor. Sunucuda `source`, `external_id`, `source_device` alanları ve tekrar içe
  aktarma engeli (`0006_activity_source.sql`). Gerçek saat verisiyle cihaz testi bekliyor.
- **Push bildirimleri** — token kaydı, `send-push` Edge Function, bildirime dokununca yönlendirme. Yayına alma adımları README'de.

## P1

### Akıllı saat entegrasyonu (kalanlar)
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
  - ~~Kaynak alanı ve cihaz bilgisi~~ (yapıldı: `source`, `source_device`); yerel saat uygulamaları için yeni kaynak değerleri eklenecek.
  - İçe aktarılan aktivitelerde de aynı hile önleme kontrolleri; harici kaynaklarda `mocked` bilgisi olmadığından ek sezgiler (ör. FIT dosyası cihaz bilgisi, nabız verisinin varlığı).
  - Aynı aktivitenin hem telefondan hem saatten gelmesini engelleme (zaman çakışması kuralı zaten var; kaynak önceliği eklenmeli).
- **Health Connect (Android)**: Apple Sağlık içe aktarmasının Android karşılığı (Wear OS ve Samsung/Garmin senkronlu veriler buradan gelir).
- **Açık sorular**: Saatte harita gösterilecek mi (pil/performans)? Telefonsuz kayıt MVP'ye girecek mi? Hangi üçüncü taraf markalar öncelikli?

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
