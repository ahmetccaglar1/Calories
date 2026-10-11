import { MealAnalysis, AiError } from "./ai.js";

// ---------- Storage ----------
const LS_MEALS = "kalori.meals";
const LS_SETTINGS = "kalori.settings";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { alert("Depolama dolu. Eski verileri dışa aktarıp silmeyi dene."); return false; }
};

let meals = load(LS_MEALS, []);
let settings = { goal: 2000, apiKey: "", ...load(LS_SETTINGS, {}) };

const dayKey = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
let currentDay = dayKey(new Date());

const mealsFor = (day) => meals.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));
const totalsFor = (day) => mealsFor(day).reduce(
  (t, m) => ({ kcal: t.kcal + m.kcal, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }),
  { kcal: 0, protein: 0, carbs: 0, fat: 0 },
);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Math.round(n).toLocaleString("tr-TR");

const RING_LEN = 2 * Math.PI * 52;
$("ringFg").style.strokeDasharray = RING_LEN;

function statusFor(eaten, goal) {
  const left = goal - eaten;
  if (left <= 0) return { level: "stop", text: left === 0
    ? `🛑 Bugünlük yemek bitti! ${fmt(goal)} kcal hedefine ulaştın. Yarın görüşürüz.`
    : `🛑 Bugünlük yemek bitti! Hedefini ${fmt(-left)} kcal aştın. Bugün başka bir şey yeme, su iç 💧` };
  if (eaten >= goal * 0.85) return { level: "warn", text: `⚠️ Az kaldı: sadece ${fmt(left)} kcal hakkın var. Hafif bir şey seç ya da günü burada kapat.` };
  return { level: "ok", text: "" };
}

