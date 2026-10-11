// "Geçmiş" sekmesi: haftalık rapor, seri, kilo takibi ve tahmini hedef süresi, gün listesi.
import { $, esc, fmt, toast, parseNum } from "./util.js";
import { settings, dayKey, addDays, totalsFor, mealsFor, data, weightsSorted, setWeight, waterFor } from "./store.js";
import { nav, onRender, openDay } from "./nav.js";
import { barChart, lineChart } from "./charts.js";

const DAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const hasLog = (day) => data.meals.some((m) => m.date === day);
const onTarget = (day) => { const k = totalsFor(day).kcal; return k > 0 && k <= settings.goal; };

function streak() {
  let day = dayKey();
  if (!hasLog(day)) day = addDays(day, -1); // bugün henüz kayıt yoksa seriyi bozmasın
  let n = 0;
  while (onTarget(day)) { n++; day = addDays(day, -1); }
  return n;
}

function renderWeek() {
  const today = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const logged = days.filter(hasLog);
  const avg = (f) => (logged.length ? logged.reduce((s, d) => s + f(d), 0) / logged.length : 0);
  const avgKcal = avg((d) => totalsFor(d).kcal);
  const avgProtein = avg((d) => totalsFor(d).protein);
  const hit = days.filter(onTarget).length;
  const avgWater = days.reduce((s, d) => s + waterFor(d), 0) / 7;

  $("weekStats").innerHTML = `
    <div><b>${fmt(avgKcal)}</b><span>ort. kcal</span></div>
    <div><b>${fmt(avgProtein)} g</b><span>ort. protein</span></div>
    <div><b>${hit}/7</b><span>hedefte gün</span></div>
    <div><b>${avgWater.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</b><span>ort. bardak su</span></div>`;
  const s = streak();
  $("streakText").textContent = s ? `🔥 ${s} gündür hedefte` : "";

  barChart($("weekChart"), days.map((d) => {
    const date = new Date(d + "T12:00:00");
    return {
      label: d === today ? "Bugün" : DAY_SHORT[date.getDay()],
      title: date.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "short" }),
      value: Math.round(totalsFor(d).kcal),
      highlight: d === today,
    };
  }), { goal: settings.goal, unit: "kcal" });
}

function eta(points) {
  const p = settings.profile;
  const current = points.at(-1)?.kg ?? p.weight;
  if (!p.targetWeight || p.goalType === "maintain") return "";
  const toGo = p.goalType === "lose" ? current - p.targetWeight : p.targetWeight - current;
  if (toGo <= 0) return "🎉 Hedef kilona ulaştın!";
  // Yeterli veri varsa gerçek eğilim, yoksa planlanan tempo (7700 kcal ≈ 1 kg)
  const first = points.find((x) => Date.parse(points.at(-1).date) - Date.parse(x.date) <= 60 * 864e5);
  const spanDays = first ? (Date.parse(points.at(-1).date) - Date.parse(first.date)) / 864e5 : 0;
  const trend = spanDays >= 14 ? ((p.goalType === "lose" ? first.kg - current : current - first.kg) / spanDays) : 0;
  const perDay = trend > 0.01 ? trend : (p.goalType === "lose" ? p.pace : 300) / 7700;
  const weeks = Math.ceil(toGo / perDay / 7);
  return `Hedefe ${toGo.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} kg · ~${weeks} hafta${trend > 0.01 ? "" : " (plana göre)"}`;
}

function renderWeight() {
  const pts = weightsSorted();
  $("etaText").textContent = eta(pts);
  $("weightInput").placeholder = pts.length ? `Son: ${pts.at(-1).kg.toLocaleString("tr-TR")} kg` : "Bugünkü kilon";
  lineChart($("weightChart"), pts.slice(-90).map((w) => ({ date: w.date, value: w.kg })), { target: settings.profile.targetWeight, unit: "kg" });
  $("weightTable").innerHTML = pts.length
    ? `<table class="detail-table">${[...pts].reverse().map((w) => `<tr><td>${new Date(w.date + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}</td><td>${w.kg.toLocaleString("tr-TR")} kg</td></tr>`).join("")}</table>`
    : `<p class="hint">Kayıt yok.</p>`;
}

function renderDays() {
  const days = [...new Set(data.meals.map((m) => m.date))].sort().reverse().slice(0, 60);
  $("dayList").innerHTML = days.length
    ? days.map((d) => {
      const t = totalsFor(d);
      const ok = t.kcal <= settings.goal;
      const date = new Date(d + "T12:00:00");
      const pct = Math.min(100, (t.kcal / settings.goal) * 100);
      return `<li><button type="button" data-day="${d}">
        <span class="d-date"><b>${date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</b><small>${date.toLocaleDateString("tr-TR", { weekday: "long" })}</small></span>
        <span class="d-bar"><span class="bar"><span style="width:${pct}%" class="${ok ? "" : "over"}"></span></span><small>${mealsFor(d).length} öğün · P ${fmt(t.protein)} g</small></span>
        <span class="d-kcal ${ok ? "" : "over"}">${fmt(t.kcal)}<small> kcal</small><i>${ok ? "✓" : "▲"}</i></span>
      </button></li>`;
    }).join("")
    : `<li class="empty small">Henüz kayıt yok.</li>`;
  $("dayList").querySelectorAll("[data-day]").forEach((b) => { b.onclick = () => openDay(b.dataset.day); });
}

export function initHistory() {
  $("weightSave").onclick = () => {
    const kg = parseNum($("weightInput").value);
    if (!(kg > 25 && kg < 400)) { toast("Geçerli bir kilo gir."); return; }
    setWeight(dayKey(), kg);
    $("weightInput").value = "";
    renderWeight();
    toast(`Bugünkü kilon kaydedildi: ${kg.toLocaleString("tr-TR")} kg`);
  };
  onRender(() => {
    if (nav.tab !== "history") return; // grafikler görünürken genişlik ölçülebilsin
    renderWeek();
    renderWeight();
    renderDays();
  });
}
