// Ana ekran: günlük özet, makrolar, öğün listesi ve fotoğraf/yazı ile öğün ekleme akışı.
import { $, esc, fmt, setButtons, loadingHtml, loadImage, resize, squareThumb } from "./util.js";
import { settings, activeKey, dayKey, mealsFor, totalsFor, macroTargets, addMeal, deleteMeal } from "./store.js";
import { Chat } from "./ai.js";
import { mealSystem, MEAL_SCHEMA, normalizeMeal, mealFirstPrompt, mealAnswersPrompt, profileContext } from "./prompt.js";
import { initSettings, openSettings, settingsOpen } from "./settings.js";
import { openSuggest, suggestOpen, remaining } from "./suggest.js";
import { initAutoUpdate, initPullToRefresh } from "./update.js";

let currentDay = dayKey();
const RING_LEN = 2 * Math.PI * 52;
$("ringFg").style.strokeDasharray = RING_LEN;

// ---------- Özet ----------

function statusFor(eaten, goal) {
  const left = goal - eaten;
  if (left <= 0) return { level: "stop", text: left === 0
    ? `🛑 Bugünlük yemek bitti! ${fmt(goal)} kcal hedefine ulaştın. Yarın görüşürüz.`
    : `🛑 Bugünlük yemek bitti! Hedefini ${fmt(-left)} kcal aştın. Bugün başka bir şey yeme, su iç 💧` };
  if (eaten >= goal * 0.85) return { level: "warn", text: `⚠️ Az kaldı: sadece ${fmt(left)} kcal hakkın var. Hafif bir şey seç ya da günü burada kapat.` };
  return { level: "ok", text: "" };
}

const MACROS = [
  { key: "protein", label: "Protein", color: "var(--protein)" },
  { key: "carbs", label: "Karbonhidrat", color: "var(--carbs)" },
  { key: "fat", label: "Yağ", color: "var(--fat)" },
  { key: "fiber", label: "Lif", color: "var(--fiber)" },
];

