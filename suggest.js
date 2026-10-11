// "Öneriler" sekmesi: kalan kalori ve makrolara, sağlık profiline ve geçmişe göre yemek/tarif önerileri.
// Öneriler akışla gelir; her öneri tamamlandıkça ekrana eklenir.
import { $, esc, fmt, setButtons, loadingHtml, toast, haptic } from "./util.js";
import {
  settings, macroTargets, mealsFor, dayKey, addDays, addMeal, mealTypeFor, data, rememberSuggestions, recentSuggestions,
} from "./store.js";
import { Chat } from "./ai.js";
import { suggestSystem, SUGGEST_SCHEMA, normalizeSuggestions, profileContext } from "./prompt.js";
import { nav, onRender } from "./nav.js";
import { remainingFor } from "./today.js";
import { ensureKey, afterAdd } from "./meal.js";

const area = $("suggestArea");
const actions = $("suggestActions");
let chat = null;
let chatDay = null;
let current = [];
let running = false;
let type = "mixed";

const TYPE_LABEL = { recipe: "🍳 Tarif", quick: "⚡ Hızlı", outside: "🍽️ Dışarıda" };
const TYPE_ASK = {
  mixed: "En az biri evde yapılacak tarif olsun.",
  recipe: "Hepsi evde yapılacak tarif olsun.",
  quick: "Hepsi 5 dakikada hazırlanabilecek veya hazır alınabilecek şeyler olsun.",
  outside: "Hepsi dışarıda/restoranda sipariş edilebilecek şeyler olsun.",
};

function mealOfDay() {
  const h = new Date().getHours();
  if (h < 11) return "kahvaltı";
  if (h < 15) return "öğle yemeği";
  if (h < 17) return "ara öğün";
  if (h < 22) return "akşam yemeği";
  return "hafif gece atıştırmalığı";
}

/** Son 7 günde yenenler (bugün hariç), isimleri tekil. */
function lastWeekMeals() {
  const since = addDays(dayKey(), -7);
  return [...new Set(data.meals.filter((m) => m.date >= since && m.date < nav.day).map((m) => m.name))].slice(-25);
}

/** Akan JSON metninden "suggestions" dizisindeki tamamlanmış nesneleri çıkarır. */
export function completedObjects(text, key = "suggestions") {
  const start = text.indexOf(`"${key}"`);
  if (start < 0) return [];
  const arr = text.indexOf("[", start);
  if (arr < 0) return [];
  const out = [];
  let depth = 0, inStr = false, esc_ = false, objStart = -1;
  for (let i = arr + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc_) esc_ = false; else if (c === "\\") esc_ = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) objStart = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && objStart >= 0) { try { out.push(JSON.parse(text.slice(objStart, i + 1))); } catch {} objStart = -1; } }
    else if (c === "]" && depth === 0) break;
  }
  return out;
}

function renderRemaining() {
  const r = remainingFor(nav.day);
  const g = (v) => `${fmt(Math.max(0, v))} g`;
  $("suggestRemaining").innerHTML = r.kcal >= 80
    ? `<b>Kalan:</b> ${fmt(r.kcal)} kcal · P ${g(r.protein)} · K ${g(r.carbs)} · Y ${g(r.fat)} · Lif ${g(r.fiber)}`
    : `🛑 Bugünlük kalori hakkın bitti. Acıkırsan su, şekersiz çay/kahve, salatalık veya maden suyu tercih et.`;
  $("suggestRemaining").classList.toggle("stop", r.kcal < 80);
  if (!running) setButtons(actions, [{ label: current.length ? "Başka öner" : r.kcal >= 80 ? "Öner" : "Yine de hafif bir şey öner", onClick: run }]);
}

