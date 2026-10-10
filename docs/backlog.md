# Runner — Backlog

Öncelik: **P1** sonraki sürüm · **P2** yakın dönem · **P3** fikir/araştırma.

## Tamamlanan

- **Apple Sağlık içe/dışa aktarma** — Apple Watch (veya başka uygulama) antrenmanları rotasıyla içe aktarılıp hücre kazandırıyor;
  aktiviteler isteğe bağlı olarak Sağlık'a yazılıyor. Sunucuda `source`, `external_id`, `source_device` alanları ve tekrar içe
  aktarma engeli (`0006_activity_source.sql`). Gerçek saat verisiyle cihaz testi bekliyor.
- **Health Connect içe/dışa aktarma (Android)** — Wear OS, Galaxy Watch ve telefon uygulaması Health Connect'e yazan saatlerin
  (Garmin, Polar…) antrenmanları rotasıyla içe aktarılıyor; rota için Health Connect her antrenmanda ayrıca onay istiyor.
  iOS ve Android tek bir sağlık katmanını (`services/health`) kullanıyor. Play Store yayını için Health Connect izin beyanı gerekli.
- **Apple Watch uygulaması (ilk sürüm)** — `mobile/targets/watch` (SwiftUI) + `mobile/modules/runner-watch` (WatchConnectivity köprüsü).
  Saatten başlatılan kayıt saatin GPS'iyle yapılır (HKWorkoutSession + CoreLocation, telefondakiyle aynı GPS filtresi),
  antrenman rotasıyla Sağlık'a yazılır ve telefon otomatik içe aktarır. Telefonda kayıt sürerken saat onu yansıtır ve
  duraklat/devam/bitir komutlarını iletir. Haritasız (pil). Kararlar: saatte harita yok; iki mod birden; önce Apple Watch.
- **Push bildirimleri** — token kaydı, `send-push` Edge Function, bildirime dokununca yönlendirme. Yayına alma adımları README'de.

## P1

### Akıllı saat entegrasyonu (kalanlar)
Kullanıcılar aktiviteyi telefonsuz başlatabilmeli, bilekten takip edebilmeli ve kazandığı hücreleri saatten görebilmeli.

- **Apple Watch (kalanlar)**
  - Komplikasyon / Smart Stack: haftalık hedef halkası, sahip olunan hücre sayısı.
  - Saatten telefondaki kaydı başlatma (şu an saatten başlatılan kayıt saatte yapılır; telefonu arka planda uyandırıp konum
    takibini başlatmak iOS'ta güvenilir değil).
  - Saatte sesli/titreşimli km bildirimi; saat dışı kayıt sırasında kalp atışı (isteğe bağlı, gizlilik kararı gerekir).
- **Wear OS uygulaması** (Kotlin, Compose for Wear OS): aynı akış; Health Services `ExerciseClient` ile kayıt, Data Layer API ile telefonla senkron; Tile ve komplikasyon.
- **Üçüncü taraf saatler (Garmin, Polar, Coros, Suunto)**: saat uygulaması yerine **aktivite içe aktarma**.
  - Garmin Connect / Polar AccessLink / Coros / Suunto API'leri üzerinden OAuth ile bağlanma, tamamlanan aktivitelerin (GPX/FIT) otomatik içe aktarılması.
  - İsteğe bağlı: Garmin Connect IQ veri alanı/uygulaması.
- **Sunucu tarafı**
  - ~~Kaynak alanı ve cihaz bilgisi~~ (yapıldı: `source`, `source_device`); yerel saat uygulamaları için yeni kaynak değerleri eklenecek.
  - İçe aktarılan aktivitelerde de aynı hile önleme kontrolleri; harici kaynaklarda `mocked` bilgisi olmadığından ek sezgiler (ör. FIT dosyası cihaz bilgisi, nabız verisinin varlığı).
  - Aynı aktivitenin hem telefondan hem saatten gelmesini engelleme (zaman çakışması kuralı zaten var; kaynak önceliği eklenmeli).
- **Açık soru**: Hangi üçüncü taraf markalar öncelikli (Garmin, Polar, Coros, Suunto)?

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