function render() {
  const today = dayKey();
  const d = new Date(currentDay + "T12:00:00");
  $("dayTitle").textContent = currentDay === today ? "Bugün"
    : d.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "long" });
  $("nextDay").style.visibility = currentDay >= today ? "hidden" : "visible";

  const t = totalsFor(currentDay);
  const goal = settings.goal;
  const targets = macroTargets();
  $("eaten").textContent = fmt(t.kcal);
  $("target").textContent = fmt(goal);
  const left = goal - t.kcal;
  $("remaining").textContent = left >= 0 ? `${fmt(left)} kcal` : `+${fmt(-left)} kcal`;
  $("remaining").classList.toggle("over", left < 0);
  $("extraStats").textContent = t.sugar ? `Şeker ${fmt(t.sugar)} g` : "";

  const st = statusFor(t.kcal, goal);
  const ring = $("ringFg");
  ring.style.strokeDashoffset = RING_LEN * (1 - Math.min(t.kcal / goal, 1));
  ring.classList.toggle("warn", st.level === "warn");
  ring.classList.toggle("stop", st.level === "stop");

  $("macros").innerHTML = MACROS.map((m) => {
    const eaten = t[m.key];
    const target = targets[m.key] || 0;
    const pct = target ? Math.min(100, (eaten / target) * 100) : 0;
    const over = target && eaten > target * 1.05 && m.key !== "protein" && m.key !== "fiber";
    return `
      <div class="macro">
        <div class="macro-head"><span>${m.label}</span><span class="${over ? "over" : ""}">${fmt(eaten)} / ${fmt(target)} g</span></div>
        <div class="bar"><div style="width:${pct}%;background:${over ? "var(--stop)" : m.color}"></div></div>
      </div>`;
  }).join("");

  const banner = $("banner");
  banner.className = `banner ${st.level}`;
  banner.textContent = st.text;
  banner.classList.toggle("hidden", !st.text);

  const r = remaining(currentDay);
  $("suggestHint").textContent = r.kcal >= 80
    ? `${fmt(r.kcal)} kcal ve ${fmt(Math.max(0, r.protein))} g protein kaldı, sana uygun yemek ve tarif önereyim`
    : "Bugünlük kalori hakkın bitti";

  const list = mealsFor(currentDay);
  $("emptyMeals").classList.toggle("hidden", list.length > 0);
  $("meals").innerHTML = list.map((m) => `
    <li class="meal" data-id="${m.id}">
      <div class="meal-row">
        ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<div class="ph">🍽️</div>`}
        <div class="info">
          <div class="name">${esc(m.name)}</div>
          <div class="meta">${esc(m.time)} · P ${fmt(m.protein)} · K ${fmt(m.carbs)} · Y ${fmt(m.fat)}</div>
        </div>
        <div class="kcal">${fmt(m.kcal)} kcal</div>
      </div>
      <div class="meal-detail hidden">
        ${m.items?.length ? `<table>${m.items.map((i) => `<tr><td>${esc(i.name)} <span class="hint">${esc(i.portion)}</span></td><td>${fmt(i.kcal)} kcal</td></tr>`).join("")}</table>` : ""}
        <div class="hint">Lif ${fmt(m.fiber)} g · Şeker ${fmt(m.sugar)} g</div>
        ${m.healthNote ? `<div class="health-note">🩺 ${esc(m.healthNote)}</div>` : ""}
        ${m.note ? `<div class="hint">Not: ${esc(m.note)}</div>` : ""}
        <button type="button" class="btn ghost small" data-del="${m.id}">🗑 Sil</button>
      </div>
    </li>`).join("");
}

$("meals").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]")?.dataset.del;
  if (del) {
    const m = mealsFor(currentDay).find((x) => x.id === del);
    if (m && confirm(`"${m.name}" silinsin mi?`)) { deleteMeal(del); render(); }
    return;
  }
  e.target.closest(".meal")?.querySelector(".meal-detail").classList.toggle("hidden");
});

const shiftDay = (n) => {
  const d = new Date(currentDay + "T12:00:00");
  d.setDate(d.getDate() + n);
  currentDay = dayKey(d);
  render();
};
$("prevDay").onclick = () => shiftDay(-1);
$("nextDay").onclick = () => shiftDay(1);
$("ringBtn").onclick = () => openSettings("goals");
$("suggestBtn").onclick = () => { if (ensureKey()) openSuggest(currentDay, afterAdd); };

// ---------- Öğün analizi ----------

const dlg = $("analyzeDialog");
const area = $("analysisArea");
const actions = $("analyzeActions");
let session = null; // { chat, imageB64, thumb, result }

function ensureKey() {
  if (activeKey()) return true;
  alert(settings.provider === "claude" ? "Önce ayarlardan Anthropic API anahtarını gir." : "Önce ayarlardan ücretsiz Gemini API anahtarını gir.");
  openSettings();
  return false;
}

function confirmIfDone() {
  const t = totalsFor(currentDay);
  if (t.kcal < settings.goal) return true;
  return confirm(`🛑 Bugünlük hedefine ulaştın (${fmt(t.kcal)} / ${fmt(settings.goal)} kcal).\nYine de bu öğünü kaydetmek istiyor musun?`);
}

function openAnalysis({ imageB64 = null, thumb = null, preview = null }) {
  session = {
    chat: new Chat({ system: mealSystem(profileContext(settings, macroTargets())), schema: MEAL_SCHEMA, normalize: normalizeMeal }),
    imageB64, thumb, result: null,
  };
  $("mealNote").value = "";
  $("previewImg").classList.toggle("hidden", !preview);
  if (preview) $("previewImg").src = preview;
  area.innerHTML = imageB64 ? "" : `<p class="hint">Ne yediğini yaz: örn. "2 yumurtalı menemen, 1 dilim beyaz ekmek, şekersiz çay"</p>`;
  setButtons(actions, [{ label: "Analiz et", onClick: runStart }]);
  dlg.showModal();
  if (!imageB64) $("mealNote").focus();
}
dlg.addEventListener("close", () => { session = null; });

function showError(msg, retry) {
  area.innerHTML = `<div class="error">${esc(msg)}</div>`;
  setButtons(actions, [{ label: "Tekrar dene", onClick: retry }]);
}

async function runStart() {
  const note = $("mealNote").value.trim();
  if (!session.imageB64 && !note) { $("mealNote").focus(); return; }
  area.innerHTML = loadingHtml("Yemeğini inceliyorum…");
  setButtons(actions, []);
  const t = totalsFor(currentDay);
  const today = `bugün şu ana kadar ${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g protein, ${Math.round(t.carbs)} g karbonhidrat yedi`;
  try {
    session.result = await session.chat.send({
      text: mealFirstPrompt({ hasImage: !!session.imageB64, note, today }),
      images: session.imageB64 ? [session.imageB64] : [],
    });
    showResult();
  } catch (err) {
    if (session) showError(err.message, runStart);
  }
}

async function runAnswers(answers) {
  area.innerHTML = loadingHtml("Cevaplarına göre hesaplıyorum…");
  setButtons(actions, []);
  try {
    session.result = await session.chat.send({ text: mealAnswersPrompt(answers) });
    showResult();
  } catch (err) {
    if (session) showError(err.message, () => runAnswers(answers));
  }
}

const CONF = { low: "Düşük güven", medium: "Orta güven", high: "Yüksek güven" };

function showResult() {
  if (!session) return;
  const r = session.result;
  const after = totalsFor(currentDay).kcal + r.total.kcal;
  const st = statusFor(after, settings.goal);
  const questions = r.questions;

  area.innerHTML = `
    <div class="result">
      <div class="title"><span>${esc(r.meal_name)}</span><span class="confidence">${CONF[r.confidence] ?? ""}</span></div>
      <table>${r.items.map((i) => `<tr><td>${esc(i.name)} <span class="hint">${esc(i.portion)}</span></td><td>${fmt(i.kcal)} kcal</td></tr>`).join("")}</table>
      <div class="kcal-edit"><strong>Toplam</strong>
        <input type="number" id="kcalEdit" value="${Math.round(r.total.kcal)}" inputmode="numeric"> kcal</div>
      <div class="hint">P ${fmt(r.total.protein_g)} g · K ${fmt(r.total.carbs_g)} g · Y ${fmt(r.total.fat_g)} g · Lif ${fmt(r.total.fiber_g)} g · Şeker ${fmt(r.total.sugar_g)} g</div>
      ${r.health_note ? `<div class="health-note">🩺 ${esc(r.health_note)}</div>` : ""}
      ${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ""}
    </div>
    ${questions.length ? `<p class="hint">Daha doğru hesaplamak için birkaç soru:</p>` : ""}
    ${questions.map((q, qi) => `
      <div class="q" data-q="${qi}">
        <div class="qtext">${esc(q.question)}</div>
        <div class="chips">${q.options.map((o) => `<button type="button" class="chip">${esc(o)}</button>`).join("")}</div>
        <input type="text" placeholder="veya kendin yaz…" class="qfree">
      </div>`).join("")}
    <div class="banner ${st.level} ${st.text ? "" : "hidden"}">Bu öğünle: ${fmt(after)} / ${fmt(settings.goal)} kcal<br>${esc(st.text)}</div>
  `;

  area.querySelectorAll(".q").forEach((qEl) => {
    qEl.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const on = !chip.classList.contains("on");
      qEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      chip.classList.toggle("on", on);
    });
  });

  if (questions.length) {
    setButtons(actions, [
      {
        label: "Cevapla ve güncelle",
        onClick: () => runAnswers(questions.map((q, qi) => {
          const qEl = area.querySelector(`[data-q="${qi}"]`);
          const chip = qEl.querySelector(".chip.on")?.textContent ?? "";
          const free = qEl.querySelector(".qfree").value.trim();
          return { question: q.question, answer: [chip, free].filter(Boolean).join(", ") };
        })),
      },
      { label: "Soruları geç, kaydet", cls: "ghost", onClick: saveMeal },
    ]);
  } else {
    setButtons(actions, [{ label: "Kaydet", onClick: saveMeal }]);
  }
}

function saveMeal() {
  const r = session.result;
  const edited = Number($("kcalEdit")?.value);
  const kcal = Number.isFinite(edited) && edited >= 0 ? edited : r.total.kcal;
  const ratio = r.total.kcal > 0 ? kcal / r.total.kcal : 1; // kullanıcı kaloriyi düzelttiyse makroları orantıla
  const now = new Date();
  const ok = addMeal({
    id: crypto.randomUUID(),
    date: currentDay,
    time: currentDay === dayKey(now) ? now.toTimeString().slice(0, 5) : "—",
    name: r.meal_name,
    kcal,
    protein: r.total.protein_g * ratio,
    carbs: r.total.carbs_g * ratio,
    fat: r.total.fat_g * ratio,
    fiber: r.total.fiber_g * ratio,
    sugar: r.total.sugar_g * ratio,
    items: r.items,
    note: $("mealNote").value.trim(),
    healthNote: r.health_note,
    thumb: session.thumb,
  });
  if (!ok) return;
  dlg.close();
  afterAdd(kcal);
}

/** Öğün eklendikten sonra: ekranı yenile, hedefe ulaşıldıysa uyar. */
function afterAdd(addedKcal) {
  render();
  const after = totalsFor(currentDay).kcal;
  const before = after - addedKcal;
  if (before < settings.goal && after >= settings.goal) {
    navigator.vibrate?.([200, 100, 200]);
    setTimeout(() => alert(statusFor(after, settings.goal).text), 50);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function onPhoto(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !ensureKey() || !confirmIfDone()) return;
  try {
    const img = await loadImage(file);
    const dataUrl = resize(img, 1280, 0.85);
    openAnalysis({ imageB64: dataUrl.split(",")[1], thumb: squareThumb(img, 160), preview: dataUrl });
  } catch {
    alert("Fotoğraf açılamadı.");
  }
}
$("cameraInput").addEventListener("change", onPhoto);
$("galleryInput").addEventListener("change", onPhoto);
$("textMealBtn").onclick = () => { if (ensureKey() && confirmIfDone()) openAnalysis({}); };

// ---------- Başlangıç ----------

initSettings({ onSaved: render });

const busy = () => !!session || settingsOpen() || suggestOpen();
initAutoUpdate(busy);
initPullToRefresh(busy);

let lastToday = currentDay;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = dayKey();
  if (today !== lastToday && currentDay === lastToday && !session) currentDay = today; // gece yarısı geçtiyse bugüne geç
  lastToday = today;
  render();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

render();
if (!activeKey()) openSettings();
