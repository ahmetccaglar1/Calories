// Öğün ekleme akışları: ekleme menüsü, son yenenler/favoriler, fotoğraf/yazı analizi, öğün düzenleme.
import { $, esc, fmt, setButtons, loadingHtml, loadImage, resize, squareThumb, toast, haptic } from "./util.js";
import {
  settings, activeKey, dayKey, totalsFor, macroTargets, MEAL_TYPES, mealTypeFor,
  addMeal, updateMeal, deleteMeal, restoreMeal, recentMeals, isFavorite, toggleFavorite, data,
} from "./store.js";
import { Chat } from "./ai.js";
import { mealSystem, MEAL_SCHEMA, normalizeMeal, mealFirstPrompt, mealAnswersPrompt, profileContext } from "./prompt.js";
import { nav, rerender } from "./nav.js";
import { statusFor } from "./today.js";
import { openProfile } from "./profile.js";

let session = null; // açık analiz: { chat, imageB64, thumb, result }
export const mealBusy = () => !!session;

// ---------- Ortak ----------

export function ensureKey() {
  if (activeKey()) return true;
  toast(settings.provider === "claude" ? "Önce Profil'den Anthropic API anahtarını gir." : "Önce Profil'den ücretsiz Gemini API anahtarını gir.");
  openProfile("ai");
  return false;
}

function confirmIfDone() {
  const t = totalsFor(nav.day);
  if (t.kcal < settings.goal) return true;
  return confirm(`🛑 Bugünlük hedefine ulaştın (${fmt(t.kcal)} / ${fmt(settings.goal)} kcal).\nYine de bu öğünü kaydetmek istiyor musun?`);
}

