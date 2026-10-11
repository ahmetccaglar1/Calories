// "Bugün" sekmesi: kalori halkası, makrolar, su, öğün grupları.
import { $, esc, fmt, toast, enableSwipe, haptic } from "./util.js";
import {
  settings, dayKey, addDays, mealsFor, totalsFor, macroTargets, MEAL_TYPES,
  deleteMeal, restoreMeal, waterFor, setWater, waterGoal, WATER_GLASS_ML,
} from "./store.js";
import { nav, onRender, rerender, showTab } from "./nav.js";
import { openEdit } from "./meal.js";
import { openProfile } from "./profile.js";

const RING_LEN = 2 * Math.PI * 52;

export function statusFor(eaten, goal) {
  const left = goal - eaten;
  if (left <= 0) return { level: "stop", text: left === 0
    ? `🛑 Bugünlük yemek bitti! ${fmt(goal)} kcal hedefine ulaştın. Yarın görüşürüz.`
    : `🛑 Bugünlük yemek bitti! Hedefini ${fmt(-left)} kcal aştın. Bugün başka bir şey yeme, su iç 💧` };
  if (eaten >= goal * 0.85) return { level: "warn", text: `⚠️ Az kaldı: sadece ${fmt(left)} kcal hakkın var. Hafif bir şey seç ya da günü burada kapat.` };
  return { level: "ok", text: "" };
}

export function remainingFor(day) {
  const t = totalsFor(day);
  const m = macroTargets();
  return { kcal: settings.goal - t.kcal, protein: m.protein - t.protein, carbs: m.carbs - t.carbs, fat: m.fat - t.fat, fiber: m.fiber - t.fiber };
}

const MACROS = [
  { key: "protein", label: "Protein", color: "var(--protein)", cap: false },
  { key: "carbs", label: "Karbonhidrat", color: "var(--carbs)", cap: true },
  { key: "fat", label: "Yağ", color: "var(--fat)", cap: true },
  { key: "fiber", label: "Lif", color: "var(--fiber)", cap: false },
];

function renderSummary() {
  const today = dayKey();
  const day = nav.day;
  const d = new Date(day + "T12:00:00");
  $("dayTitle").textContent = day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : d.toLocaleDateString("tr-TR", { weekday: "long" });
  $("daySub").textContent = d.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
  $("nextDay").style.visibility = day >= today ? "hidden" : "visible";

  const t = totalsFor(day);
  const goal = settings.goal;
  const targets = macroTargets();
  $("eaten").textContent = fmt(t.kcal);
  $("target").textContent = fmt(goal);
  const left = goal - t.kcal;
  $("remaining").textContent = `${fmt(Math.abs(left))} kcal`;
  $("remaining").classList.toggle("over", left < 0);
  document.querySelector(".kcal-side .label").textContent = left < 0 ? "Aşıldı" : "Kalan";
  $("extraStats").textContent = t.sugar ? `Şeker ${fmt(t.sugar)} g` : "";

  const st = statusFor(t.kcal, goal);
  const ring = $("ringFg");
  ring.style.strokeDasharray = RING_LEN;
  ring.style.strokeDashoffset = RING_LEN * (1 - Math.min(t.kcal / goal, 1));
  ring.classList.toggle("warn", st.level === "warn");
  ring.classList.toggle("stop", st.level === "stop");

  $("macros").innerHTML = MACROS.map((m) => {
    const eaten = t[m.key];
    const target = targets[m.key] || 0;
    const pct = target ? Math.min(100, (eaten / target) * 100) : 0;
    const over = m.cap && target && eaten > target * 1.05;
    return `
      <div class="macro">
        <div class="macro-head"><span>${m.label}</span><span class="${over ? "over" : ""}">${fmt(eaten)}<small> / ${fmt(target)} g</small></span></div>
        <div class="bar"><div style="width:${pct}%;background:${over ? "var(--stop)" : m.color}"></div></div>
      </div>`;
  }).join("");

  const banner = $("banner");
  banner.className = `banner ${st.level}`;
  banner.textContent = st.text;
  banner.classList.toggle("hidden", !st.text);

  const r = remainingFor(day);
  $("suggestHint").textContent = r.kcal >= 80 ? `${fmt(r.kcal)} kcal · ${fmt(Math.max(0, r.protein))} g protein kaldı` : "Bugünlük hakkın bitti";
}

function renderWater() {
  const n = waterFor(nav.day);
  const goal = waterGoal();
  $("waterText").textContent = `${n} / ${goal} bardak · ${fmt1L(n)}`;
  $("waterGlasses").innerHTML = Array.from({ length: Math.max(goal, n) }, (_, i) => `<i class="${i < n ? "full" : ""}"></i>`).join("");
}
const fmt1L = (n) => `${((n * WATER_GLASS_ML) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} L`;

function renderMeals() {
  const list = mealsFor(nav.day);
  $("emptyMeals").classList.toggle("hidden", list.length > 0);
  const box = $("mealGroups");
  box.innerHTML = MEAL_TYPES.map((type) => {
    const items = list.filter((m) => m.mealType === type.key);
    if (!items.length) return "";
    const kcal = items.reduce((s, m) => s + m.kcal, 0);
    return `
      <div class="meal-group">
        <div class="group-head"><span>${type.icon} ${type.label}</span><span>${fmt(kcal)} kcal</span></div>
        <ul class="meals">${items.map((m) => `
          <li class="meal swipe" data-id="${m.id}">
            <div class="swipe-bg">Sil</div>
            <div class="swipe-content">
              ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<div class="ph">${type.icon}</div>`}
              <div class="info">
                <div class="name">${esc(m.name)}</div>
                <div class="meta">${esc(m.time)} · P ${fmt(m.protein)} · K ${fmt(m.carbs)} · Y ${fmt(m.fat)}${m.healthNote ? " · 🩺" : ""}</div>
              </div>
              <div class="kcal">${fmt(m.kcal)}<small> kcal</small></div>
            </div>
          </li>`).join("")}
        </ul>
      </div>`;
  }).join("");

  box.querySelectorAll(".meal").forEach((row) => {
    const meal = list.find((m) => m.id === row.dataset.id);
    enableSwipe(row, {
      onTap: () => openEdit(meal),
      onDelete: () => {
        deleteMeal(meal.id);
        rerender();
        toast(`"${meal.name}" silindi`, { action: { label: "Geri al", onClick: () => { restoreMeal(meal); rerender(); } } });
      },
    });
  });
}

export function initToday() {
  $("prevDay").onclick = () => { nav.day = addDays(nav.day, -1); rerender(); };
  $("nextDay").onclick = () => { nav.day = addDays(nav.day, 1); rerender(); };
  $("ringBtn").onclick = () => openProfile("goals");
  $("goSuggest").onclick = () => showTab("suggest");
  $("waterPlus").onclick = () => { setWater(nav.day, waterFor(nav.day) + 1); haptic(); renderWater(); };
  $("waterMinus").onclick = () => { setWater(nav.day, waterFor(nav.day) - 1); renderWater(); };
  onRender(() => { renderSummary(); renderWater(); renderMeals(); });
}
