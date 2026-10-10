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
- **Apple Watch komplikasyonu ve km titreşimi** — haftalık hedef halkası + hücre sayısı (dairesel, dikdörtgen, satır içi,
  köşe); telefon istatistikleri saate gönderir. Saatte her km'de titreşim (telefondaki titreşim ayarını izler).
- **Sunucu: `runner_watch` kaynağı ve `synthetic_route` kontrolü** (`0007_watch_source_checks.sql`) — saat uygulamasıyla
  kaydedilen aktiviteler ayrı etiketleniyor; hızı ve örnekleme aralığı tamamen sabit (üretilmiş/çizilmiş) rotalar reddediliyor.
  Yeni kontroller artık `activity_extra_checks()` içine ekleniyor.
- **Android pil optimizasyonu yönlendirmesi** — başlat ekranı ve Ayarlar'da uyarı, üreticiye özel adımlar.
  Gerçek cihaz test protokolü: [device-testing.md](device-testing.md).
- **Push bildirimleri** — token kaydı, `send-push` Edge Function, bildirime dokununca yönlendirme. Yayına alma adımları README'de.

## P1

### Akıllı saat entegrasyonu (kalanlar)
Kullanıcılar aktiviteyi telefonsuz başlatabilmeli, bilekten takip edebilmeli ve kazandığı hücreleri saatten görebilmeli.

- **Apple Watch (kalanlar)**
  - Saatten telefondaki kaydı başlatma (şu an saatten başlatılan kayıt saatte yapılır; telefonu arka planda uyandırıp konum
    takibini başlatmak iOS'ta güvenilir değil).
  - Saatte kayıt sırasında kalp atışı (isteğe bağlı, gizlilik kararı gerekir).
- **Wear OS uygulaması** (Kotlin, Compose for Wear OS): aynı akış; Health Services `ExerciseClient` ile kayıt, Data Layer API ile telefonla senkron; Tile ve komplikasyon.
- **Üçüncü taraf saatler (Garmin, Polar, Coros, Suunto)**: saat uygulaması yerine **aktivite içe aktarma**.
  - Garmin Connect / Polar AccessLink / Coros / Suunto API'leri üzerinden OAuth ile bağlanma, tamamlanan aktivitelerin (GPX/FIT) otomatik içe aktarılması.
  - İsteğe bağlı: Garmin Connect IQ veri alanı/uygulaması.
- **Sunucu tarafı**
  - ~~Kaynak alanı ve cihaz bilgisi~~, ~~`runner_watch` kaynağı~~, ~~sabit hızlı üretilmiş rota tespiti~~ (yapıldı).
  - Ek sezgiler: FIT dosyası cihaz bilgisi, nabız verisinin varlığı (üçüncü taraf içe aktarma gelince).
  - Aynı aktivitenin hem telefondan hem saatten gelmesini engelleme (zaman çakışması kuralı zaten var; kaynak önceliği eklenmeli).
- **Açık soru**: Hangi üçüncü taraf markalar öncelikli (Garmin, Polar, Coros, Suunto)?

### Gerçek cihaz testleri
[device-testing.md](device-testing.md) protokolüyle: 2+ saatlik aktivitelerde pil tüketimi ve veri kaybı, saat senaryoları,
Android üretici pil optimizasyonları. (Yönlendirme uygulandı; testler cihazda koşulmalı.)

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