/** Öğün eklendikten sonra: ekranı yenile, hedefe ulaşıldıysa uyar, geri al imkânı ver. */
export function afterAdd(meal) {
  rerender();
  const after = totalsFor(meal.date).kcal;
  const before = after - meal.kcal;
  const undo = { label: "Geri al", onClick: () => { deleteMeal(meal.id); rerender(); } };
  if (before < settings.goal && after >= settings.goal) {
    haptic([200, 100, 200]);
    toast(statusFor(after, settings.goal).text, { action: undo, duration: 7000 });
  } else {
    toast(`${meal.name} eklendi · ${fmt(meal.kcal)} kcal`, { action: undo });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Ekleme menüsü ve hızlı ekleme ----------

const addDlg = $("addDialog");
let quickTab = "recent";

function renderQuick() {
  const list = quickTab === "fav" ? [...data.favorites].sort((a, b) => a.name.localeCompare(b.name, "tr")) : recentMeals();
  $("quickList").innerHTML = list.length
    ? list.map((m, i) => `
      <li><button type="button" data-i="${i}">
        ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<span class="ph">🍽️</span>`}
        <span class="info"><span class="name">${esc(m.name)}</span><span class="meta">P ${fmt(m.protein)} · K ${fmt(m.carbs)} · Y ${fmt(m.fat)}</span></span>
        <span class="kcal">${fmt(m.kcal)}<small> kcal</small></span>
        <span class="plus">+</span>
      </button></li>`).join("")
    : `<li class="empty small">${quickTab === "fav" ? "Henüz favorin yok. Bir öğüne dokunup ☆ ile ekleyebilirsin." : "Son 30 günde kayıt yok."}</li>`;
  $("quickList").querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      const src = list[+b.dataset.i];
      const { name, kcal, protein, carbs, fat, fiber, sugar, items, thumb } = src;
      const meal = addMeal({ name, kcal, protein, carbs, fat, fiber, sugar, items, thumb, note: "", healthNote: src.healthNote ?? "",
        mealType: mealTypeFor(nav.day === dayKey() ? new Date().toTimeString() : "12") }, nav.day);
      addDlg.close();
      afterAdd(meal);
    };
  });
}

function openAddMenu() {
  quickTab = data.favorites.length && !recentMeals().length ? "fav" : quickTab;
  document.querySelectorAll("#quickTabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === quickTab));
  renderQuick();
  addDlg.showModal();
}

// ---------- Analiz ----------

const dlg = $("analyzeDialog");
const area = $("analysisArea");
const actions = $("analyzeActions");

function openAnalysis({ imageB64 = null, thumb = null, preview = null, note = "" }) {
  addDlg.close();
  session = {
    chat: new Chat({
      system: mealSystem(profileContext(settings, macroTargets())),
      schema: MEAL_SCHEMA,
      normalize: normalizeMeal,
      tier: settings.speed === "balanced" ? "standard" : "lite",
    }),
    imageB64, thumb, result: null,
  };
  $("mealNote").value = note;
  $("previewImg").classList.toggle("hidden", !preview);
  if (preview) $("previewImg").src = preview;
  area.innerHTML = imageB64 ? "" : `<p class="hint">Ne yediğini yaz: örn. "2 yumurtalı menemen, 1 dilim beyaz ekmek, şekersiz çay"</p>`;
  setButtons(actions, [{ label: "Analiz et", onClick: runStart }]);
  dlg.showModal();
  if (!imageB64) $("mealNote").focus();
}
export { openAnalysis };

function showError(msg, retry) {
  area.innerHTML = `<div class="error">${esc(msg)}</div>`;
  setButtons(actions, [{ label: "Tekrar dene", onClick: retry }]);
}

async function runStart() {
  const s = session;
  const note = $("mealNote").value.trim();
  if (!s.imageB64 && !note) { $("mealNote").focus(); return; }
  area.innerHTML = loadingHtml("Yemeğini inceliyorum…");
  setButtons(actions, []);
  const t = totalsFor(nav.day);
  const today = `bugün şu ana kadar ${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g protein, ${Math.round(t.carbs)} g karbonhidrat yedi`;
  try {
    s.result = await s.chat.send({
      text: mealFirstPrompt({ hasImage: !!s.imageB64, note, today }),
      images: s.imageB64 ? [s.imageB64] : [],
    });
    if (session === s) showResult();
  } catch (err) {
    if (session === s) showError(err.message, runStart);
  }
}

async function runAnswers(answers) {
  const s = session;
  area.innerHTML = loadingHtml("Cevaplarına göre hesaplıyorum…");
  setButtons(actions, []);
  try {
    s.result = await s.chat.send({ text: mealAnswersPrompt(answers) });
    if (session === s) showResult();
  } catch (err) {
    if (session === s) showError(err.message, () => runAnswers(answers));
  }
}

const CONF = { low: "Düşük güven", medium: "Orta güven", high: "Yüksek güven" };

function showResult() {
  const r = session.result;
  const after = totalsFor(nav.day).kcal + r.total.kcal;
  const st = statusFor(after, settings.goal);
  const questions = r.questions;

  area.innerHTML = `
    <div class="result">
      <div class="title"><span>${esc(r.meal_name)}</span><span class="confidence">${CONF[r.confidence] ?? ""}</span></div>
      <table>${r.items.map((i) => `<tr><td>${esc(i.name)} <span class="hint">${esc(i.portion)}</span></td><td>${fmt(i.kcal)} kcal</td></tr>`).join("")}</table>
      <div class="kcal-edit"><strong>Toplam</strong>
        <input type="number" id="kcalEdit" value="${Math.round(r.total.kcal)}" inputmode="numeric"> kcal</div>
      <div class="macro-chips">
        <span style="--c:var(--protein)">P ${fmt(r.total.protein_g)} g</span>
        <span style="--c:var(--carbs)">K ${fmt(r.total.carbs_g)} g</span>
        <span style="--c:var(--fat)">Y ${fmt(r.total.fat_g)} g</span>
        <span style="--c:var(--fiber)">Lif ${fmt(r.total.fiber_g)} g</span>
      </div>
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
      haptic();
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
      { label: "Soruları geç, kaydet", cls: "ghost", onClick: saveAnalyzed },
    ]);
  } else {
    setButtons(actions, [{ label: "Kaydet", onClick: saveAnalyzed }]);
  }
}

function saveAnalyzed() {
  const r = session.result;
  const edited = Number($("kcalEdit")?.value);
  const kcal = Number.isFinite(edited) && edited >= 0 ? edited : r.total.kcal;
  const ratio = r.total.kcal > 0 ? kcal / r.total.kcal : 1; // kullanıcı kaloriyi düzelttiyse makroları orantıla
  const meal = addMeal({
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
    mealType: mealTypeFor(nav.day === dayKey() ? new Date().toTimeString() : "12"),
  }, nav.day);
  dlg.close();
  afterAdd(meal);
}

async function onPhoto(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !ensureKey() || !confirmIfDone()) return;
  try {
    const img = await loadImage(file);
    const dataUrl = resize(img, 1024, 0.8);
    openAnalysis({ imageB64: dataUrl.split(",")[1], thumb: squareThumb(img, 160), preview: dataUrl });
  } catch {
    toast("Fotoğraf açılamadı.");
  }
}

// ---------- Düzenleme ----------

