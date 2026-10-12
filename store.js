// Uygulama durumu. Ayarlar localStorage'da; öğünler, kilo, su, favoriler ve öneri geçmişi IndexedDB'de.
// Açılışta hepsi belleğe yüklenir; okumalar senkron, yazmalar arka planda kalıcı hale getirilir.
import { openDb } from "./db.js";

const LS_SETTINGS = "kalori.settings";
const LS_OLD_MEALS = "kalori.meals"; // ilk sürümlerin localStorage kaydı
const DATA_VERSION = 2;

export const DEFAULT_PROFILE = {
  sex: "m", age: 30, height: 175, weight: 80, targetWeight: 0, activity: 1.375,
  goalType: "lose", pace: 500,
  health: "",          // kullanıcının kendi cümleleriyle sağlık durumu / tahlil değerleri
  healthSummary: "",   // yapay zekanın çıkardığı kısa özet
  guidelines: [],      // uygulanacak diyet kuralları
  avoid: [],           // kaçınılacak/sınırlanacak yiyecekler
};

const loadJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const stored = loadJson(LS_SETTINGS, {});
export const settings = {
  goal: 2000,
  macros: null,        // { protein, carbs, fat, fiber } gram
  provider: "gemini",
  geminiKey: "",
  claudeKey: "",
  speed: "fast",       // fast: öğün analizinde hızlı model, balanced: standart model
  onboarded: false,
  lastBackup: null,    // son yedeğin tarihi (YYYY-MM-DD)
  backupSnoozed: null, // "sonra" dendiği gün
  dataVersion: 1,
  ...stored,
  profile: { ...DEFAULT_PROFILE, ...(stored.profile ?? {}) },
};
if (settings.apiKey) { settings.claudeKey ||= settings.apiKey; delete settings.apiKey; }
if (!settings.onboarded && (settings.geminiKey || settings.claudeKey)) settings.onboarded = true; // mevcut kullanıcılar sihirbazı görmesin

export function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); return true; }
  catch { alert("Ayarlar kaydedilemedi: depolama dolu."); return false; }
}

// ---------- Koleksiyonlar ----------

let db = null;
export const data = { meals: [], weights: [], water: [], favorites: [], suggested: [], pending: [] };

const persist = (p) => p.catch(() => alert("Kayıt yapılamadı: cihaz depolaması dolu olabilir. Eski verileri dışa aktarıp temizlemeyi dene."));

function upsert(store, item) {
  const list = data[store];
  const i = list.findIndex((x) => x.id === item.id);
  i >= 0 ? (list[i] = item) : list.push(item);
  persist(db.put(store, item));
}
function remove(store, id) {
  data[store] = data[store].filter((x) => x.id !== id);
  persist(db.del(store, id));
}

export async function initStore() {
  db = await openDb();
  for (const s of Object.keys(data)) data[s] = (await db.getAll(s)) ?? [];

  if (settings.dataVersion < DATA_VERSION) {
    // v1 → v2: öğünler localStorage'dan IndexedDB'ye, öğün türü ve lif/şeker alanları eklenir
    const old = loadJson(LS_OLD_MEALS, []);
    const known = new Set(data.meals.map((m) => m.id));
    const migrated = old.filter((m) => !known.has(m.id)).map(migrateMeal);
    if (migrated.length) {
      await db.putMany("meals", migrated);
      data.meals.push(...migrated);
    }
    data.meals = data.meals.map(migrateMeal);
    settings.dataVersion = DATA_VERSION;
    saveSettings();
    if (old.length) localStorage.removeItem(LS_OLD_MEALS);
  }
}

function migrateMeal(m) {
  return { fiber: 0, sugar: 0, items: [], note: "", healthNote: "", thumb: null, ...m, mealType: m.mealType || mealTypeFor(m.time) };
}

// ---------- Tarih ve öğün türü ----------

export const dayKey = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return dayKey(d); };
export const nowTime = () => new Date().toTimeString().slice(0, 5);

export const MEAL_TYPES = [
  { key: "breakfast", label: "Kahvaltı", icon: "🌅" },
  { key: "lunch", label: "Öğle", icon: "☀️" },
  { key: "snack", label: "Ara öğün", icon: "🍎" },
  { key: "dinner", label: "Akşam", icon: "🌙" },
];

export function mealTypeFor(time) {
  const h = parseInt(time, 10);
  if (Number.isNaN(h)) return "snack";
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 18 && h < 22) return "dinner";
  return "snack";
}

// ---------- Öğünler ----------

export const mealsFor = (day) => data.meals.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));

export function totalsFor(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };
  for (const m of mealsFor(day)) for (const k in t) t[k] += m[k] || 0;
  return t;
}

/** Yeni öğün kaydı oluşturur (eksik alanları doldurur) ve ekler. */
export function addMeal(fields, day) {
  const time = day === dayKey() ? nowTime() : "12:00";
  const meal = migrateMeal({ id: crypto.randomUUID(), date: day, time, ...fields });
  upsert("meals", meal);
  return meal;
}
export const updateMeal = (m) => upsert("meals", m);
export const deleteMeal = (id) => remove("meals", id);
export const restoreMeal = (m) => upsert("meals", m);

