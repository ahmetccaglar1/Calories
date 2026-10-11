# Kalori Günlüğü (PWA)

Yediğin yemeğin fotoğrafını çek → yapay zeka yemeği tanır, porsiyonu ve kaloriyi tahmin eder →
gerekirse "nasıl pişti, ne kadar yağ kondu, hepsini yedin mi?" gibi sorular sorar → cevaplarına göre
tahmini günceller ve günlük loga ekler. Günlük kalori hedefine ulaştığında **"Bugünlük yemek bitti"** uyarısı verir.

## Özellikler
- 📷 Kamerayla, 🖼 galeriden veya ✍︎ yazarak öğün ekleme
- 🤖 Google Gemini (ücretsiz kota) ile görüntü analizi, kalem kalem kcal / protein / karbonhidrat / yağ, toplam lif ve şeker.
  İstenirse ayarlardan ücretli Anthropic Claude'a geçilebilir.
- ❓ Belirsizlikler için hazır cevaplı takip soruları (pişirme yöntemi, yağ miktarı, porsiyon…)
- 🎯 Ayarlanabilir kalori ve makro hedefleri (protein, karbonhidrat, yağ, lif); ana ekranda ilerleme çubukları
- 🩺 Sağlık profili: sağlık durumunu ve tahlil değerlerini kendi cümlelerinle yaz (istersen tahlil fotoğrafı ekle);
  yapay zeka kalori/makro hedeflerini ve diyet kurallarını buna göre belirler (örn. insülin direnci → düşük karbonhidrat, yüksek lif).
  Öğün analizleri bu profile göre uyarı verir.
- 🍳 "Ne yesem?": kalan kalori ve makrolara, sağlık profiline ve elindeki malzemelere göre tarif / hızlı / dışarıda önerileri;
  "Bunu yedim" ile tek dokunuşla kaydet
- 🟠 %85'te "az kaldı", 🛑 %100'de "bugünlük yemek bitti" uyarısı
- 🔄 Yeni sürüm yayınlanınca uygulama kendini otomatik yeniler; yukarıdan aşağı çekerek de yenilenir
- 📅 Geçmiş günlerde gezinme, öğün detayları, JSON dışa/içe aktarma
- 📱 iPhone Safari'de "Ana Ekrana Ekle" ile uygulama gibi çalışır; veriler sadece cihazda (localStorage)

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
- `index.html`, `styles.css` — arayüz
- `app.js` — ana ekran, özet, makrolar, öğün ekleme akışı
- `settings.js` — hedefler, profil/sağlık, yapay zeka ayarları, veri aktarımı
- `suggest.js` — "Ne yesem?" önerileri
- `store.js` — veriler ve hedef hesapları (Mifflin-St Jeor)
- `ai.js` — sağlayıcıdan bağımsız sohbet katmanı
- `prompt.js` — yapay zeka talimatları ve JSON çıktı şemaları
- `gemini.js` / `claude.js` — sağlayıcılar
- `update.js` — otomatik güncelleme ve aşağı çekerek yenileme
- `sw.js`, `manifest.json`, `apple-touch-icon*.png`, `icons/` — PWA
