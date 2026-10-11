# Kalori Günlüğü (PWA)

Yediğin yemeğin fotoğrafını çek → yapay zeka yemeği tanır, porsiyonu ve kaloriyi tahmin eder →
gerekirse "nasıl pişti, ne kadar yağ kondu, hepsini yedin mi?" gibi sorular sorar → cevaplarına göre
tahmini günceller ve günlük loga ekler. Günlük kalori hedefine ulaştığında **"Bugünlük yemek bitti"** uyarısı verir.

## Özellikler
- 📷 Kamera, 🖼 galeri, ▦ barkod (Open Food Facts) veya ✍︎ yazarak öğün ekleme; ⭐ favoriler ve son yenenlerden tek dokunuşla ekleme
- 🤖 Google Gemini (ücretsiz kota) ile görüntü analizi: kalem kalem kcal / protein / karbonhidrat / yağ, lif ve şeker.
  Öğün analizinde hızlı (Flash-Lite) veya daha doğru (Flash) model seçilebilir; istenirse ücretli Anthropic Claude.
- ❓ Belirsizlikler için hazır cevaplı takip soruları (pişirme yöntemi, yağ miktarı, porsiyon…)
- 🍽️ Öğünler kahvaltı / öğle / ara öğün / akşam olarak gruplanır; dokununca düzenleme (porsiyon ½–2), sola kaydırınca silme (geri alınabilir)
- 🎯 Ayarlanabilir kalori ve makro hedefleri; ana ekranda ilerleme çubukları
- 🩺 Sağlık profili: sağlık durumu ve tahlil değerleri serbest metinle (+ isteğe bağlı tahlil fotoğrafı);
  yapay zeka kalori/makro hedeflerini ve diyet kurallarını buna göre belirler, öğün analizleri buna göre uyarır
- 🍳 "Ne yesem?": kalan hedeflere, sağlık profiline ve elindekilere göre tarif / hızlı / dışarıda önerileri, akışla gelir.
  Son 7 günün yediklerini ve daha önce önerilenleri tekrar etmez; favorilerden zevkini öğrenir
- ⚖️ Kilo takibi, grafik ve hedef kiloya tahmini süre; 📊 haftalık rapor ve hedef serisi; 💧 su takibi
- 🛑 %85'te "az kaldı", %100'de "bugünlük yemek bitti" uyarısı
- ✨ İlk açılışta 4 adımlı kurulum sihirbazı
- 🔄 Yeni sürüm yayınlanınca otomatik yenilenir; yukarıdan aşağı çekerek de yenilenir
- 📱 iPhone Safari'de "Ana Ekrana Ekle" ile uygulama gibi çalışır; veriler sadece cihazda (IndexedDB)

## Kurulum
Derleme adımı yok, statik dosyalar. HTTPS üzerinden yayınlamak yeterli (kamera ve service worker için gerekli).

**GitHub Pages:** Repo → Settings → Pages → *Deploy from a branch* → `main` / root.
Birkaç dakika sonra `https://<kullanıcı>.github.io/Calories/` adresinde açılır.

**iPhone'a kurma:** Safari'de adresi aç → Paylaş → *Ana Ekrana Ekle*.

**Ücretsiz API anahtarı (Gemini):** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Google hesabınla gir →
*Create API key* → kopyala. Uygulama ilk açılışta ayarlarda ister. Kredi kartı gerekmez; ücretsiz kotada
Google gönderilen verileri ürünlerini geliştirmek için kullanabilir.

Anahtar koda gömülmez, sadece telefonunda saklanır ve istekler doğrudan Google'a (veya Claude seçiliyse
Anthropic'e) gider. Repo ve site herkese açık olduğu için anahtarı asla repoya koyma.

**Yerelde çalıştırma:** `python3 -m http.server 8000` → http://localhost:8000

## Dosyalar
Derleme adımı yok; tarayıcı ES modüllerini doğrudan yükler.
- `index.html`, `styles.css` — arayüz (açık/koyu tema)
- `app.js` — giriş noktası · `nav.js` — sekmeler ve seçili gün
- `today.js`, `history.js`, `suggest.js`, `profile.js` — sekmeler · `charts.js` — SVG grafikler
- `meal.js` — öğün ekleme, analiz, düzenleme · `barcode.js` — barkod + Open Food Facts · `onboarding.js` — kurulum sihirbazı
- `store.js` — veriler, hedef hesapları, eski sürümden geçiş · `db.js` — IndexedDB
- `ai.js` — sağlayıcıdan bağımsız sohbet · `prompt.js` — talimatlar ve JSON şemaları · `gemini.js` / `claude.js` — sağlayıcılar
- `update.js` — otomatik güncelleme ve aşağı çekerek yenileme · `sw.js`, `manifest.json` — PWA
- `vendor/zxing.js` — barkod okuma kütüphanesi (ZXing, MIT/Apache-2.0)

## Test
```
npm install
npx playwright install chromium
npm test            # SCREENSHOTS=1 npm test ekran görüntülerini tests/screenshots/ altına kaydeder
```
Test, uygulamayı `/Calories/` altında sunar; Gemini ve Open Food Facts taklit edilir. GitHub Actions her push ve PR'da çalıştırır.
