# Kalori Günlüğü (PWA)

Yediğin yemeğin fotoğrafını çek → yapay zeka yemeği tanır, porsiyonu ve kaloriyi tahmin eder →
gerekirse "nasıl pişti, ne kadar yağ kondu, hepsini yedin mi?" gibi sorular sorar → cevaplarına göre
tahmini günceller ve günlük loga ekler. Günlük kalori hedefine ulaştığında **"Bugünlük yemek bitti"** uyarısı verir.

## Özellikler
- 📷 Fotoğrafla veya ✍︎ yazarak öğün ekleme
- 🤖 Google Gemini (ücretsiz kota) ile görüntü analizi, kalem kalem kcal / protein / karbonhidrat / yağ.
  İstenirse ayarlardan ücretli Anthropic Claude'a geçilebilir.
- ❓ Belirsizlikler için hazır cevaplı takip soruları (pişirme yöntemi, yağ miktarı, porsiyon…)
- ✏️ Kaydetmeden önce toplam kaloriyi elle düzeltebilme
- 🎯 Günlük hedef + hedef hesaplayıcı (Mifflin-St Jeor + seçilen kalori açığı)
- 🟠 %85'te "az kaldı", 🛑 %100'de "bugünlük yemek bitti" uyarısı
- 📅 Geçmiş günlerde gezinme, JSON dışa/içe aktarma
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
- `app.js` — günlük log, hedef, uyarılar, fotoğraf işleme
- `prompt.js` — ortak talimat ve JSON çıktı şeması
- `gemini.js` — Gemini çağrısı (varsayılan; model adı kalkarsa uygun Flash modelini kendisi seçer)
- `claude.js` — Claude çağrısı (isteğe bağlı)
- `sw.js`, `manifest.json`, `icons/` — PWA
