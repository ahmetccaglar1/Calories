// Ayarlar: hedefler (kalori + makro), profil ve sağlık durumu, yapay zeka sağlayıcısı, veri aktarımı.
import { $, esc, fmt, loadImage, resize, loadingHtml } from "./util.js";
import { settings, saveSettings, meals, replaceMeals, dayKey, defaultMacros, macroTargets, computeGoal, minKcal, activeKey } from "./store.js";
import { Chat } from "./ai.js";
import { PROFILE_SYSTEM, PROFILE_SCHEMA, profilePrompt, normalizeProfile } from "./prompt.js";

const dlg = $("settingsDialog");
let onSaved = () => {};
let labImages = []; // tahlil fotoğrafları (base64), sadece hesaplama için; saklanmaz
let pendingHealth = null; // yapay zekanın önerdiği, henüz kaydedilmemiş sağlık özeti/kurallar

const num = (id) => Number($(id).value);

function readProfile() {
  return {
    ...settings.profile,
    sex: $("pSex").value,
    age: num("pAge") || settings.profile.age,
    height: num("pHeight") || settings.profile.height,
    weight: num("pWeight") || settings.profile.weight,
    activity: num("pActivity"),
    goalType: $("pGoalType").value,
    pace: num("pPace"),
    health: $("pHealth").value.trim(),
  };
}

function fillMacros(m) {
  $("mProtein").value = Math.round(m.protein);
  $("mCarbs").value = Math.round(m.carbs);
  $("mFat").value = Math.round(m.fat);
  $("mFiber").value = Math.round(m.fiber);
  updateMacroHint();
}

function updateMacroHint() {
  const kcal = num("mProtein") * 4 + num("mCarbs") * 4 + num("mFat") * 9;
  const goal = num("goalInput");
  const diff = kcal - goal;
  $("macroKcalHint").textContent = `Makrolar ≈ ${fmt(kcal)} kcal` +
    (Math.abs(diff) > 50 ? ` (hedeften ${diff > 0 ? "+" : ""}${fmt(diff)} kcal farklı)` : " ✓");
}

