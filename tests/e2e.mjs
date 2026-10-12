// Uçtan uca test: uygulamayı /Calories/ altında sunar, Gemini ve Open Food Facts'i taklit eder,
// ana akışları gerçek bir tarayıcıda (Chromium, mobil görünüm) çalıştırır.
// Çalıştırma: npm test   (ekran görüntüleri için: SCREENSHOTS=1, Safari motoru için: BROWSER=webkit)
import { chromium, webkit } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SCREENSHOTS ? path.join(ROOT, "tests", "screenshots") : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };

// ---------- Statik sunucu (ETag ile, HEAD destekli) ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/Calories/")) { res.writeHead(404).end(); return; }
  let file = path.join(ROOT, decodeURIComponent(url.pathname.slice("/Calories/".length)) || "index.html");
  if (file.endsWith(path.sep)) file += "index.html";
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  const st = fs.statSync(file);
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", ETag: `"${st.size}-${st.mtimeMs}"`, "Cache-Control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/Calories/`;

// ---------- Küçük test yardımcıları ----------
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };

// 1x1'den büyük, geçerli bir JPEG üret (fotoğraf yerine)
const PHOTO = path.join(ROOT, "tests", "food.jpg");

// Taklit yanıtlar başka kökenden (googleapis, openfoodfacts) geliyor: CORS başlıkları şart.
// Chromium bunları kendiliğinden ekliyor, WebKit eklemiyor; OPTIONS ön isteğine de cevap verilmeli.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const fulfill = (route, { headers, ...opts }) => route.fulfill({ ...opts, headers: { ...CORS, ...headers } });
const preflight = (route) => (route.request().method() === "OPTIONS" ? (route.fulfill({ status: 204, headers: CORS }), true) : false);

// ---------- Taklit Gemini ----------
const gemini = { requests: [] };
function geminiReply(body) {
  const sys = body.systemInstruction?.parts[0].text ?? "";
  if (!sys) return "OK"; // bağlantı testi gibi talimatsız istekler
  const user = body.contents.at(-1).parts.map((p) => p.text ?? "[görsel]").join(" ");
  gemini.requests.push({ kind: sys.startsWith("Sen klinik") ? "profile" : sys.startsWith("Sen pratik") ? "suggest" : "meal", sys, user, body });
  if (sys.startsWith("Sen klinik")) {
    return { daily_kcal: 1734, protein_g: 140, carbs_g: 130, fat_g: 70, fiber_g: 35, health_summary: "İnsülin direnci.", guidelines: ["Rafine karbonhidratı azalt"], avoid: ["Şekerli içecek"], explanation: "Açık 500 kcal." };
  }
  if (sys.startsWith("Sen pratik")) {
    const n = gemini.requests.filter((r) => r.kind === "suggest").length;
    return { tip: "Su iç.", suggestions: [1, 2, 3].map((i) => ({ title: `Öneri ${n}-${i}`, type: i === 1 ? "recipe" : "quick", why: "Uygun.", kcal: 300 + i * 50, protein_g: 30, carbs_g: 10, fat_g: 12, fiber_g: 5, prep_minutes: 10, ingredients: ["100 g tavuk"], steps: ["Pişir"] })) };
  }
  return { meal_name: "Pilav ve tavuk", confidence: "high", notes: "", health_note: "Bulgur tercih et.",
    items: [{ name: "Pilav", portion: "200 g", kcal: 360, protein_g: 7, carbs_g: 70, fat_g: 6 }, { name: "Tavuk", portion: "150 g", kcal: 300, protein_g: 40, carbs_g: 0, fat_g: 14 }],
    total: { kcal: 660, protein_g: 47, carbs_g: 70, fat_g: 20, fiber_g: 2, sugar_g: 1 }, questions: [] };
}

async function setupRoutes(ctx) {
  await ctx.route("https://generativelanguage.googleapis.com/**", async (route) => {
    if (preflight(route)) return;
    const req = route.request();
    const out = JSON.stringify(geminiReply(JSON.parse(req.postData())));
    if (req.url().includes("streamGenerateContent")) {
      // Yanıtı üç parçada SSE olarak gönder
      const third = Math.ceil(out.length / 3);
      const chunks = [0, 1, 2].map((i) => out.slice(i * third, (i + 1) * third));
      const body = chunks.map((c, i) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: c }] }, ...(i === 2 ? { finishReason: "STOP" } : {}) }] })}\n\n`).join("");
      return fulfill(route, { contentType: "text/event-stream", body });
    }
    return fulfill(route, { contentType: "application/json", body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: out }] } }] }) });
  });
  await ctx.route("https://world.openfoodfacts.org/**", (route) => preflight(route) || fulfill(route, {
    contentType: "application/json",
    body: JSON.stringify({ status: 1, product: { product_name: "Süzme Yoğurt", brands: "Örnek", serving_quantity: 150, nutriments: { "energy-kcal_100g": 100, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 5, fiber_100g: 0, sugars_100g: 4 } } }),
  }));
}

