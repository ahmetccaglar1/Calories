// İlk açılış kurulum sihirbazı: tanıtım → profil → sağlık → yapay zeka anahtarı → hedefler hesaplanır.
import { $, esc, fmt, setButtons, loadingHtml, toast, parseNum } from "./util.js";
import { settings, saveSettings, computeGoal, defaultMacros } from "./store.js";
import { rerender } from "./nav.js";
import { askProfileTargets, applyProfileTargets } from "./profile.js";

const dlg = $("onboardDialog");
let step = 0;
let ob = null; // sihirbaz boyunca girilenler

const STEPS = 4;

function dots() {
  $("obDots").innerHTML = Array.from({ length: STEPS }, (_, i) => `<i class="${i === step ? "on" : i < step ? "done" : ""}"></i>`).join("");
}

function read() {
  const v = (id) => $(id)?.value;
  if (step === 1) {
    Object.assign(ob, {
      sex: v("obSex"), age: +v("obAge") || ob.age, height: +v("obHeight") || ob.height, weight: parseNum(v("obWeight")) || ob.weight,
      targetWeight: parseNum(v("obTarget")) || 0, activity: +v("obActivity"), goalType: v("obGoal"), pace: +v("obPace"),
    });
  }
  if (step === 2) ob.health = v("obHealth").trim();
  if (step === 3) ob.key = v("obKey").trim();
}

function go(n) { read(); step = n; render(); }

function render() {
  dots();
  const box = $("obStep");
  const act = $("obActions");
  if (step === 0) {
    box.innerHTML = `
      <img src="kalori-icon-180.png" class="ob-logo" alt="">
      <h2>Kalori Günlüğü</h2>
      <p class="lead">Yediğinin fotoğrafını çek, gerisini yapay zeka halletsin.</p>
      <ul class="ob-list">
        <li><span>📸</span>Fotoğraftan kalori ve makro hesabı</li>
        <li><span>🩺</span>Sağlık durumuna göre kişisel hedefler</li>
        <li><span>🍳</span>Kalan hakkına göre yemek ve tarif önerileri</li>
        <li><span>🛑</span>Hedefe ulaşınca "bugünlük bitti" uyarısı</li>
      </ul>`;
    setButtons(act, [{ label: "Başlayalım", onClick: () => go(1) }]);
  } else if (step === 1) {
    box.innerHTML = `
      <h2>Seni tanıyalım</h2>
      <p class="lead">Günlük kalori ihtiyacını hesaplamak için.</p>
      <div class="grid2">
        <label class="field"><span>Cinsiyet</span><select id="obSex"><option value="m">Erkek</option><option value="f">Kadın</option></select></label>
        <label class="field"><span>Yaş</span><input type="number" id="obAge" inputmode="numeric" value="${ob.age}"></label>
        <label class="field"><span>Boy (cm)</span><input type="number" id="obHeight" inputmode="numeric" value="${ob.height}"></label>
        <label class="field"><span>Kilo (kg)</span><input type="text" id="obWeight" inputmode="decimal" value="${ob.weight}"></label>
        <label class="field"><span>Amaç</span><select id="obGoal"><option value="lose">Kilo vermek</option><option value="maintain">Korumak</option><option value="gain">Kilo/kas almak</option></select></label>
        <label class="field"><span>Hedef kilo</span><input type="text" id="obTarget" inputmode="decimal" placeholder="isteğe bağlı" value="${ob.targetWeight || ""}"></label>
        <label class="field"><span>Aktivite</span><select id="obActivity">
          <option value="1.2">Hareketsiz</option><option value="1.375">Hafif aktif</option><option value="1.55">Orta aktif</option><option value="1.725">Çok aktif</option></select></label>
        <label class="field"><span>Tempo</span><select id="obPace"><option value="300">Yavaş</option><option value="500">Orta</option><option value="750">Hızlı</option></select></label>
      </div>`;
    $("obSex").value = ob.sex; $("obGoal").value = ob.goalType; $("obActivity").value = String(ob.activity); $("obPace").value = String(ob.pace);
    setButtons(act, [{ label: "Geri", cls: "ghost", onClick: () => go(0) }, { label: "İleri", onClick: () => go(2) }]);
  } else if (step === 2) {
    box.innerHTML = `
      <h2>Sağlık durumun</h2>
      <p class="lead">İsteğe bağlı. Kendi cümlelerinle yaz; hedeflerin ve önerilerin buna göre ayarlanır.</p>
      <textarea id="obHealth" rows="5" placeholder="örn. insülin direncim var, açlık şekeri 108. LDL 165. Laktozu iyi sindiremiyorum.">${esc(ob.health)}</textarea>
      <p class="hint">Tahlil fotoğrafı eklemek istersen daha sonra Profil sekmesinden ekleyebilirsin.</p>`;
    setButtons(act, [{ label: "Geri", cls: "ghost", onClick: () => go(1) }, { label: ob.health ? "İleri" : "Atla", onClick: () => go(3) }]);
    $("obHealth").addEventListener("input", (e) => { act.lastChild.textContent = e.target.value.trim() ? "İleri" : "Atla"; });
  } else if (step === 3) {
    box.innerHTML = `
      <h2>Yapay zeka anahtarı</h2>
      <p class="lead">Fotoğraf analizi için Google'ın ücretsiz Gemini anahtarı gerekiyor. Bir kere girmen yeterli.</p>
      <ol class="ob-steps">
        <li>Aşağıdaki butonla Google AI Studio'yu aç, Google hesabınla gir.</li>
        <li><b>Create API key</b>'e bas ve anahtarı kopyala.</li>
        <li>Buraya dönüp <b>Yapıştır</b>'a bas.</li>
      </ol>
      <a class="btn ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">🔑 Anahtar al (Google)</a>
      <span class="key-row">
        <input type="password" id="obKey" placeholder="AIza..." autocomplete="off" value="${esc(ob.key)}">
        <button type="button" class="btn ghost small" id="obPaste">Yapıştır</button>
      </span>
      <p class="hint">Anahtar sadece bu cihazda saklanır.</p>`;
    $("obPaste").onclick = async () => {
      try { $("obKey").value = (await navigator.clipboard.readText()).trim(); } catch { toast("Kutuya basılı tutup Yapıştır'ı seç."); }
    };
    setButtons(act, [{ label: "Geri", cls: "ghost", onClick: () => go(2) }, { label: "Bitir", onClick: finish }]);
  }
}

