# App Store gönderimi — Battle Run

Ürün sayfası metinleri, App Privacy cevapları ve App Review notları. Görseller için
[APP_STORE_ASSET_GUIDELINES.md](../APP_STORE_ASSET_GUIDELINES.md) kuralları geçerli.

## Uygulama kaydı (App Store Connect → Uygulamalar → +)

| Alan | Değer |
|---|---|
| Platform | iOS (watchOS uygulaması paketin içinde gelir) |
| Ad | Battle Run |
| Birincil dil | Türkçe |
| Bundle ID | com.furkanilgen.runner |
| SKU | battlerun-ios |
| Kategori | Sağlık ve Fitness (ikincil: Oyunlar → Strateji ya da boş) |
| Fiyat | Ücretsiz |
| Yaş derecelendirmesi | Anket: kullanıcıların oluşturduğu içerik (kullanıcı adı, kulüp adı) var; şiddet, kumar vb. yok |

## Ürün sayfası

**Alt başlık** (≤30): `Yürü, koş, şehri kazan`

**Tanıtım metni** (≤170):
Her yürüyüş ve koşu haritada bir hamle. Geçtiğin sokakları al, mahalleni savun, kaleleri ele geçir ve sezonda rütbe atla.

**Açıklama:**

Battle Run hareketi şehrin haritasında bir bölge oyununa dönüştürür.

Şehir altıgen hücrelere bölünmüş. Yürüdüğün, koştuğun, pedal çevirdiğin ya da tekerlekli sandalyenle geçtiğin hücreler senin olur; başladığın yere dönersen çevrelediğin alanın tamamı da. Rakipler hücrelerini alabilir, uzun süre uğramadığın bölgeler zayıflar. Her zaman geri dönmek için bir sebep var.

OYUN
• Mahalle savaşı: bir ilçe takımı seç, haftalık kazandığın hücreler ilçenin puanına yazılsın.
• Kaleler: simge noktalardaki hücreler ekstra puan değerinde.
• Sezon ve rütbe: her ay yeni sezon, Çaylak’tan Efsane’ye yedi rütbe.
• Kulüpler: arkadaşlarınla kulüp kur, birlikte alan kazanın.
• Akıllı rota: seçtiğin süreye göre sokakları izleyen ve en çok hücre kazandıracak turu önerir.

HERKES İÇİN
• Tempo değil düzen ödüllendirilir; yürüyüş tam değerlidir.
• Tekerlekli sandalye ayrı bir aktivite türüdür.
• Haftalık hedefini mesafe ya da hareket süresi olarak koy.
• Kolay mod: büyük rakamlar, sade kayıt ekranı.

APPLE WATCH VE SAĞLIK
• Apple Watch uygulamasıyla telefonsuz kayıt; telefondaki kaydı saatten izle ve yönet.
• Apple Sağlık’tan antrenmanları rotasıyla içe aktar, istersen aktivitelerini Sağlık’a yaz.

GİZLİLİK
• Paylaşılan rotanın başı ve sonu kırpılır; ev ve iş gibi gizli bölgeler gösterilmez.
• Canlı konumu yalnızca seçtiğin kişiler görür, aktivite bitince silinir.
• Verilerin satılmaz ve reklam için kullanılmaz.

Arka planda konum kullanımı pil tüketimini artırabilir. Konum yalnızca aktivite kaydederken izlenir.

**Anahtar kelimeler** (≤100, virgülle):
`yürüyüş,koşu,bisiklet,adım,harita,bölge,mahalle,oyun,fitness,rota,hedef,apple watch,sezon,kulüp`

**Destek URL'si:** `https://fahrifurkanilgen.github.io/battle-run/`
**Gizlilik politikası URL'si:** `https://fahrifurkanilgen.github.io/battle-run/privacy.html`
**Telif hakkı:** `2026 [Ad Soyad]`

## App Privacy (Veri gizliliği) cevapları

İzleme (tracking): **Hayır** — üçüncü taraf reklam/analitik SDK yok.

| Veri türü | Toplanıyor | Kullanıcıya bağlı | Amaç |
|---|---|---|---|
| Konum → Kesin konum | Evet | Evet | Uygulama işlevi |
| Sağlık ve Fitness → Fitness | Evet | Evet | Uygulama işlevi |
| İletişim bilgileri → E-posta | Evet | Evet | Uygulama işlevi (hesap) |
| Kullanıcı içeriği → Fotoğraflar | Evet (profil fotoğrafı, isteğe bağlı) | Evet | Uygulama işlevi |
| Kullanıcı içeriği → Diğer | Evet (kullanıcı adı, kulüp adı) | Evet | Uygulama işlevi |
| Tanımlayıcılar → Kullanıcı kimliği | Evet | Evet | Uygulama işlevi |
| Tanımlayıcılar → Cihaz kimliği | Evet (bildirim anahtarı) | Evet | Uygulama işlevi |

Hiçbiri "Üçüncü taraf reklamcılık", "Analitik" ya da "İzleme" için kullanılmıyor.

## App Review notları

```
Battle Run is a territory game for walks, runs, rides and wheelchair activities.
The map is divided into hexagonal cells; recording an activity claims the cells
you pass through.

Demo account (sign in with e-mail on the first screen):
  E-mail:   [demo e-posta]
  Password: [demo şifre]

Background location: used only while the user records an activity, so the
route keeps recording with the screen locked (Start → Aktiviteyi başlat).
A persistent status indicator is shown during recording.

HealthKit: used only on the "Saat antrenmanlarını aktar" screen to import
workouts with their route, and optionally to save recorded activities.

Apple Watch: the watch app records workouts phone-free and mirrors a phone
recording (pause/resume/finish).

Account deletion: Settings (Ayarlar) → Hesabı sil.
The app is in Turkish.
```

## Gönderimden önce

- [x] Gizlilik ve destek sayfası yayında (repo `battle-run`, kaynak `site/`); Ayarlar ekranından açılıyor.
- [ ] Bulutta demo hesap oluşturuldu, birkaç aktiviteyle dolduruldu.
- [ ] Ekran görüntüleri 1206 × 2622 (iPhone 17 Pro simülatörü), alfa kanalı yok, yönergelere uygun.
- [ ] Push bildirimleri: EAS proje kimliği + APNs anahtarı + `send-push` webhook (yoksa yalnızca yerel hatırlatmalar çalışır; uzak bildirimler gelmez).
- [ ] Arşiv: `xcodebuild archive` → App Store Connect'e yükleme → TestFlight'ta dene → incelemeye gönder.
