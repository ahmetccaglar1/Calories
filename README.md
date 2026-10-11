# Kalori Günlüğü (PWA)

Yediğin yemeğin fotoğrafını çek → Claude yemeği tanır, porsiyonu ve kaloriyi tahmin eder →
gerekirse "nasıl pişti, ne kadar yağ kondu, hepsini yedin mi?" gibi sorular sorar → cevaplarına göre
tahmini günceller ve günlük loga ekler. Günlük kalori hedefine ulaştığında **"Bugünlük yemek bitti"** uyarısı verir.

## Özellikler
- 📷 Fotoğrafla veya ✍︎ yazarak öğün ekleme
- 🤖 Claude (`claude-opus-5-5`) ile görüntü analizi, kalem kalem kcal / protein / karbonhidrat / yağ
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

**API anahtarı:** [console.anthropic.com](https://console.anthropic.com) → API Keys. Uygulama ilk açılışta
ayarlarda ister. Anahtar sadece cihazında saklanır ve istekler doğrudan `api.anthropic.com`'a gider —
bu yüzden uygulamayı kişisel kullanım için düşün, anahtarını kimseyle paylaşma ve konsoldan harcama limiti koy.

**Yerelde çalıştırma:** `python3 -m http.server 8000` → http://localhost:8000

## Dosyalar
- `index.html`, `styles.css` — arayüz
- `app.js` — günlük log, hedef, uyarılar, fotoğraf işleme
- `ai.js` — Claude çağrısı (JSON şemalı yapılandırılmış çıktı, çok turlu soru-cevap)
- `sw.js`, `manifest.json`, `icons/` — PWA
