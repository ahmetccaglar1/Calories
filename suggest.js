// "Ne yesem?": kalan kalori ve makrolara, sağlık profiline göre yemek/tarif önerileri.
import { $, esc, fmt, setButtons, loadingHtml } from "./util.js";
import { settings, macroTargets, totalsFor, mealsFor, dayKey, addMeal } from "./store.js";
import { Chat } from "./ai.js";
import { suggestSystem, SUGGEST_SCHEMA, normalizeSuggestions, profileContext } from "./prompt.js";

const dlg = $("suggestDialog");
const area = $("suggestArea");
const actions = $("suggestActions");
let chat = null;
let current = [];
let ctx = { day: dayKey(), onAdded: () => {} };

const TYPE_LABEL = { recipe: "🍳 Tarif", quick: "⚡ Hızlı", outside: "🍽️ Dışarıda" };
const TYPE_ASK = {
  mixed: "En az biri evde yapılacak tarif olsun.",
  recipe: "Hepsi evde yapılacak tarif olsun.",
  quick: "Hepsi 5 dakikada hazırlanabilecek veya hazır alınabilecek şeyler olsun.",
  outside: "Hepsi dışarıda/restoranda sipariş edilebilecek şeyler olsun.",
};

export function remaining(day) {
  const t = totalsFor(day);
  const m = macroTargets();
  return {
    kcal: settings.goal - t.kcal,
    protein: m.protein - t.protein,
    carbs: m.carbs - t.carbs,
    fat: m.fat - t.fat,
    fiber: m.fiber - t.fiber,
  };
}

function mealOfDay() {
  const h = new Date().getHours();
  if (h < 11) return "kahvaltı";
  if (h < 15) return "öğle yemeği";
  if (h < 17) return "ara öğün";
  if (h < 22) return "akşam yemeği";
  return "hafif gece atıştırmalığı";
}

function remainingHtml(r) {
  const g = (v) => `${fmt(Math.max(0, v))} g`;
  return `<b>Kalan:</b> ${fmt(Math.max(0, r.kcal))} kcal · P ${g(r.protein)} · K ${g(r.carbs)} · Y ${g(r.fat)} · Lif ${g(r.fiber)}`;
}

export function openSuggest(day, onAdded) {
  ctx = { day, onAdded };
  chat = null;
  current = [];
  const r = remaining(day);
  $("suggestRemaining").innerHTML = remainingHtml(r);
  if (r.kcal < 80) {
    area.innerHTML = `<div class="banner stop">🛑 Bugünlük kalori hakkın bitti. Acıkırsan su, şekersiz çay/kahve, salatalık veya maden suyu tercih et. Yarın görüşürüz!</div>`;
    setButtons(actions, [{ label: "Yine de hafif bir şey öner", cls: "ghost", onClick: run }]);
  } else {
    area.innerHTML = "";
    setButtons(actions, [{ label: "Öner", onClick: run }]);
  }
  dlg.showModal();
}

async function run() {
  const r = remaining(ctx.day);
  const eaten = mealsFor(ctx.day).map((m) => `${m.name} (${fmt(m.kcal)} kcal)`).join(", ") || "henüz bir şey yemedi";
  const meal = $("suggestMeal").value === "auto" ? mealOfDay() : $("suggestMeal").value;
  const note = $("suggestNote").value.trim();

  const text = chat
    ? `Bunlardan farklı 3 öneri daha ver. ${TYPE_ASK[$("suggestType").value]}${note ? `\nTercihim: ${note}` : ""}`
    : [
      `Kalan hakkım: ${Math.max(0, Math.round(r.kcal))} kcal, protein ${Math.max(0, Math.round(r.protein))} g, karbonhidrat ${Math.max(0, Math.round(r.carbs))} g, yağ ${Math.max(0, Math.round(r.fat))} g, lif ${Math.max(0, Math.round(r.fiber))} g.`,
      r.kcal < 80 ? "Kalori hakkım bitti; çok düşük kalorili (100 kcal altı) tok tutan seçenekler öner." : "",
      `Sıradaki öğün: ${meal}. Bugün yediklerim: ${eaten}.`,
      TYPE_ASK[$("suggestType").value],
      note ? `Elimdekiler / tercihim: ${note}` : "",
    ].filter(Boolean).join("\n");

  chat ??= new Chat({
    system: suggestSystem(profileContext(settings, macroTargets())),
    schema: SUGGEST_SCHEMA,
    normalize: normalizeSuggestions,
  });

  area.innerHTML = loadingHtml("Sana uygun yemekleri düşünüyorum…");
  setButtons(actions, []);
  try {
    const res = await chat.send({ text });
    current = res.suggestions;
    render(res);
  } catch (err) {
    area.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    setButtons(actions, [{ label: "Tekrar dene", onClick: run }]);
  }
}

function render(res) {
  area.innerHTML = current.map((s, i) => `
    <div class="sugg">
      <div class="sugg-head">
        <span class="tag">${TYPE_LABEL[s.type] ?? ""}${s.prep_minutes ? ` · ${fmt(s.prep_minutes)} dk` : ""}</span>
        <span class="kcal">${fmt(s.kcal)} kcal</span>
      </div>
      <div class="sugg-title">${esc(s.title)}</div>
      <div class="hint">P ${fmt(s.protein_g)} g · K ${fmt(s.carbs_g)} g · Y ${fmt(s.fat_g)} g</div>
      ${s.why ? `<div class="note">${esc(s.why)}</div>` : ""}
      ${s.ingredients.length || s.steps.length ? `
        <details>
          <summary>${s.type === "recipe" ? "Tarifi gör" : "Detaylar"}</summary>
          ${s.ingredients.length ? `<p><strong>Malzemeler</strong></p><ul>${s.ingredients.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${s.steps.length ? `<p><strong>Hazırlanışı</strong></p><ol>${s.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
        </details>` : ""}
      <button type="button" class="btn secondary small" data-eat="${i}">✓ Bunu yedim, kaydet</button>
    </div>`).join("") + (res.tip ? `<p class="hint">💡 ${esc(res.tip)}</p>` : "");

  area.querySelectorAll("[data-eat]").forEach((b) => {
    b.onclick = () => {
      const s = current[+b.dataset.eat];
      const now = new Date();
      const ok = addMeal({
        id: crypto.randomUUID(),
        date: ctx.day,
        time: ctx.day === dayKey(now) ? now.toTimeString().slice(0, 5) : "—",
        name: s.title,
        kcal: s.kcal, protein: s.protein_g, carbs: s.carbs_g, fat: s.fat_g, fiber: s.fiber_g, sugar: 0,
        items: [], note: "Öneriden eklendi", thumb: null,
      });
      if (!ok) return;
      dlg.close();
      ctx.onAdded(s.kcal);
    };
  });

  setButtons(actions, [
    { label: "Başka öner", cls: "ghost", onClick: run },
    { label: "Kapat", cls: "ghost", onClick: () => dlg.close() },
  ]);
}

export const suggestOpen = () => dlg.open;
