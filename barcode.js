// Barkod okuma (kamera veya fotoğraf) ve Open Food Facts'ten besin değerleri. Yapay zeka gerektirmez.
import { $, esc, fmt, setButtons, loadingHtml, toast } from "./util.js";
import { dayKey, addMeal, mealTypeFor } from "./store.js";
import { nav } from "./nav.js";
import { afterAdd } from "./meal.js";

const dlg = $("barcodeDialog");
const area = $("productArea");
let controls = null; // kamera taramasını durdurmak için
let zxing = null;

const loadZxing = async () => (zxing ??= await import("./vendor/zxing.js"));

async function reader() {
  const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await loadZxing();
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
  ]]]);
  return new BrowserMultiFormatReader(hints);
}

function stopCamera() {
  try { controls?.stop(); } catch {}
  controls = null;
}

async function startCamera() {
  $("scanStatus").textContent = "Kamera açılıyor…";
  $("scanner").classList.remove("hidden");
  try {
    const r = await reader();
    controls = await r.decodeFromConstraints({ video: { facingMode: "environment" } }, $("scanVideo"), (result) => {
      if (!result || !dlg.open) return;
      stopCamera();
      navigator.vibrate?.(30);
      lookup(result.getText());
    });
    $("scanStatus").textContent = "Barkodu çerçeveye getir.";
  } catch {
    $("scanner").classList.add("hidden");
    $("scanStatus").textContent = "Kamera açılamadı. Fotoğraftan okuyabilir veya numarayı yazabilirsin.";
  }
}

export function openBarcode() {
  $("addDialog").close();
  area.innerHTML = "";
  $("barcodeManual").value = "";
  dlg.showModal();
  startCamera();
}

const per100 = (n, key) => Number(n?.[`${key}_100g`] ?? 0) || 0;

async function lookup(code) {
  code = String(code).replace(/\D/g, "");
  if (code.length < 6) { toast("Geçerli bir barkod gir."); return; }
  stopCamera();
  $("scanner").classList.add("hidden");
  $("scanStatus").textContent = `Barkod: ${code}`;
  area.innerHTML = loadingHtml("Ürün aranıyor…");
  let product = null;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_tr,brands,nutriments,serving_quantity,image_front_small_url`);
    const json = await res.json();
    if (json.status === 1) product = json.product;
  } catch {
    area.innerHTML = `<div class="error">Bağlantı kurulamadı. İnterneti kontrol et.</div>`;
    return;
  }
  if (!product || !per100(product.nutriments, "energy-kcal")) {
    area.innerHTML = `<div class="error">Bu ürün veritabanında bulunamadı veya besin değeri yok.</div>`;
    const wrap = document.createElement("div");
    wrap.className = "sheet-actions";
    area.append(wrap);
    setButtons(wrap, [{ label: "📷 Ambalajı çek, yapay zeka hesaplasın", onClick: () => { dlg.close(); $("cameraInput").click(); } }]);
    return;
  }
  showProduct(product);
}

function showProduct(p) {
  const n = p.nutriments;
  const name = [p.brands?.split(",")[0], p.product_name_tr || p.product_name].filter(Boolean).join(" ") || "Paketli ürün";
  const v = {
    kcal: per100(n, "energy-kcal"), protein: per100(n, "proteins"), carbs: per100(n, "carbohydrates"),
    fat: per100(n, "fat"), fiber: per100(n, "fiber"), sugar: per100(n, "sugars"),
  };
  const serving = Number(p.serving_quantity) || 100;
  area.innerHTML = `
    <div class="result">
      <div class="product-head">
        ${p.image_front_small_url ? `<img src="${esc(p.image_front_small_url)}" alt="">` : ""}
        <div><div class="title"><span>${esc(name)}</span></div>
        <div class="hint">100 g: ${fmt(v.kcal)} kcal · P ${fmt(v.protein)} · K ${fmt(v.carbs)} · Y ${fmt(v.fat)}</div></div>
      </div>
      <label class="field"><span>Ne kadar yedin? (gram)</span>
        <input type="number" id="productGrams" value="${Math.round(serving)}" inputmode="decimal"></label>
      <div class="macro-chips" id="productCalc"></div>
    </div>`;
  const calc = () => {
    const g = Number($("productGrams").value) || 0;
    const f = g / 100;
    $("productCalc").innerHTML = `
      <span style="--c:var(--accent)"><b>${fmt(v.kcal * f)} kcal</b></span>
      <span style="--c:var(--protein)">P ${fmt(v.protein * f)} g</span>
      <span style="--c:var(--carbs)">K ${fmt(v.carbs * f)} g</span>
      <span style="--c:var(--fat)">Y ${fmt(v.fat * f)} g</span>`;
    return f;
  };
  $("productGrams").addEventListener("input", calc);
  calc();
  const wrap = document.createElement("div");
  wrap.className = "sheet-actions";
  area.append(wrap);
  setButtons(wrap, [{
    label: "Kaydet",
    onClick: () => {
      const f = calc();
      const g = Math.round(f * 100);
      const meal = addMeal({
        name, kcal: v.kcal * f, protein: v.protein * f, carbs: v.carbs * f, fat: v.fat * f, fiber: v.fiber * f, sugar: v.sugar * f,
        items: [{ name, portion: `${g} g`, kcal: v.kcal * f, protein_g: v.protein * f, carbs_g: v.carbs * f, fat_g: v.fat * f }],
        note: "Barkoddan eklendi",
        mealType: mealTypeFor(nav.day === dayKey() ? new Date().toTimeString() : "12"),
      }, nav.day);
      dlg.close();
      afterAdd(meal);
    },
  }]);
}

export function initBarcode() {
  $("barcodeBtn").onclick = openBarcode;
  dlg.addEventListener("close", stopCamera);
  $("barcodeLookup").onclick = () => lookup($("barcodeManual").value);
  $("barcodeManual").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(e.target.value); });
  $("barcodePhoto").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("scanStatus").textContent = "Fotoğraf okunuyor…";
    const url = URL.createObjectURL(file);
    try {
      const result = await (await reader()).decodeFromImageUrl(url);
      lookup(result.getText());
    } catch {
      $("scanStatus").textContent = "Fotoğrafta barkod bulunamadı. Daha yakından ve net çekmeyi dene ya da numarayı yaz.";
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}
