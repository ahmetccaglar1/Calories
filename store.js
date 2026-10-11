// Uygulama durumu: öğünler, ayarlar, hedefler. Hepsi cihazda (localStorage).

const LS_MEALS = "kalori.meals";
const LS_SETTINGS = "kalori.settings";

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { alert("Depolama dolu. Eski verileri dışa aktarıp silmeyi dene."); return false; }
};

export const DEFAULT_PROFILE = {
  sex: "m", age: 30, height: 175, weight: 80, activity: 1.375,
  goalType: "lose", pace: 500,
  health: "",          // kullanıcının kendi cümleleriyle sağlık durumu / tahlil değerleri
  healthSummary: "",   // yapay zekanın çıkardığı kısa özet (tahlil fotoğrafı dahil)
  guidelines: [],      // uygulanacak diyet kuralları
  avoid: [],           // kaçınılacak/sınırlanacak yiyecekler
};

const stored = load(LS_SETTINGS, {});
export const settings = {
  goal: 2000,
  macros: null, // { protein, carbs, fat, fiber } gram
  provider: "gemini",
  geminiKey: "",
  claudeKey: "",
  ...stored,
  profile: { ...DEFAULT_PROFILE, ...(stored.profile ?? {}) },
};
if (settings.apiKey) { settings.claudeKey ||= settings.apiKey; delete settings.apiKey; } // ilk sürümden taşı

export let meals = load(LS_MEALS, []);

export const saveSettings = () => save(LS_SETTINGS, settings);
export const saveMeals = () => save(LS_MEALS, meals);
export function replaceMeals(list) { meals = list; return saveMeals(); }
export function addMeal(m) {
  meals.push(m);
  if (!saveMeals()) { meals.pop(); return false; }
  return true;
}
export function deleteMeal(id) { meals = meals.filter((m) => m.id !== id); saveMeals(); }

export const activeKey = () => (settings.provider === "claude" ? settings.claudeKey : settings.geminiKey);

export const dayKey = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const mealsFor = (day) => meals.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));

export function totalsFor(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };
  for (const m of mealsFor(day)) for (const k in t) t[k] += m[k] || 0;
  return t;
}

/** Kalori ve kiloya göre varsayılan makro dağılımı (gram). */
export function defaultMacros(kcal, weight) {
  const protein = Math.round(Math.min(1.8 * weight, (kcal * 0.35) / 4));
  const fat = Math.round((kcal * 0.28) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat, fiber: Math.round((kcal / 1000) * 14) };
}

export const macroTargets = () => settings.macros ?? defaultMacros(settings.goal, settings.profile.weight);

export const minKcal = (sex) => (sex === "f" ? 1200 : 1500);

/** Mifflin-St Jeor ile bazal metabolizma ve günlük harcama, hedefe göre kalori. */
export function computeGoal(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * p.activity;
  const delta = p.goalType === "lose" ? -p.pace : p.goalType === "gain" ? 300 : 0;
  const kcal = Math.max(minKcal(p.sex), Math.round((tdee + delta) / 10) * 10);
  return { bmr, tdee, kcal };
}