function render() {
  const today = dayKey(new Date());
  const d = new Date(currentDay + "T12:00:00");
  $("dayTitle").textContent = currentDay === today ? "Bugün"
    : d.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "long" });
  $("nextDay").style.visibility = currentDay >= today ? "hidden" : "visible";

  const t = totalsFor(currentDay);
  const goal = settings.goal;
  $("eaten").textContent = fmt(t.kcal);
  $("target").textContent = fmt(goal);
  $("remaining").textContent = `${fmt(goal - t.kcal)} kcal`;
  $("protein").textContent = `${fmt(t.protein)} g`;
  $("carbs").textContent = `${fmt(t.carbs)} g`;
  $("fat").textContent = `${fmt(t.fat)} g`;

  const st = statusFor(t.kcal, goal);
  const ring = $("ringFg");
  ring.style.strokeDashoffset = RING_LEN * (1 - Math.min(t.kcal / goal, 1));
  ring.classList.toggle("warn", st.level === "warn");
  ring.classList.toggle("stop", st.level === "stop");

  const banner = $("banner");
  banner.className = `banner ${st.level}`;
  banner.textContent = st.text;
  banner.classList.toggle("hidden", !st.text);

  const list = mealsFor(currentDay);
  $("emptyMeals").classList.toggle("hidden", list.length > 0);
  $("meals").innerHTML = list.map((m) => `
    <li class="meal">
      ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<div class="ph">🍽️</div>`}
      <div class="info">
        <div class="name">${esc(m.name)}</div>
        <div class="meta">${esc(m.time)} · P ${fmt(m.protein)} · K ${fmt(m.carbs)} · Y ${fmt(m.fat)}</div>
      </div>
      <div class="kcal">${fmt(m.kcal)} kcal</div>
      <button data-del="${m.id}" aria-label="Sil">🗑</button>
    </li>`).join("");
}

$("meals").addEventListener("click", (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id) return;
  const m = meals.find((x) => x.id === id);
  if (m && confirm(`"${m.name}" silinsin mi?`)) {
    meals = meals.filter((x) => x.id !== id);
    save(LS_MEALS, meals);
    render();
  }
});

const shiftDay = (n) => {
  const d = new Date(currentDay + "T12:00:00");
  d.setDate(d.getDate() + n);
  currentDay = dayKey(d);
  render();
};
$("prevDay").onclick = () => shiftDay(-1);
$("nextDay").onclick = () => shiftDay(1);

// ---------- Images ----------
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function resize(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
function squareThumb(img, size) {
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}

// ---------- Analysis flow ----------
const dlg = $("analyzeDialog");
const area = $("analysisArea");
const actions = $("analyzeActions");
let session = null; // { analysis, imageB64, thumb, result }

function ensureKey() {
  if (settings.apiKey) return true;
  alert("Önce ayarlardan Anthropic API anahtarını gir.");
  openSettings();
  return false;
}

function confirmIfDone() {
  const t = totalsFor(currentDay);
  if (t.kcal < settings.goal) return true;
  return confirm(`🛑 Bugünlük hedefine ulaştın (${fmt(t.kcal)} / ${fmt(settings.goal)} kcal).\nYine de bu öğünü kaydetmek istiyor musun?`);
}

function openAnalysis({ imageB64 = null, thumb = null, preview = null }) {
  session = { analysis: new MealAnalysis(settings.apiKey), imageB64, thumb, result: null };
  $("mealNote").value = "";
  $("previewImg").classList.toggle("hidden", !preview);
  if (preview) $("previewImg").src = preview;
  area.innerHTML = imageB64 ? "" : `<p class="hint">Ne yediğini yaz: örn. "2 yumurtalı menemen, 1 dilim beyaz ekmek, şekersiz çay"</p>`;
  setActions([{ label: "Analiz et", onClick: runStart }]);
  dlg.showModal();
  if (!imageB64) $("mealNote").focus();
}

function setActions(btns) {
  actions.innerHTML = "";
  for (const b of btns) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `btn ${b.cls ?? ""}`;
    el.textContent = b.label;
    el.onclick = b.onClick;
    actions.append(el);
  }
}

function showLoading(text) {
  area.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;
  setActions([]);
}

function showError(msg, retry) {
  area.innerHTML = `<div class="error">${esc(msg)}</div>`;
  setActions([{ label: "Tekrar dene", onClick: retry }]);
}

async function runStart() {
  const note = $("mealNote").value.trim();
  if (!session.imageB64 && !note) { $("mealNote").focus(); return; }
  showLoading("Yemeğini inceliyorum…");
  const t = totalsFor(currentDay);
  const context = `kullanıcının günlük hedefi ${settings.goal} kcal, bugün şu ana kadar ${Math.round(t.kcal)} kcal yedi`;
  try {
    session.result = await session.analysis.start({ imageBase64: session.imageB64, note, context });
    showResult();
  } catch (err) {
    showError(err instanceof AiError ? err.message : `Beklenmeyen hata: ${err.message}`, runStart);
  }
}

async function runAnswers(answers) {
  showLoading("Cevaplarına göre hesaplıyorum…");
  try {
    session.result = await session.analysis.answer(answers);
    showResult();
  } catch (err) {
    showError(err instanceof AiError ? err.message : `Beklenmeyen hata: ${err.message}`, () => runAnswers(answers));
  }
}

const CONF = { low: "Düşük güven", medium: "Orta güven", high: "Yüksek güven" };

function showResult() {
  const r = session.result;
  const t = totalsFor(currentDay);
  const after = t.kcal + r.total.kcal;
  const st = statusFor(after, settings.goal);
  const questions = r.questions ?? [];

  area.innerHTML = `
    <div class="result">
      <div class="title"><span>${esc(r.meal_name)}</span><span class="confidence">${CONF[r.confidence] ?? ""}</span></div>
      <table>${r.items.map((i) => `<tr><td>${esc(i.name)} <span class="hint">${esc(i.portion)}</span></td><td>${fmt(i.kcal)} kcal</td></tr>`).join("")}</table>
      <div class="kcal-edit"><strong>Toplam</strong>
        <input type="number" id="kcalEdit" value="${Math.round(r.total.kcal)}" inputmode="numeric"> kcal</div>
      <div class="hint">P ${fmt(r.total.protein_g)} g · K ${fmt(r.total.carbs_g)} g · Y ${fmt(r.total.fat_g)} g</div>
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

  const btns = [];
  if (questions.length) {
    btns.push({
      label: "Cevapla ve güncelle",
      onClick: () => {
        const answers = questions.map((q, qi) => {
          const qEl = area.querySelector(`[data-q="${qi}"]`);
          const chip = qEl.querySelector(".chip.on")?.textContent ?? "";
          const free = qEl.querySelector(".qfree").value.trim();
          return { question: q.question, answer: [chip, free].filter(Boolean).join(", ") };
        });
        runAnswers(answers);
      },
    });
    btns.push({ label: "Soruları geç, kaydet", cls: "ghost", onClick: saveMeal });
  } else {
    btns.push({ label: "Kaydet", onClick: saveMeal });
  }
  setActions(btns);
}

