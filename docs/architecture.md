# Runner — Mimari

## Bileşenler

```
mobile/ (Expo SDK 57, React Native 0.86, TypeScript)
  src/app/          Expo Router ekranları (yalnızca görünüm + navigasyon)
  src/features/     Ekranların kullandığı hook'lar ve use-case fonksiyonları
  src/domain/       Saf iş mantığı: geo, GPS filtresi, metrikler, bölge kuralı, gizlilik, hedefler (birim testli)
  src/data/local/   SQLite (expo-sqlite): aktiviteler, GPS noktaları, gizlilik alanları
  src/data/remote/  Supabase istemcisi ve RPC sarmalayıcıları
  src/services/     Konum takibi (arka plan görevi), izinler, senkronizasyon, bildirimler
  src/state/        Zustand store'ları (kayıt, ayarlar, oturum)
  src/components/   Tasarım sistemi v0.1 bileşenleri (ui, ikonlar, harita katmanları, sekme çubuğu)
  src/theme/        Tasarım tokenları (aydınlık/koyu, Archivo + Instrument Sans)
supabase/
  migrations/       PostGIS şeması, RLS, RPC'ler (tek doğruluk kaynağı)
  tests/            Docker + PostGIS üzerinde SQL testleri
```

Ekranlar veri katmanına doğrudan erişmez; `features/*` içindeki hook'ları ve `*Actions` nesnelerini kullanır.
Tasarım ekibinin arayüzü bu hook'lara bağlanabilir, iş mantığı değişmeden kalır.

## Backend seçimi: Supabase (Postgres + PostGIS)

- Bölge hesabı poligon birleşimi/farkı/kesişimi gerektirir; PostGIS bunu doğru ve test edilebilir şekilde yapar.
- Auth (e-posta, Apple, Google), Storage (profil fotoğrafı) ve RLS tek pakette; hızlı prototip için uygun.
- Tüm sahiplik kararları `SECURITY DEFINER` RPC'lerde, tek transaction içinde verilir; istemci bölge tablolarına yazamaz.
- İleride yük artarsa aynı şema bir kuyruk + worker'a (ör. Edge Function / ayrı servis) taşınabilir.

## Aktivite kaydı akışı

1. `trackingService.start()` → SQLite'ta `recording` durumunda aktivite + kalıcı oturum (kv-store).
2. `expo-location` arka plan görevi (`trackingTask.ts`, giriş noktasında kayıtlı) konum gruplarını `ingest.ts`'e verir.
3. `ingest` her noktayı filtreler (doğruluk ≤ 30 m, sıçrama, titreşim) ve **hemen** SQLite'a yazar → çökme/OS kapatmasında veri kaybı en fazla son grup kadar.
4. Duraklatma GPS'i kapatır (pil), devam yeni bir segment açar; mesafe segmentler arasında köprülenmez.
5. Uygulama yeniden açılırsa `restore()` kaydı bulur ve takibi yeniden başlatır.
6. Bitiş → özet ekranı (kaydet / sil). Kaydedilen aktivite outbox'a girer; oturum + bağlantı varsa `submit_activity` RPC'sine yüklenir (istemci UUID'si ile idempotent).

Pil: `Accuracy.High` (~10 m sınıfı), 5–10 m mesafe aralığı, arka planda 10 sn toplu teslim, kayıt ekranı arka planda saati güncellemez.

## Bölge kuralı — altıgen hücreler (sunucu: `submit_activity_core`, `0005_hex_cells.sql`)

Harita, Web Mercator (EPSG:3857) üzerinde sabit, düz tepeli altıgenlere bölünür; hücreler eksenel `(q, r)` ile
adreslenir: `merkez = (1,5·s·q, √3·s·(r + q/2))`, `s = 130` Mercator metresi. Aynı matematik
`mobile/src/domain/hex.ts`'te de var; istemci hücre geometrisini `(q, r)`'den kendisi çizer.

| Kural | Değer |
|---|---|
| GPS doğruluk eşiği | 30 m |
| Hücre kazanmak için minimum mesafe | 400 m |
| Rota hücresi | rotanın içinden en az 30 m (gerçek metre) geçtiği hücre |
| Döngü bonusu | bitiş başlangıca ≤ 75 m ise merkezi döngünün içinde kalan hücreler |
| Tek aktivite üst sınırı | 300 hücre |
| Sahiplik | her hücrenin tek sahibi var; başkasının hücresi ele geçirilir, zaten senin olanlar kazanç sayılmaz |

Hücre boyutu enlemle değişir (Mercator): kenar ≈ 130·cos(enlem) m — İstanbul'da ≈ 98 m. Aynı şehirdeki oyuncular
eşit hücrelerde yarışır; genel sıralama hücre sayısını karşılaştırır. Sıralamada "alan" değeri hücre sayısıdır.

## Hile önleme (sunucu tarafı reddetme nedenleri)

`not_enough_points`, `mock_location` (Android mock sağlayıcı), `non_monotonic_time`, `future_timestamp`, `too_old` (> 7 gün),
`impossible_average_speed` / `impossible_speed_segments` (tür bazlı hız sınırları: yürüyüş 3.5, koşu 8, bisiklet 22 m/s),
`route_jumps` (1.5× sınırı aşan ani sıçramalar), `overlapping_activity` (aynı kullanıcının zaman çakışan aktivitesi),
`duplicate_trace` (aynı nokta dizisinin hash'i daha önce yüklenmiş — kullanıcıdan bağımsız).
Mesafe istemciden alınmaz, sunucuda yeniden hesaplanır.

## Gizlilik

- Ham noktalar (`route_points`) ve tam rota (`activity_routes`) yalnızca sahibine açık (RLS); 30 gün sonra `purge_old_route_points()` ile silinebilir.
- Başkalarına yalnızca `public_route` gösterilir. Paylaşım modu (`route_share`): `trimmed` (varsayılan; ilk/son 300 m kırpılır), `stats_only` (rota hiç gösterilmez), `full` (kırpma yok). Her modda gizlilik alanları çıkarılır ve rota sadeleştirilir.
- Gizlilik alanı merkezleri sunucuda rastgele kaydırılır (yarıçapın %30'u) ve yarıçap aynı miktar büyütülür → boşluklar evin merkezini göstermez.
- Gizlilik alanı önerileri yalnızca cihazda, başlangıç/bitiş kümelerinden hesaplanır.
- Profil `private` ise: sıralamalarda yok, haritada bölgesi isimsiz, takip istek onayı gerekir. `show_in_leaderboards = false` ise de sıralamalarda listelenmez.
- Varsayılanlar paylaşmaya kapalı tarafta: profil ve aktiviteler "takipçilerim".
- `delete_my_location_data()` ve `delete_my_account()` RPC'leri.

## Veri modelleri

`mobile/src/domain/types.ts` (istemci) ↔ `supabase/migrations` (sunucu):
User↔`profiles`, Activity↔`activities`, RoutePoint↔`route_points`, TerritoryCell↔`territory_cells` (+`territory_events`),
Club↔`clubs`/`club_members` (+`challenges` sonraki faz), Follow↔`follows`, FeedPost↔`feed_posts`/`post_likes`,
Notification↔`notifications`/`notification_prefs`.
