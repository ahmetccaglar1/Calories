// "Profil" sekmesi: hedefler (kalori + makro), profil ve sağlık durumu, yapay zeka, veri aktarımı.
import { $, esc, fmt, loadImage, resize, loadingHtml, toast, parseNum } from "./util.js";
import {
  settings, saveSettings, defaultMacros, macroTargets, computeGoal, minKcal, activeKey, importAll,
} from "./store.js";
import { Chat, diagnoseProvider } from "./ai.js";
import { backupNow } from "./backup.js";
import { PROFILE_SYSTEM, PROFILE_SCHEMA, profilePrompt, normalizeProfile } from "./prompt.js";
import { onRender, rerender, showTab, nav } from "./nav.js";
import { startOnboarding } from "./onboarding.js";

let labImages = [];       // tahlil fotoğrafları (base64), sadece hesaplama için; saklanmaz
let pendingHealth = null; // yapay zekanın önerdiği, henüz kaydedilmemiş sağlık özeti/kurallar
let dirty = false;        // formda kaydedilmemiş değişiklik var mı

const num = (id) => parseNum($(id).value);

function readProfile() {
  return {
    ...settings.profile,
    sex: $("pSex").value,
    age: num("pAge") || settings.profile.age,
    height: num("pHeight") || settings.profile.height,
    weight: num("pWeight") || settings.profile.weight,
    targetWeight: num("pTargetWeight") || 0,
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
  const diff = kcal - num("goalInput");
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

/** Formu kayıtlı ayarlarla doldurur. */
function fillForm() {
  const p = settings.profile;
  $("goalInput").value = settings.goal;
  fillMacros(macroTargets());
  $("pSex").value = p.sex;
  $("pAge").value = p.age;
  $("pHeight").value = p.height;
  $("pWeight").value = p.weight.toLocaleString("tr-TR");
  $("pTargetWeight").value = p.targetWeight ? p.targetWeight.toLocaleString("tr-TR") : "";
  $("pActivity").value = String(p.activity);
  $("pGoalType").value = p.goalType;
  $("pPace").value = String(p.pace);
  $("pHealth").value = p.health;
  $("providerInput").value = settings.provider;
  $("geminiKeyInput").value = settings.geminiKey;
  $("claudeKeyInput").value = settings.claudeKey;
  $("speedInput").value = settings.speed;
  renderGuidelines(p);
  syncVisibility();
  renderBackupInfo();
  dirty = false;
}

function renderBackupInfo() {
  $("backupInfo").textContent = settings.lastBackup
    ? `Son yedek: ${new Date(settings.lastBackup + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}. Yedek dosyasını Dosyalar'a veya iCloud Drive'a kaydet.`
    : "Henüz yedek almadın. Veriler sadece bu telefonda duruyor; Safari verilerini silersen kaybolur.";
}

async function runDiagnose() {
  // Formdaki (henüz kaydedilmemiş olabilecek) anahtarı kullan
  settings.provider = $("providerInput").value;
  settings.geminiKey = $("geminiKeyInput").value.trim();
  settings.claudeKey = $("claudeKeyInput").value.trim();
  const box = $("diagResult");
  if (!activeKey()) { box.innerHTML = `<div class="error">Önce API anahtarını gir.</div>`; return; }
  $("diagBtn").disabled = true;
  box.innerHTML = loadingHtml("Test ediliyor…");
  try {
    const rows = await diagnoseProvider();
    const allOk = rows.every((r) => r.ok);
    box.innerHTML = `
      <ul class="diag">${rows.map((r) => `<li class="${r.ok ? "ok" : "bad"}"><b>${r.ok ? "✓" : "✗"} ${esc(r.label)}</b><span>${esc(r.detail)}</span></li>`).join("")}</ul>
      <p class="hint">${allOk ? "Her şey çalışıyor." : "Sorun devam ederse bu ekranın görüntüsünü paylaş."}</p>`;
  } finally {
    $("diagBtn").disabled = false;
  }
}

export function openProfile(section) {
  showTab("profile");
  const target = section === "goals" ? "goalsSection" : section === "ai" ? "providerInput" : null;
  if (target) setTimeout(() => $(target).scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function saveFromForm() {
  settings.goal = Math.max(800, num("goalInput") || settings.goal);
  settings.macros = { protein: num("mProtein"), carbs: num("mCarbs"), fat: num("mFat"), fiber: num("mFiber") };
  settings.profile = readProfile();
  if (pendingHealth) Object.assign(settings.profile, pendingHealth);
  settings.provider = $("providerInput").value;
  settings.geminiKey = $("geminiKeyInput").value.trim();
  settings.claudeKey = $("claudeKeyInput").value.trim();
  settings.speed = $("speedInput").value;
  saveSettings();
  pendingHealth = null;
  dirty = false;
  rerender();
}

/** Yapay zekadan profil/hedef ister; sonuç nesnesini döndürür (uygulamaz). */
export async function askProfileTargets(p, images = []) {
  const chat = new Chat({ system: PROFILE_SYSTEM, schema: PROFILE_SCHEMA, normalize: normalizeProfile });
  const r = await chat.send({ text: profilePrompt(p, computeGoal(p)), images });
  return { ...r, daily_kcal: Math.max(minKcal(p.sex), Math.round(r.daily_kcal / 10) * 10) };
}

/** Yapay zeka sonucunu ayarlara uygular ve kaydeder. */
export function applyProfileTargets(r) {
  settings.goal = r.daily_kcal;
  settings.macros = { protein: Math.round(r.protein_g), carbs: Math.round(r.carbs_g), fat: Math.round(r.fat_g), fiber: Math.round(r.fiber_g) };
  Object.assign(settings.profile, { healthSummary: r.health_summary, guidelines: r.guidelines, avoid: r.avoid });
  saveSettings();
}

async function runAiProfile() {
  const p = readProfile();
  if (!p.age || !p.height || !p.weight) { toast("Önce yaş, boy ve kilonu gir."); return; }
  settings.provider = $("providerInput").value;
  settings.geminiKey = $("geminiKeyInput").value.trim();
  settings.claudeKey = $("claudeKeyInput").value.trim();
  if (!activeKey()) { toast("Bunun için Yapay zeka bölümüne API anahtarını gir."); $("providerInput").scrollIntoView({ behavior: "smooth" }); return; }

  const box = $("profileResult");
  const btn = $("aiProfileBtn");
  btn.disabled = true;
  box.innerHTML = loadingHtml(labImages.length ? "Tahlillerini okuyup hedeflerini hesaplıyorum…" : "Hedeflerini hesaplıyorum…");
  try {
    const r = await askProfileTargets(p, labImages);
    box.innerHTML = `
      <div class="result">
        <div class="title"><span>Önerilen hedefler</span></div>
        <div class="target-grid">
          <div><b>${fmt(r.daily_kcal)}</b><span>kcal</span></div>
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
      $("goalInput").value = r.daily_kcal;
      fillMacros({ protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g, fiber: r.fiber_g });
      pendingHealth = { healthSummary: r.health_summary, guidelines: r.guidelines, avoid: r.avoid };
      saveFromForm();
      apply.textContent = "Kaydedildi ✓";
      apply.disabled = true;
      toast("Hedeflerin güncellendi");
    };
    box.append(apply);
  } catch (err) {
    box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

export function initProfile() {
  // Sekme her açıldığında, kaydedilmemiş değişiklik yoksa formu güncel ayarlarla doldur
  onRender(() => { if (nav.tab === "profile" && !dirty) fillForm(); });
  $("settingsForm").addEventListener("input", () => { dirty = true; });

  $("providerInput").onchange = syncVisibility;
  $("pGoalType").onchange = syncVisibility;
  ["goalInput", "mProtein", "mCarbs", "mFat"].forEach((id) => $(id).addEventListener("input", updateMacroHint));
  $("autoMacrosBtn").onclick = () => { fillMacros(defaultMacros(num("goalInput") || settings.goal, num("pWeight") || settings.profile.weight)); dirty = true; };

  $("simpleCalcBtn").onclick = () => {
    const p = readProfile();
    const g = computeGoal(p);
    $("goalInput").value = g.kcal;
    fillMacros(defaultMacros(g.kcal, p.weight));
    dirty = true;
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
  $("saveSettings").onclick = () => { saveFromForm(); toast("Kaydedildi ✓"); };

  document.querySelectorAll(".paste-btn").forEach((b) => {
    b.onclick = async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) { $(b.dataset.target).value = text; dirty = true; toast("Yapıştırıldı. Kaydet'e basmayı unutma."); }
      } catch { toast("Panoya erişilemedi. Kutuya basılı tutup Yapıştır'ı seç."); }
    };
  });

  $("exportBtn").onclick = async () => { if (await backupNow()) renderBackupInfo(); };
  $("diagBtn").onclick = runDiagnose;

  $("importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!Array.isArray(obj.meals)) throw new Error();
      if (!confirm(`${obj.meals.length} öğün içe aktarılacak ve mevcut verilerin yerini alacak. Devam?`)) return;
      await importAll(obj);
      fillForm();
      rerender();
      toast("Veriler içe aktarıldı");
    } catch {
      toast("Geçersiz dosya.");
    }
  });

  $("rerunOnboarding").onclick = startOnboarding;
}