/** Son 30 günde en sık yenenler (isme göre tekil). */
export function recentMeals(limit = 12) {
  const since = addDays(dayKey(), -30);
  const byName = new Map();
  for (const m of data.meals) {
    if (m.date < since) continue;
    const k = m.name.toLocaleLowerCase("tr");
    const e = byName.get(k);
    if (!e) byName.set(k, { meal: m, count: 1, last: m.date + m.time });
    else { e.count++; if (m.date + m.time > e.last) { e.meal = m; e.last = m.date + m.time; } }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, limit).map((e) => e.meal);
}

// ---------- Favoriler ----------

const favId = (name) => "fav:" + name.toLocaleLowerCase("tr").trim();
export const isFavorite = (name) => data.favorites.some((f) => f.id === favId(name));
export function toggleFavorite(m) {
  const id = favId(m.name);
  if (isFavorite(m.name)) { remove("favorites", id); return false; }
  const { name, kcal, protein, carbs, fat, fiber, sugar, items, thumb, mealType } = m;
  upsert("favorites", { id, name, kcal, protein, carbs, fat, fiber, sugar, items, thumb, mealType });
  return true;
}

// ---------- Kilo ----------

export const weightsSorted = () => [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
export function setWeight(day, kg) {
  upsert("weights", { id: day, date: day, kg });
  const latest = weightsSorted().at(-1);
  if (latest) { settings.profile.weight = latest.kg; saveSettings(); }
}

// ---------- Su ----------

export const WATER_GLASS_ML = 250;
export const waterGoal = () => Math.max(6, Math.round((settings.profile.weight * 33) / WATER_GLASS_ML));
export const waterFor = (day) => data.water.find((w) => w.id === day)?.glasses ?? 0;
export const setWater = (day, glasses) => upsert("water", { id: day, glasses: Math.max(0, glasses) });

// ---------- Öneri geçmişi (tekrarı önlemek için) ----------

export function rememberSuggestions(titles) {
  const day = dayKey();
  for (const t of titles) upsert("suggested", { id: crypto.randomUUID(), date: day, title: t });
  const old = [...data.suggested].sort((a, b) => b.date.localeCompare(a.date)).slice(40);
  for (const o of old) remove("suggested", o.id);
}
export const recentSuggestions = () => data.suggested.map((s) => s.title);

// ---------- Bekleyen analizler (çevrimdışı çekilen fotoğraflar) ----------

export function addPending(item) {
  const p = { id: crypto.randomUUID(), createdAt: Date.now(), ...item };
  upsert("pending", p);
  return p;
}
export const removePending = (id) => remove("pending", id);
export const pendingSorted = () => [...data.pending].sort((a, b) => a.createdAt - b.createdAt);

// ---------- Yedekleme ----------

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Yedek hatırlatması gösterilsin mi: kayıt var, son yedek 7 günden eski ve bugün ertelenmemiş. */
export function backupDue() {
  if (!data.meals.length) return false;
  const today = dayKey();
  if (settings.backupSnoozed && daysBetween(settings.backupSnoozed, today) < 3) return false;
  return !settings.lastBackup || daysBetween(settings.lastBackup, today) >= 7;
}
export function markBackedUp() { settings.lastBackup = dayKey(); settings.backupSnoozed = null; saveSettings(); }
export function snoozeBackup() { settings.backupSnoozed = dayKey(); saveSettings(); }

/** Tarayıcıdan verilerin kendiliğinden silinmemesini ister (destekleniyorsa). */
export async function requestPersistence() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

// ---------- Hedefler ----------

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

export const activeKey = () => (settings.provider === "claude" ? settings.claudeKey : settings.geminiKey);

// ---------- Dışa / içe aktarma ----------

export function exportAll() {
  const { geminiKey, claudeKey, ...safe } = settings; // anahtarlar dışa aktarılmaz
  const { pending, ...rest } = data; // bekleyen ham fotoğraflar yedeğe girmez
  return { version: DATA_VERSION, settings: safe, ...rest };
}

export async function importAll(obj) {
  const meals = Array.isArray(obj.meals) ? obj.meals : null;
  if (!meals) throw new Error("invalid");
  for (const s of Object.keys(data)) {
    if (s === "pending") continue;
    const list = s === "meals" ? meals.map(migrateMeal) : Array.isArray(obj[s]) ? obj[s] : [];
    await db.clear(s);
    if (list.length) await db.putMany(s, list);
    data[s] = list;
  }
  const s = obj.settings ?? (obj.goal ? { goal: obj.goal } : {});
  const { geminiKey, claudeKey, apiKey, ...rest } = s;
  Object.assign(settings, rest, { profile: { ...settings.profile, ...(rest.profile ?? {}) }, dataVersion: DATA_VERSION });
  saveSettings();
}