async function finish() {
  read();
  const { key, health, ...body } = ob;
  Object.assign(settings.profile, body, { health });
  if (key) { settings.provider = "gemini"; settings.geminiKey = key; }
  const local = computeGoal(settings.profile);
  settings.goal = local.kcal;
  settings.macros = defaultMacros(local.kcal, settings.profile.weight);
  saveSettings();

  if (key) {
    $("obStep").innerHTML = `<h2>Hedeflerin hesaplanıyor</h2>${loadingHtml("Profiline ve sağlık durumuna göre kişisel hedeflerini belirliyorum…")}`;
    $("obActions").innerHTML = "";
    try {
      applyProfileTargets(await askProfileTargets(settings.profile));
    } catch (err) {
      toast(`Yapay zeka hedefi hesaplanamadı, standart hesap kullanıldı. (${err.message})`, { duration: 6000 });
    }
  }
  settings.onboarded = true;
  saveSettings();
  $("obStep").innerHTML = `
    <div class="ob-done">🎉</div>
    <h2>Hazırsın!</h2>
    <p class="lead">Günlük hedefin <b>${fmt(settings.goal)} kcal</b>.<br>Protein ${fmt(settings.macros.protein)} g · Karb. ${fmt(settings.macros.carbs)} g · Yağ ${fmt(settings.macros.fat)} g</p>
    <p class="hint">Hedeflerini istediğin zaman Profil sekmesinden değiştirebilirsin.</p>`;
  step = STEPS - 1;
  setButtons($("obActions"), [{ label: "Uygulamaya geç", onClick: () => { dlg.close(); rerender(); } }]);
}

export function startOnboarding() {
  const p = settings.profile;
  ob = {
    sex: p.sex, age: p.age, height: p.height, weight: p.weight, targetWeight: p.targetWeight, activity: p.activity,
    goalType: p.goalType, pace: p.pace, health: p.health, key: settings.geminiKey,
  };
  step = 0;
  render();
  if (!dlg.open) dlg.showModal();
}

export function initOnboarding() {
  dlg.addEventListener("cancel", (e) => { if (!settings.onboarded) e.preventDefault(); }); // ilk kurulumda Esc ile kapanmasın
}