function cardHtml(s, i) {
  return `
    <div class="sugg card">
      <div class="sugg-head">
        <span class="tag">${TYPE_LABEL[s.type] ?? ""}${s.prep_minutes ? ` · ${fmt(s.prep_minutes)} dk` : ""}</span>
        <span class="kcal">${fmt(s.kcal)} kcal</span>
      </div>
      <div class="sugg-title">${esc(s.title)}</div>
      <div class="macro-chips">
        <span style="--c:var(--protein)">P ${fmt(s.protein_g)} g</span>
        <span style="--c:var(--carbs)">K ${fmt(s.carbs_g)} g</span>
        <span style="--c:var(--fat)">Y ${fmt(s.fat_g)} g</span>
      </div>
      ${s.why ? `<div class="note">${esc(s.why)}</div>` : ""}
      ${s.ingredients?.length || s.steps?.length ? `
        <details>
          <summary>${s.type === "recipe" ? "Tarifi gör" : "Detaylar"}</summary>
          ${s.ingredients?.length ? `<p><strong>Malzemeler</strong></p><ul>${s.ingredients.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${s.steps?.length ? `<p><strong>Hazırlanışı</strong></p><ol>${s.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
        </details>` : ""}
      ${i === undefined ? "" : `<button type="button" class="btn secondary small" data-eat="${i}">✓ Bunu yedim, kaydet</button>`}
    </div>`;
}

function render(list, { streaming = false, tip = "" } = {}) {
  area.innerHTML = list.map((s, i) => cardHtml(s, streaming ? undefined : i)).join("") +
    (streaming ? `<div class="sugg card">${loadingHtml(list.length ? "Bir öneri daha geliyor…" : "Sana uygun yemekleri düşünüyorum…")}</div>` : "") +
    (tip ? `<p class="hint tip">💡 ${esc(tip)}</p>` : "");
  area.querySelectorAll("[data-eat]").forEach((b) => {
    b.onclick = () => {
      const s = current[+b.dataset.eat];
      const meal = addMeal({
        name: s.title, kcal: s.kcal, protein: s.protein_g, carbs: s.carbs_g, fat: s.fat_g, fiber: s.fiber_g, sugar: 0,
        items: [],
        note: "Öneriden eklendi",
        mealType: mealTypeFor(nav.day === dayKey() ? new Date().toTimeString() : "12"),
      }, nav.day);
      haptic();
      afterAdd(meal);
      renderRemaining();
    };
  });
}

async function run() {
  if (!ensureKey()) return;
  const r = remainingFor(nav.day);
  const eaten = mealsFor(nav.day).map((m) => `${m.name} (${fmt(m.kcal)} kcal)`).join(", ") || "henüz bir şey yemedi";
  const meal = $("suggestMeal").value === "auto" ? mealOfDay() : $("suggestMeal").value;
  const note = $("suggestNote").value.trim();

  if (chatDay !== nav.day) chat = null; // başka güne geçildiyse yeni sohbet
  const first = !chat;
  const text = first
    ? [
      `Kalan hakkım: ${Math.max(0, Math.round(r.kcal))} kcal, protein ${Math.max(0, Math.round(r.protein))} g, karbonhidrat ${Math.max(0, Math.round(r.carbs))} g, yağ ${Math.max(0, Math.round(r.fat))} g, lif ${Math.max(0, Math.round(r.fiber))} g.`,
      r.kcal < 80 ? "Kalori hakkım bitti; çok düşük kalorili (100 kcal altı) tok tutan seçenekler öner." : "",
      `Sıradaki öğün: ${meal}. Bugün yediklerim: ${eaten}.`,
      lastWeekMeals().length ? `Son 7 günde yediklerim (bunları tekrar önerme): ${lastWeekMeals().join(", ")}.` : "",
      recentSuggestions().length ? `Daha önce bana önerilenler (bunları da tekrar önerme): ${recentSuggestions().join(", ")}.` : "",
      data.favorites.length ? `Sevdiğim yemekler (zevkimi anlaman için): ${data.favorites.map((f) => f.name).slice(0, 15).join(", ")}.` : "",
      TYPE_ASK[type],
      note ? `Elimdekiler / tercihim: ${note}` : "",
    ].filter(Boolean).join("\n")
    : `Bunlardan farklı 3 öneri daha ver. ${TYPE_ASK[type]}${note ? `\nTercihim: ${note}` : ""}`;

  chat ??= new Chat({ system: suggestSystem(profileContext(settings, macroTargets())), schema: SUGGEST_SCHEMA, normalize: normalizeSuggestions });
  chatDay = nav.day;

  running = true;
  current = [];
  render([], { streaming: true });
  setButtons(actions, []);
  let shown = 0;
  try {
    const res = await chat.send({
      text,
      onText: (t) => {
        const done = completedObjects(t);
        if (done.length !== shown) { shown = done.length; render(normalizeSuggestions({ suggestions: done }).suggestions, { streaming: true }); }
      },
    });
    current = res.suggestions;
    rememberSuggestions(current.map((s) => s.title));
    render(current, { tip: res.tip });
  } catch (err) {
    area.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    running = false;
    renderRemaining();
  }
}

export function initSuggest() {
  document.querySelectorAll("#suggestType button").forEach((b) => {
    b.onclick = () => {
      type = b.dataset.v;
      document.querySelectorAll("#suggestType button").forEach((x) => x.classList.toggle("on", x === b));
      haptic();
    };
  });
  onRender(() => { if (nav.tab === "suggest") renderRemaining(); });
}

export const suggestRunning = () => running;