function saveMeal() {
  const r = session.result;
  const edited = Number($("kcalEdit")?.value);
  const kcal = Number.isFinite(edited) && edited >= 0 ? edited : r.total.kcal;
  const ratio = r.total.kcal > 0 ? kcal / r.total.kcal : 1; // kullanıcı kaloriyi düzelttiyse makroları orantıla
  const now = new Date();
  const before = totalsFor(currentDay).kcal;
  meals.push({
    id: crypto.randomUUID(),
    date: currentDay,
    time: currentDay === dayKey(now) ? now.toTimeString().slice(0, 5) : "—",
    name: r.meal_name,
    kcal,
    protein: r.total.protein_g * ratio,
    carbs: r.total.carbs_g * ratio,
    fat: r.total.fat_g * ratio,
    items: r.items,
    note: $("mealNote").value.trim(),
    thumb: session.thumb,
  });
  if (!save(LS_MEALS, meals)) { meals.pop(); return; }
  dlg.close();
  session = null;
  render();

  const after = before + kcal;
  if (before < settings.goal && after >= settings.goal) {
    navigator.vibrate?.([200, 100, 200]);
    setTimeout(() => alert(statusFor(after, settings.goal).text), 50);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("photoInput").addEventListener("change", async (e) => {
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
});
$("textMealBtn").onclick = () => { if (ensureKey() && confirmIfDone()) openAnalysis({}); };

// ---------- Settings ----------
const sDlg = $("settingsDialog");
function openSettings() {
  $("goalInput").value = settings.goal;
  $("keyInput").value = settings.apiKey;
  $("calcResult").textContent = "";
  sDlg.showModal();
}
$("openSettings").onclick = openSettings;
$("settingsForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  settings.goal = Number($("goalInput").value) || settings.goal;
  settings.apiKey = $("keyInput").value.trim();
  save(LS_SETTINGS, settings);
  render();
});

$("calcBtn").onclick = () => {
  // Mifflin-St Jeor
  const w = +$("cWeight").value, h = +$("cHeight").value, a = +$("cAge").value;
  const bmr = 10 * w + 6.25 * h - 5 * a + ($("cSex").value === "m" ? 5 : -161);
  const tdee = bmr * +$("cAct").value;
  const floor = $("cSex").value === "m" ? 1500 : 1200;
  const goal = Math.max(floor, Math.round((tdee - +$("cDeficit").value) / 10) * 10);
  $("goalInput").value = goal;
  $("calcResult").textContent = `Bazal: ${fmt(bmr)} kcal · Günlük harcama: ${fmt(tdee)} kcal → Hedef: ${fmt(goal)} kcal`;
};

$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ meals, goal: settings.goal }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kalori-${dayKey(new Date())}.json`;
  a.click();
};
$("importInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.meals)) throw new Error();
    if (!confirm(`${data.meals.length} öğün içe aktarılacak ve mevcut verilerin yerini alacak. Devam?`)) return;
    meals = data.meals;
    if (data.goal) settings.goal = data.goal;
    save(LS_MEALS, meals);
    save(LS_SETTINGS, settings);
    sDlg.close();
    render();
  } catch {
    alert("Geçersiz dosya.");
  }
});

// Gün değişince (uygulama arka planda açık kaldıysa) bugüne dön
let lastToday = currentDay;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = dayKey(new Date());
  if (today !== lastToday && currentDay === lastToday && !session) currentDay = today;
  lastToday = today;
  render();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

render();
if (!settings.apiKey) openSettings();