const editDlg = $("editDialog");
let editing = null; // { meal, base, portion }

const scaleFields = ["kcal", "protein", "carbs", "fat", "fiber", "sugar"];

function fillEditNumbers() {
  const p = editing.portion;
  $("eKcal").value = Math.round(editing.base.kcal * p);
  $("eProtein").value = Math.round(editing.base.protein * p);
  $("eCarbs").value = Math.round(editing.base.carbs * p);
  $("eFat").value = Math.round(editing.base.fat * p);
}

function updateFavButton() {
  $("eFav").textContent = isFavorite($("eName").value || editing.meal.name) ? "★ Favorilerde" : "☆ Favorilere ekle";
}

export function openEdit(meal) {
  editing = { meal, base: Object.fromEntries(scaleFields.map((k) => [k, meal[k] || 0])), portion: 1 };
  $("eName").value = meal.name;
  $("eType").innerHTML = MEAL_TYPES.map((t) => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join("");
  $("eType").value = meal.mealType;
  $("eTime").value = /^\d\d:\d\d$/.test(meal.time) ? meal.time : "";
  document.querySelectorAll("#ePortion button").forEach((b) => b.classList.toggle("on", b.dataset.v === "1"));
  fillEditNumbers();
  $("eDetail").innerHTML = `
    ${meal.items?.length ? `<table class="detail-table">${meal.items.map((i) => `<tr><td>${esc(i.name)} <span class="hint">${esc(i.portion)}</span></td><td>${fmt(i.kcal)} kcal</td></tr>`).join("")}</table>` : ""}
    <div class="hint">Lif ${fmt(meal.fiber)} g · Şeker ${fmt(meal.sugar)} g${meal.note ? ` · Not: ${esc(meal.note)}` : ""}</div>
    ${meal.healthNote ? `<div class="health-note">🩺 ${esc(meal.healthNote)}</div>` : ""}`;
  updateFavButton();
  editDlg.showModal();
}

function saveEdit() {
  const m = editing.meal;
  const kcal = Number($("eKcal").value) || 0;
  const p = editing.portion;
  // Elle değiştirilmeyen alanlar (lif, şeker) porsiyonla ölçeklenir
  const updated = {
    ...m,
    name: $("eName").value.trim() || m.name,
    mealType: $("eType").value,
    time: $("eTime").value || m.time,
    kcal,
    protein: Number($("eProtein").value) || 0,
    carbs: Number($("eCarbs").value) || 0,
    fat: Number($("eFat").value) || 0,
    fiber: editing.base.fiber * p,
    sugar: editing.base.sugar * p,
  };
  updateMeal(updated);
  editDlg.close();
  rerender();
  toast("Öğün güncellendi");
}

// ---------- Başlatma ----------

export function initMeal() {
  $("addBtn").onclick = () => { haptic(); openAddMenu(); };
  document.querySelectorAll("#quickTabs button").forEach((b) => {
    b.onclick = () => {
      quickTab = b.dataset.v;
      document.querySelectorAll("#quickTabs button").forEach((x) => x.classList.toggle("on", x === b));
      renderQuick();
    };
  });
  $("cameraInput").addEventListener("change", onPhoto);
  $("galleryInput").addEventListener("change", onPhoto);
  $("textMealBtn").onclick = () => { if (ensureKey() && confirmIfDone()) openAnalysis({}); };
  dlg.addEventListener("close", () => { session = null; });

  document.querySelectorAll("#ePortion button").forEach((b) => {
    b.onclick = () => {
      editing.portion = Number(b.dataset.v);
      document.querySelectorAll("#ePortion button").forEach((x) => x.classList.toggle("on", x === b));
      fillEditNumbers();
      haptic();
    };
  });
  $("eName").addEventListener("input", updateFavButton);
  $("eFav").onclick = () => {
    const m = { ...editing.meal, name: $("eName").value.trim() || editing.meal.name, kcal: Number($("eKcal").value) || 0,
      protein: Number($("eProtein").value) || 0, carbs: Number($("eCarbs").value) || 0, fat: Number($("eFat").value) || 0 };
    toast(toggleFavorite(m) ? "Favorilere eklendi ⭐" : "Favorilerden çıkarıldı");
    updateFavButton();
  };
  $("eDelete").onclick = () => {
    const m = editing.meal;
    deleteMeal(m.id);
    editDlg.close();
    rerender();
    toast(`"${m.name}" silindi`, { action: { label: "Geri al", onClick: () => { restoreMeal(m); rerender(); } } });
  };
  $("eSave").onclick = saveEdit;
}