const ENGINE = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
console.log(`Tarayıcı motoru: ${ENGINE}\n`);
const browser = ENGINE === "webkit"
  ? await webkit.launch()
  : await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let skipped = 0;
const skip = (msg, why) => { console.log(`– ${msg} (atlandı: ${why})`); skipped++; };
// Bu motor sayfa içinden dokunma olayı (Touch/TouchEvent) oluşturabiliyor mu?
const canSynthTouch = (page) => page.evaluate(() => {
  try { new TouchEvent("touchstart", { touches: [new Touch({ identifier: 1, target: document.body, clientX: 1, clientY: 1 })] }); return true; } catch { return false; }
});
const errors = [];
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

try {
  // ================= Yeni kullanıcı =================
  const ctx = await browser.newContext(mobile);
  await setupRoutes(ctx);
  const page = await newPage(ctx);
  await page.goto(BASE);

  // --- Kurulum sihirbazı ---
  await page.waitForSelector("#onboardDialog[open]");
  ok(true, "ilk açılışta kurulum sihirbazı açılıyor");
  await shot(page, "01-onboard");
  await page.click("#obActions .btn");
  await page.fill("#obAge", "34"); await page.fill("#obWeight", "88"); await page.fill("#obTarget", "78");
  await page.click("#obActions .btn:last-child");
  await page.fill("#obHealth", "insülin direncim var");
  await page.click("#obActions .btn:last-child");
  await page.fill("#obKey", "AIzaTEST");
  await shot(page, "02-onboard-key");
  await page.click("#obActions .btn:last-child");
  await page.waitForSelector(".ob-done");
  ok((await page.textContent("#obStep")).includes("1.730"), "sihirbaz sonunda yapay zeka hedefi uygulanıyor (1734 → 1730 kcal)");
  ok(gemini.requests[0]?.user.includes("insülin direncim var"), "sağlık metni profil isteğine gidiyor");
  await page.click("#obActions .btn");
  await page.waitForSelector("#onboardDialog", { state: "hidden" });

  // --- Fotoğraftan öğün ---
  await page.click("#addBtn");
  await page.waitForSelector("#addDialog[open]");
  await shot(page, "03-add-menu");
  await page.setInputFiles("#galleryInput", PHOTO);
  await page.waitForSelector("#analyzeDialog[open]");
  await page.click("#analyzeActions .btn");
  await page.waitForSelector("#kcalEdit");
  const mealReq = gemini.requests.at(-1);
  ok(mealReq.kind === "meal" && mealReq.sys.includes("Rafine karbonhidratı azalt"), "öğün analizi profil kurallarını içeriyor");
  ok(mealReq.body.contents[0].parts.some((p) => p.inlineData), "fotoğraf isteğe ekleniyor");
  await shot(page, "04-analysis");
  await page.click("#analyzeActions .btn");
  await page.waitForSelector(".meal");
  ok((await page.textContent("#eaten")) === "660", "öğün kaydediliyor (660 kcal)");
  ok((await page.textContent("#toast")).includes("eklendi"), "eklendi bildirimi gösteriliyor");

  // --- Son yenenlerden hızlı ekleme ---
  await page.click("#addBtn");
  await page.click("#quickList [data-i='0']");
  await page.waitForFunction(() => document.querySelectorAll(".meal").length === 2);
  ok((await page.textContent("#eaten")) === "1.320", "son yenenlerden tek dokunuşla ekleniyor");

  // --- Düzenleme: porsiyon 2 ---
  await page.click(".meal >> nth=0");
  await page.waitForSelector("#editDialog[open]");
  await page.click("#ePortion [data-v='2']");
  ok((await page.inputValue("#eKcal")) === "1320", "porsiyon seçimi değerleri ölçekliyor");
  await page.click("#eFav");
  await page.click("#eSave");
  await page.waitForSelector("#editDialog", { state: "hidden" });
  ok((await page.textContent("#eaten")) === "1.980", "düzenleme kaydediliyor");
  ok(await page.evaluate(async () => (await import("./store.js")).data.favorites.length === 1), "favorilere ekleniyor");
  ok((await page.textContent("#banner")).includes("Bugünlük yemek bitti"), "hedef aşılınca 'bugünlük bitti' uyarısı");
  await shot(page, "05-today");

  // --- Kaydırarak silme + geri al ---
  const touchOk = await canSynthTouch(page);
  if (!touchOk) skip("sola kaydırınca siliniyor / geri al", `${ENGINE} sayfa içinden dokunma olayı oluşturamıyor`);
  else {
  await page.evaluate(() => {
    const row = document.querySelectorAll(".meal")[1];
    const t = (x) => new Touch({ identifier: 1, target: row, clientX: x, clientY: 300 });
    row.dispatchEvent(new TouchEvent("touchstart", { touches: [t(300)], bubbles: true }));
    for (let x = 280; x >= 120; x -= 20) row.dispatchEvent(new TouchEvent("touchmove", { touches: [t(x)], bubbles: true }));
    row.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll(".meal").length === 1);
  ok(true, "sola kaydırınca siliniyor");
  await page.click("#toast button");
  await page.waitForFunction(() => document.querySelectorAll(".meal").length === 2);
  ok(true, "geri al ile geri geliyor");
  }

  // --- Su ---
  await page.click("#waterPlus"); await page.click("#waterPlus");
  ok((await page.textContent("#waterText")).startsWith("2 /"), "su sayacı artıyor");

  // --- Barkod (elle numara) ---
  await page.click("#addBtn");
  await page.click("#barcodeBtn");
  await page.waitForSelector("#barcodeDialog[open]");
  await page.fill("#barcodeManual", "8690000000001");
  await page.click("#barcodeLookup");
  await page.waitForSelector("#productGrams");
  await page.fill("#productGrams", "200");
  await shot(page, "06-barcode");
  await page.click("#productArea .sheet-actions .btn");
  await page.waitForFunction(() => [...document.querySelectorAll(".meal .name")].some((n) => n.textContent.includes("Süzme Yoğurt")));
  const yog = await page.evaluate(async () => (await import("./store.js")).data.meals.find((m) => m.name.includes("Süzme")));
  ok(Math.round(yog.kcal) === 200 && Math.round(yog.protein) === 20, "barkoddan gramaja göre değer hesaplanıyor");

  // --- Öneriler (akışla) ---
  await page.click(".tabbar [data-tab='suggest']");
  await page.click("#suggestActions .btn");
  await page.waitForSelector("[data-eat]");
  ok((await page.$$(".sugg [data-eat]")).length === 3, "3 öneri akışla geliyor");
  const s1 = gemini.requests.filter((r) => r.kind === "suggest").at(-1);
  ok(s1.sys.includes("TEKRAR ETME") && s1.user.includes("Sevdiğim yemekler"), "öneri isteği çeşitlilik talimatı ve favorileri içeriyor");
  await shot(page, "07-suggest");
  await page.click("[data-eat='0']");
  ok(await page.evaluate(async () => (await import("./store.js")).data.meals.some((m) => m.name === "Öneri 1-1")), "öneri 'Bunu yedim' ile kaydediliyor");
  await page.click("#suggestActions .btn");
  await page.waitForSelector("[data-eat]");
  // Yeni sohbet açınca daha önce önerilenler gönderilmeli
  await page.evaluate(async () => { (await import("./nav.js")).nav.day = "2000-01-01"; });
  await page.click("#suggestActions .btn");
  await page.waitForSelector("[data-eat]");
  const s3 = gemini.requests.filter((r) => r.kind === "suggest").at(-1);
  ok(s3.user.includes("Daha önce bana önerilenler") && s3.user.includes("Öneri 1-2"), "yeni sohbette önceki öneriler tekrar edilmesin diye gönderiliyor");
  await page.evaluate(async () => { const s = await import("./store.js"); (await import("./nav.js")).nav.day = s.dayKey(); });

  // --- Geçmiş: kilo ve hafta ---
  await page.evaluate(async () => {
    const s = await import("./store.js");
    for (let i = 20; i >= 1; i--) s.setWeight(s.addDays(s.dayKey(), -i), 88 - (20 - i) * 0.1);
  });
  await page.click(".tabbar [data-tab='history']");
  await page.fill("#weightInput", "85,9");
  await page.click("#weightSave");
  await page.waitForSelector("#weightChart .line-mark");
  ok(await page.$("#weekChart .bar-mark"), "haftalık kalori grafiği çiziliyor");
  ok((await page.textContent("#etaText")).includes("hafta"), `kilo hedef süresi hesaplanıyor (${await page.textContent("#etaText")})`);
  await shot(page, "08-history");

  // --- Profil ---
  await page.click(".tabbar [data-tab='profile']");
  ok((await page.inputValue("#goalInput")) === "1730" && (await page.inputValue("#pWeight")) === "85,9", "profil formu güncel değerlerle doluyor");
  await page.fill("#goalInput", "1800");
  await page.click("#saveSettings");
  ok(await page.evaluate(async () => (await import("./store.js")).settings.goal === 1800), "profil kaydediliyor");
  await shot(page, "09-profile");

  // --- Kalıcılık ---
  await page.reload();
  await page.waitForSelector(".meal");
  ok((await page.$$(".meal")).length === 4, "yeniden açınca öğünler IndexedDB'den geliyor");

  // --- Otomatik güncelleme ve aşağı çekme ---
  let loads = 0;
  page.on("load", () => loads++);
  await page.waitForTimeout(500);
  const css = path.join(ROOT, "styles.css");
  const st = fs.statSync(css);
  fs.utimesSync(css, st.atime, new Date(st.mtimeMs + 5000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(2500);
  fs.utimesSync(css, st.atime, st.mtime);
  ok(loads > 0, "yeni sürüm algılanınca otomatik yenileniyor");
  const before = loads;
  await page.waitForSelector(".meal");
  if (!touchOk) skip("aşağı çekince yenileniyor", `${ENGINE} sayfa içinden dokunma olayı oluşturamıyor`);
  else {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
    window.dispatchEvent(new TouchEvent("touchstart", { touches: [t(100)] }));
    for (let y = 120; y <= 420; y += 40) window.dispatchEvent(new TouchEvent("touchmove", { touches: [t(y)] }));
    window.dispatchEvent(new TouchEvent("touchend", { touches: [] }));
  });
  await page.waitForTimeout(2000);
  ok(loads > before, "aşağı çekince yenileniyor");
  }
  await ctx.close();

  // ================= Bağlantı testi, yedek, çevrimdışı, ikonlar =================
  {
    const c = await browser.newContext({ ...mobile, acceptDownloads: true });
    await setupRoutes(c);
    await c.route("https://generativelanguage.googleapis.com/**", (route) => {
      if (preflight(route)) return;
      const req = route.request();
      if (req.method() === "GET") return fulfill(route, { contentType: "application/json", body: JSON.stringify({ models: [{ name: "models/gemini-9-flash" }, { name: "models/gemini-9-flash-lite" }] }) });
      const body = JSON.parse(req.postData());
      if (!body.systemInstruction && req.url().includes("flash-latest") && !req.url().includes("lite"))
        return fulfill(route, { status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "The model is overloaded." } }) });
      return route.fallback();
    });
    await c.addInitScript(() => {
      if (localStorage.getItem("kalori.settings")) return;
      localStorage.setItem("kalori.settings", JSON.stringify({ onboarded: true, geminiKey: "AIzaX", dataVersion: 2 }));
    });
    const p = await newPage(c);
    await p.goto(BASE);
    await p.waitForSelector("#view-today");

    // --- Bağlantı testi ---
    await p.click(".tabbar [data-tab='profile']");
    await p.click("#diagBtn");
    await p.waitForSelector(".diag");
    const diag = await p.$$eval(".diag li", (els) => els.map((e) => ({ cls: e.className, text: e.textContent })));
    ok(diag.length === 3 && diag[0].cls === "ok" && diag[1].cls === "ok" && diag[2].cls === "bad" && diag[2].text.includes("503"),
      "bağlantı testi anahtarı ve iki modeli ayrı ayrı gösteriyor, hatayı koduyla veriyor");
    await shot(p, "10-diagnose");

    // --- Çevrimdışı fotoğraf → bekleyen ---
    await p.click(".tabbar [data-tab='today']");
    await c.setOffline(true);
    await p.click("#addBtn");
    await p.setInputFiles("#galleryInput", PHOTO);
    await p.waitForSelector("#pendingGo");
    ok(await p.$eval("#pendingGo", (b) => b.disabled), "çevrimdışı çekilen fotoğraf bekleyenlere ekleniyor (buton pasif)");
    await c.setOffline(false);
    await p.waitForFunction(() => !document.getElementById("pendingGo").disabled);
    ok(true, "internet gelince bekleyen analiz etkinleşiyor");
    await shot(p, "11-pending");
    await p.click("#pendingGo");
    await p.waitForSelector("#analyzeDialog[open]");
    ok(!(await p.$eval("#previewImg", (i) => i.classList.contains("hidden"))), "bekleyen fotoğraf analiz penceresinde açılıyor");
    await p.click("#analyzeActions .btn");
    await p.waitForSelector("#kcalEdit");
    await p.click("#analyzeActions .btn");
    await p.waitForSelector(".meal");
    ok(await p.evaluate(async () => (await import("./store.js")).data.pending.length === 0) && !(await p.$("#pendingGo")),
      "analiz edilip kaydedilince bekleyenlerden çıkıyor");

    // --- Bağlantı hatasında "Sonra analiz et" ---
    await p.route("https://generativelanguage.googleapis.com/**", (route) => route.abort());
    await p.click("#addBtn");
    await p.setInputFiles("#galleryInput", PHOTO);
    await p.click("#analyzeActions .btn");
    await p.waitForSelector("#analysisArea .error");
    const later = await p.$$eval("#analyzeActions .btn", (bs) => bs.map((b) => b.textContent));
    ok(later.includes("Sonra analiz et"), "bağlantı hatasında 'Sonra analiz et' sunuluyor");
    await p.click("#analyzeActions .btn:last-child");
    await p.waitForSelector("#pendingGo");
    ok(await p.evaluate(async () => (await import("./store.js")).data.pending.length === 1), "'Sonra analiz et' fotoğrafı bekleyenlere koyuyor");
    await p.unroute("https://generativelanguage.googleapis.com/**");

    // --- Yedek hatırlatması ---
    await p.waitForSelector("#backupGo");
    ok(true, "kayıt varken yedek hatırlatması görünüyor");
    const [download] = await Promise.all([p.waitForEvent("download"), p.click("#backupGo")]);
    const file = await download.path();
    const backup = JSON.parse(fs.readFileSync(file, "utf8"));
    ok(backup.meals?.length === 1 && !backup.pending && !backup.settings.geminiKey, "yedek dosyası öğünleri içeriyor; anahtar ve bekleyen fotoğraflar hariç");
    await p.waitForFunction(() => !document.getElementById("backupGo"));
    ok(true, "yedek alınınca hatırlatma kayboluyor");
    await c.close();
  }

  // --- İkon dosyaları ---
  {
    const c = await browser.newContext();
    const p = await c.newPage();
    await p.goto(BASE);
    const touchIcon = await p.$eval("link[rel='apple-touch-icon']", (l) => l.href);
    const man = await (await p.request.get(new URL("manifest.json", BASE).href)).json();
    const urls = [touchIcon, ...man.icons.map((i) => new URL(i.src, BASE).href)];
    const results = await Promise.all(urls.map(async (u) => {
      const r = await p.request.get(u);
      const b = await r.body();
      // PNG imzası ve IHDR'den genişlik
      return r.ok() && b.slice(1, 4).toString() === "PNG" ? b.readUInt32BE(16) : 0;
    }));
    ok(results.every(Boolean) && results[0] === 180 && !touchIcon.includes("?"), `ana ekran ikonu ve manifest ikonları geçerli PNG (${results.join(", ")} px)`);
    await c.close();
  }

  // ================= Eski sürümden geçiş =================
  const ctx2 = await browser.newContext(mobile);
  await setupRoutes(ctx2);
  await ctx2.addInitScript(() => {
    if (localStorage.getItem("kalori.settings")) return;
    const d = new Date(); const day = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    localStorage.setItem("kalori.settings", JSON.stringify({ goal: 2000, provider: "gemini", geminiKey: "AIzaOLD" }));
    localStorage.setItem("kalori.meals", JSON.stringify([{ id: "old1", date: day, time: "08:30", name: "Menemen", kcal: 400, protein: 20, carbs: 10, fat: 30, thumb: null }]));
  });
  const p2 = await newPage(ctx2);
  await p2.goto(BASE);
  await p2.waitForSelector(".meal");
  ok(!(await p2.$("#onboardDialog[open]")), "mevcut kullanıcı sihirbazı görmüyor");
  ok((await p2.textContent(".group-head")).includes("Kahvaltı"), "eski öğün taşınıp kahvaltı grubuna giriyor");
  ok(await p2.evaluate(() => localStorage.getItem("kalori.meals") === null), "eski localStorage kaydı temizleniyor");
  await ctx2.close();

  // ================= Gemini sunucu hataları =================
  async function analyzeWith(handler) {
    const c = await browser.newContext(mobile);
    await setupRoutes(c);
    const calls = [];
    // Sonradan eklenen route önceliklidir; eşleşmeyen istekler genel taklide düşer
    await c.route("https://generativelanguage.googleapis.com/**", (route) => {
      if (preflight(route)) return;
      const url = route.request().url();
      const body = JSON.parse(route.request().postData() || "{}");
      calls.push({ model: url.match(/models\/([^:]+)/)?.[1], strict: !!body.generationConfig?.responseSchema });
      return handler(route, calls.at(-1)) ?? route.fallback();
    });
    await c.addInitScript(() => localStorage.setItem("kalori.settings", JSON.stringify({ onboarded: true, geminiKey: "AIzaX", dataVersion: 2 })));
    const p = await newPage(c);
    await p.goto(BASE);
    await p.click("#addBtn");
    await p.click("#textMealBtn");
    await p.fill("#mealNote", "menemen");
    await p.click("#analyzeActions .btn");
    await p.waitForSelector("#kcalEdit, #analysisArea .error", { timeout: 20000 });
    const result = { calls, error: await p.$eval("#analysisArea", (el) => el.querySelector(".error")?.textContent ?? "") };
    await c.close();
    return result;
  }
  const fail = (status, message) => (route) => preflight(route) || fulfill(route, { status, contentType: "application/json", body: JSON.stringify({ error: { message } }) });

  let r = await analyzeWith((route, call) => (call.model.includes("lite") ? fail(503, "The model is overloaded.")(route) : null));
  ok(!r.error && r.calls.filter((c) => c.model.includes("lite")).length === 3 && r.calls.some((c) => !c.model.includes("lite")),
    "Flash-Lite aşırı yüklüyse iki kez tekrar deneyip Flash'a geçiyor");

  r = await analyzeWith((route, call) => (call.strict ? fail(500, "Internal error encountered.")(route) : null));
  ok(!r.error && r.calls.at(-1).strict === false, "şemalı istek 500 veriyorsa şemasız JSON moduyla tamamlanıyor");

  r = await analyzeWith(fail(503, "The model is overloaded. Please try again later."));
  ok(r.error.includes("503") && r.error.includes("overloaded"), `her şey çökükse gerçek hata gösteriliyor ("${r.error.slice(0, 70)}…")`);

  ok(errors.length === 0, `sayfa hatası yok${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.close();
}

console.log(`${skipped ? `\n${skipped} test bu motorda atlandı` : ""}${failures ? `\n${failures} test başarısız` : "\nTüm testler geçti"}`);
process.exit(failures ? 1 : 0);
