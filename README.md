# Runner

Yürüyüş, koşu ve bisiklet aktivitelerini gerçek dünyada bölge sahiplenme oyununa dönüştüren mobil uygulama (MVP).

- **mobile/** — Expo SDK 57 / React Native 0.86 / TypeScript (iOS + Android)
- **supabase/** — Postgres + PostGIS şeması, RLS, sunucu tarafı doğrulama ve bölge hesabı
- **docs/architecture.md** — mimari, oyun kuralları, hile önleme ve gizlilik ayrıntıları

> Arayüz, "Runner × Skechers — İş Ortaklığı Konsepti" tasarım kanvasındaki tasarım sistemi v0.1'e göre uygulandı
> (tokenlar: `mobile/src/theme/theme.ts`, bileşenler: `mobile/src/components/`). Marka ana rengi ve görüntü yazı tipi
> tasarımdaki gibi **yer tutucudur**; onaylı marka kılavuzu gelince tek noktadan değiştirilir. Skechers logosu, ürün
> görseli veya marka yazı tipi kullanılmadı. Uygulama ikonu, splash ve açılış animasyonu kanvastaki "Logo" ve "Açılış ekranı" çalışmalarından üretildi
> (`npm run brand-assets`, kaynak: `mobile/scripts/generate-brand-assets.mjs`).

## Gereksinimler

- Node 20+ (Node 26 ile test edildi), npm
- iOS: Xcode 26+, CocoaPods · Android: Android Studio, SDK, JDK 17+
- Backend için: bir Supabase projesi (veya Supabase CLI ile yerel kurulum)
- SQL testleri için: Docker

## Mobil uygulamayı çalıştırma

Arka plan konumu ve harita yerel modül gerektirdiği için **Expo Go yerine development build** kullanılır.

```bash
cd mobile
npm install
cp .env.example .env.local   # isteğe bağlı: boş bırakılırsa "yalnızca bu cihaz" modunda çalışır
npx expo run:ios             # veya: npx expo run:android
```

> CocoaPods, terminal locale'i UTF-8 değilse `Unicode Normalization not appropriate for ASCII-8BIT` hatası verir;
> `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` ile çalıştır.

`.env.local` değişkenleri:

| Değişken | Açıklama |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase projesi. Yoksa bölge, sosyal ve sıralama özellikleri arayüzde "sunucu bağlı değil" olarak gösterilir. |
| `EXPO_PUBLIC_OAUTH_PROVIDERS` | `apple,google` — yalnızca Supabase'de etkinleştirilmiş sağlayıcılar. |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Android'de harita için zorunlu (iOS Apple Haritalar kullanır). |
| `APP_BUNDLE_ID` | Varsayılan `app.runner.mobile`. |
| `APPLE_TEAM_ID` | Gerçek iPhone'a kurulum için Apple Developer ekip kimliği. |
| `EAS_PROJECT_ID` | Push bildirimleri için Expo/EAS proje kimliği (`npx eas-cli init`). Yoksa push kapalıdır. |

Kontroller:

```bash
npm test            # domain birim testleri (jest)
npm run typecheck
npm run lint
```

### Simülatörde GPS ile deneme (iOS)

```bash
xcrun simctl location booted start --speed=3 41.0422,29.0083 41.0440,29.0083 41.0440,29.0110 41.0422,29.0110 41.0422,29.0084
```

Bu komut ~1 km'lik bir döngüyü 3 m/s hızla yürütür. Durdurmak için: `xcrun simctl location booted clear`.

### Apple Watch uygulaması

Saat uygulaması `mobile/targets/watch/` altında (SwiftUI, watchOS 10+). `@bacons/apple-targets` eklentisi `npx expo prebuild`
sırasında onu Xcode projesine `RunnerWatch` hedefi olarak ekler; iOS uygulamasıyla birlikte derlenip saate kurulur. Telefon
ile saat arasındaki köprü `mobile/modules/runner-watch/` yerel Expo modülüdür (WatchConnectivity).

- **Saatten başlatılan kayıt**: saatin GPS'iyle kaydeder (telefon gerekmez). Bitince antrenman rotasıyla Apple Sağlık'a
  yazılır ve telefona haber verilir; telefondaki Runner açıldığında antrenmanı içe aktarır ve özete götürür. Sağlık verisi
  saatten telefona gecikmeli eşitlenebildiği için henüz görünmeyen antrenman bir sonraki açılışta yeniden denenir.
- **Telefonda kayıt sürerken**: saat telefondaki kaydı canlı gösterir (süre, mesafe, tempo, GPS, tahmini hücre) ve
  duraklat / devam / bitir komutlarını telefona iletir.
- Saatteki hücre sayısı yalnızca rota hücrelerinin tahminidir; kesin sonucu (kapalı döngü içi dahil) sunucu hesaplar.

Saat hedefinin paket kimliği iOS uygulamasınınkinin sonuna `.watchkitapp` eklenerek üretilir. Cihaza kurulumda paket
kimliğini `xcodebuild` parametresiyle ezmek yerine `APP_BUNDLE_ID` ve `APPLE_TEAM_ID` ile `npx expo prebuild --clean`
çalıştır; aksi halde saat uygulamasının eşlik eden uygulama kimliği tutmaz.

## Backend kurulumu (Supabase)

1. Supabase projesi oluştur; **Database → Extensions** altında `postgis` etkin olmalı (migration da etkinleştirir).
2. Migration'ları uygula:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   (veya `supabase/migrations/*.sql` dosyalarını sırayla SQL Editor'da çalıştır)
3. **Auth → URL Configuration**: `runner://auth-callback` adresini Redirect URL'lere ekle.
4. Apple/Google girişi için Auth → Providers altında sağlayıcıları yapılandır ve `EXPO_PUBLIC_OAUTH_PROVIDERS`'a ekle.
5. İsteğe bağlı: ham GPS noktalarını 30 gün sonra silmek için `pg_cron` ile `select public.purge_old_route_points(30);` zamanla.

### Push bildirimleri

1. `cd mobile && npx eas-cli init` ile proje kimliğini al, `.env.local`'a `EAS_PROJECT_ID` olarak yaz ve uygulamayı yeniden derle.
   iOS için Apple Push anahtarı EAS'e yüklenmeli (`npx eas-cli credentials`).
2. Edge Function'ı yayınla ve gizli anahtarı tanımla:
   ```bash
   npx supabase functions deploy send-push --no-verify-jwt
   npx supabase secrets set PUSH_WEBHOOK_SECRET=<rastgele-uzun-değer>
   ```
3. Supabase → Database → Webhooks: `public.notifications` tablosunda **INSERT** için `send-push` fonksiyonuna
   `x-webhook-secret: <aynı değer>` başlığıyla bir webhook ekle.

Uygulama, giriş yapıldığında ve bildirim tercihleri değiştiğinde cihaz token'ını `notification_prefs.push_token`'a yazar;
bildirime dokununca ilgili ekran açılır. Mesaj metinlerinin testleri: `node --test supabase/functions/send-push/messages.test.ts`.

### SQL testleri

```bash
supabase/tests/run.sh
```

Geçici bir PostGIS konteyneri başlatır, minimal bir `auth` şeması kurar, migration'ları uygular ve
`supabase/tests/territory_test.sql` içindeki senaryoları çalıştırır (döngü/koridor alanı, tekrar eden rota, ele geçirme,
sahte konum, ışınlanma, imkânsız hız, zaman çakışması, kopya rota, gizlilik alanı, RLS, takip/akış, sıralamalar,
kulüpler, veri ve hesap silme).

## MVP durumu

| Özellik | Durum |
|---|---|
| Onboarding (açılış, konum izni, bildirim tercihleri, profil) | Çalışıyor |
| E-posta ile kayıt/giriş | Çalışıyor (Supabase gerekir) |
| Apple / Google ile giriş | Kod hazır; Supabase'de sağlayıcı yapılandırması gerekir, cihazda doğrulanmadı |
| Ana harita, kendi/rakip bölgeler, boş/izin/hata durumları | Çalışıyor (bölgeler Supabase gerekir) |
| Aktivite öncesi sayfa: tür, canlı GPS sinyal kontrolü, izin durumu, görünürlük | Çalışıyor |
| Aktivite kaydı: başlat/duraklat/devam/basılı tutarak bitir/sil, canlı rota, süre/mesafe/tempo, tahmini alan, GPS durumu, ekran kilidi | Çalışıyor |
| Km başı sesli ve titreşimli geri bildirim | Çalışıyor (uygulama arka plandayken iOS sesi oynatmayabilir) |
| Arka planda / ekran kilitliyken kayıt | Uygulandı; gerçek cihazda uzun süreli test edilmedi |
| Aktivite özeti, kişisel rekor (en hızlı 5/10 km), haftalık hedef, kaydet/sil | Çalışıyor |
| Paylaşım gizlilik uyarısı: uçları gizle / yalnızca istatistik / tüm rota | Çalışıyor (sunucu rotayı buna göre üretir) |
| Görevler: haftalık mesafe hedefi (düzenlenebilir), tutarlılık görevleri | Çalışıyor (cihazda hesaplanır) |
| İş ortaklığı alanı | Yalnızca ayar + etiketli boş alan; **yayında kampanya/sponsorlu görev yok**, varsayılan kapalı |
| Sunucu tarafı doğrulama ve hücre sahipliği (altıgen ızgara) | Çalışıyor (SQL testleriyle doğrulandı) |
| Profil, istatistikler, rekorlar, geçmiş, detay, düzenle/sil | Çalışıyor |
| Akış, beğeni, takip/takipçi, kulüp oluştur/katıl | Çalışıyor (Supabase gerekir) |
| Sıralamalar: yakın (5 km) / şehir (25 km) / genel, arkadaşlar filtresi, benzer seviye, haftalık alan/toplam alan/tutarlılık | Çalışıyor (Supabase gerekir) |
| Bildirimler | Uygulama içi kutu, yerel hatırlatmalar, push (Edge Function + webhook; EAS proje kimliği ve kurulum gerekir, uçtan uca doğrulanmadı) |
| Ayarlar: görünürlük, gizli bölgeler, sıralamada görünme, birim, tema, bildirimler, iş ortaklığı içeriği, verilerimi indir (JSON), konum geçmişi/hesap silme | Çalışıyor |
| Apple Sağlık: Apple Watch / diğer uygulama antrenmanlarını rotasıyla içe aktarma, aktiviteleri Sağlık'a yazma | Uygulandı; gerçek Apple Watch verisiyle cihazda test edilmesi gerekiyor |
| Apple Watch uygulaması: saatte telefonsuz kayıt (Sağlık'a rotasıyla yazılır, telefon otomatik içe aktarır), telefondaki kaydı yansıtma ve saatten duraklat/devam/bitir | Uygulandı; watchOS simülatöründe kayıt akışı doğrulandı, gerçek saatte koşuyla test edilmedi |
| Health Connect (Android): Wear OS / Galaxy Watch / Garmin (telefon uygulaması üzerinden) antrenmanlarını rotasıyla içe aktarma, aktiviteleri Health Connect'e yazma | Uygulandı; Android 14 emülatöründe izin akışı doğrulandı, gerçek saat verisiyle test edilmedi. Google Play'de yayın için Health Connect izin beyanı (Play Console) gerekir |
| İlçe/şehir adıyla sıralama (tasarımdaki "Kadıköy / İstanbul") | Yarıçap tabanlı (5 / 25 km) olarak uygulandı; ad için ters geocoding servisi gerekir |
| Sıralama değişim okları (↑2) | Yok — geçmiş sıralama anlık görüntüleri gerekiyor |

## Sonraki adımlar

Ayrıntılı ve önceliklendirilmiş liste: [docs/backlog.md](docs/backlog.md). Öne çıkanlar:

1. Wear OS uygulaması; Apple Watch komplikasyonu.
2. Gerçek cihazda uzun aktivite pil ve veri kaybı testleri.
3. Onaylı marka kılavuzuyla renk/yazı tipi/ikon güncellemesi.