function renderGuidelines(h) {
  const box = $("currentGuidelines");
  if (!h || (!h.healthSummary && !h.guidelines.length && !h.avoid.length)) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="guide">
      ${h.healthSummary ? `<p><strong>Sağlık özeti:</strong> ${esc(h.healthSummary)}</p>` : ""}
      ${h.guidelines.length ? `<p><strong>Diyet kuralların</strong></p><ul>${h.guidelines.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      ${h.avoid.length ? `<p><strong>Sınırla / kaçın</strong></p><ul>${h.avoid.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function syncVisibility() {
  $("paceField").classList.toggle("hidden", $("pGoalType").value !== "lose");
  document.querySelectorAll("[data-provider]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.provider !== $("providerInput").value);
  });
}

export function openSettings(focus) {
  const p = settings.profile;
  $("goalInput").value = settings.goal;
  fillMacros(macroTargets());
  $("pSex").value = p.sex;
  $("pAge").value = p.age;
  $("pHeight").value = p.height;
  $("pWeight").value = p.weight;
  $("pActivity").value = String(p.activity);
  $("pGoalType").value = p.goalType;
  $("pPace").value = String(p.pace);
  $("pHealth").value = p.health;
  $("providerInput").value = settings.provider;
  $("geminiKeyInput").value = settings.geminiKey;
  $("claudeKeyInput").value = settings.claudeKey;
  $("profileResult").innerHTML = "";
  labImages = [];
  pendingHealth = null;
  $("labInfo").textContent = "";
  renderGuidelines(p);
  syncVisibility();
  dlg.showModal();
  if (focus === "goals") $("goalsSection").scrollIntoView({ block: "start" });
}

function saveFromForm() {
  settings.goal = Math.max(800, num("goalInput") || settings.goal);
  settings.macros = { protein: num("mProtein"), carbs: num("mCarbs"), fat: num("mFat"), fiber: num("mFiber") };
  settings.profile = readProfile();
  if (pendingHealth) Object.assign(settings.profile, pendingHealth);
  settings.provider = $("providerInput").value;
  settings.geminiKey = $("geminiKeyInput").value.trim();
  settings.claudeKey = $("claudeKeyInput").value.trim();
  saveSettings();
  pendingHealth = null;
  onSaved();
}

async function runAiProfile() {
  const p = readProfile();
  if (!p.age || !p.height || !p.weight) { alert("Önce yaş, boy ve kilonu gir."); return; }
  settings.provider = $("providerInput").value;
  settings.geminiKey = $("geminiKeyInput").value.trim();
  settings.claudeKey = $("claudeKeyInput").value.trim();
  if (!activeKey()) { alert("Bunun için aşağıdaki Yapay zeka bölümüne API anahtarını gir."); return; }

  const box = $("profileResult");
  const btn = $("aiProfileBtn");
  btn.disabled = true;
  box.innerHTML = loadingHtml(labImages.length ? "Tahlillerini okuyup hedeflerini hesaplıyorum…" : "Hedeflerini hesaplıyorum…");
  try {
    const chat = new Chat({ system: PROFILE_SYSTEM, schema: PROFILE_SCHEMA, normalize: normalizeProfile });
    const r = await chat.send({ text: profilePrompt(p, computeGoal(p)), images: labImages });
    const kcal = Math.max(minKcal(p.sex), Math.round(r.daily_kcal / 10) * 10);
    box.innerHTML = `
      <div class="result">
        <div class="title"><span>Önerilen hedefler</span></div>
        <div class="target-grid">
          <div><b>${fmt(kcal)}</b><span>kcal</span></div>
          <div><b>${fmt(r.protein_g)} g</b><span>protein</span></div>
          <div><b>${fmt(r.carbs_g)} g</b><span>karb.</span></div>
          <div><b>${fmt(r.fat_g)} g</b><span>yağ</span></div>
          <div><b>${fmt(r.fiber_g)} g</b><span>lif</span></div>
        </div>
        <div class="note">${esc(r.explanation)}</div>
      </div>`;
    renderGuidelines({ healthSummary: r.health_summary, guidelines: r.guidelines, avoid: r.avoid });
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn";
    apply.textContent = "✓ Bu hedefleri uygula ve kaydet";
    apply.onclick = () => {
      $("goalInput").value = kcal;
      fillMacros({ protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g, fiber: r.fiber_g });
      pendingHealth = { healthSummary: r.health_summary, guidelines: r.guidelines, avoid: r.avoid };
      saveFromForm();
      apply.textContent = "Kaydedildi ✓";
      apply.disabled = true;
    };
    box.append(apply);
  } catch (err) {
    box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

export function initSettings(opts) {
  onSaved = opts.onSaved;

  $("openSettings").onclick = () => openSettings();
  $("providerInput").onchange = syncVisibility;
  $("pGoalType").onchange = syncVisibility;
  ["goalInput", "mProtein", "mCarbs", "mFat"].forEach((id) => $(id).addEventListener("input", updateMacroHint));

  $("autoMacrosBtn").onclick = () => fillMacros(defaultMacros(num("goalInput") || settings.goal, num("pWeight") || settings.profile.weight));

  $("simpleCalcBtn").onclick = () => {
    const p = readProfile();
    const g = computeGoal(p);
    $("goalInput").value = g.kcal;
    fillMacros(defaultMacros(g.kcal, p.weight));
    $("profileResult").innerHTML = `<p class="hint">Bazal: ${fmt(g.bmr)} kcal · Günlük harcama: ${fmt(g.tdee)} kcal → Hedef: ${fmt(g.kcal)} kcal. Kaydet'e basmayı unutma.</p>`;
  };

  $("labInput").addEventListener("change", async (e) => {
    const files = [...e.target.files].slice(0, 4);
    e.target.value = "";
    labImages = [];
    for (const f of files) {
      try { labImages.push(resize(await loadImage(f), 1800, 0.85).split(",")[1]); } catch {}
    }
    $("labInfo").textContent = labImages.length ? `${labImages.length} fotoğraf eklendi (hesaplamada okunacak, saklanmaz)` : "";
  });

  $("aiProfileBtn").onclick = runAiProfile;

  $("settingsForm").addEventListener("submit", (e) => {
    if (e.submitter?.value === "save") saveFromForm();
  });

  $("exportBtn").onclick = () => {
    const { geminiKey, claudeKey, ...safe } = settings; // anahtarlar dışa aktarılmaz
    const blob = new Blob([JSON.stringify({ meals, settings: safe }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kalori-${dayKey()}.json`;
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
      replaceMeals(data.meals);
      const s = data.settings ?? (data.goal ? { goal: data.goal } : {});
      const { geminiKey, claudeKey, apiKey, ...rest } = s;
      Object.assign(settings, rest, { profile: { ...settings.profile, ...(rest.profile ?? {}) } });
      saveSettings();
      dlg.close();
      onSaved();
    } catch {
      alert("Geçersiz dosya.");
    }
  });
}

export const settingsOpen = () => dlg.open;
