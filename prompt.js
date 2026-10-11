// Yapay zeka görevlerinin (öğün analizi, yemek önerisi, profil/hedef hesaplama) talimatları ve çıktı şemaları.
// Şemalar standart JSON Schema; Claude doğrudan kullanır, Gemini için gemini.js çevirir.

export class AiError extends Error {}

const num = { type: "number" };
const str = { type: "string" };
const strList = { type: "array", items: str };
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

const n = (x) => (Number.isFinite(+x) ? +x : 0);
const list = (x) => (Array.isArray(x) ? x : []);

// ---------- Kullanıcı bağlamı ----------

const GOAL_TEXT = { lose: "kilo vermek (kalori açığı)", maintain: "kilosunu korumak", gain: "kilo/kas almak" };

/** Profil, sağlık durumu ve hedefleri yapay zekaya verilecek metne çevirir. */
export function profileContext(settings, targets) {
  const p = settings.profile;
  const lines = [
    `Kullanıcı: ${p.sex === "f" ? "kadın" : "erkek"}, ${p.age} yaş, ${p.height} cm, ${p.weight} kg. Amaç: ${GOAL_TEXT[p.goalType] ?? GOAL_TEXT.lose}.`,
    `Günlük hedef: ${settings.goal} kcal, protein ${targets.protein} g, karbonhidrat ${targets.carbs} g, yağ ${targets.fat} g, lif ${targets.fiber} g.`,
  ];
  if (p.healthSummary || p.health) lines.push(`Sağlık durumu: ${p.healthSummary || p.health}`);
  if (p.guidelines.length) lines.push(`Uyması gereken diyet kuralları: ${p.guidelines.join("; ")}`);
  if (p.avoid.length) lines.push(`Sınırlaması/kaçınması gerekenler: ${p.avoid.join("; ")}`);
  return lines.join("\n");
}

const COMMON = `Tüm metinleri Türkçe yaz. Sayıları tam sayıya yuvarla. Türk mutfağını iyi bil.`;

// ---------- Öğün analizi ----------

export const mealSystem = (context) => `Sen deneyimli bir diyetisyensin. Kullanıcı yediği yemeğin fotoğrafını ve/veya açıklamasını gönderir.
- Tabaktaki her yiyeceği tanımla, porsiyonu gram/adet olarak tahmin et (tabak, çatal, el gibi referanslardan ölçek çıkar).
- Her kalem için kcal, protein, karbonhidrat ve yağ (gram) tahmin et; toplamı, ayrıca toplam lif ve şekeri hesapla.
- Pişirme yağı ve tereyağı gibi gizli kalorileri hesaba kat.
- Tahmini en çok değiştirecek belirsizlikler için kısa sorular sor: nasıl pişti, ne kadar yağ/tereyağı kondu, porsiyonun ne kadarı yendi, görünmeyen malzeme, sos/içecek vb.
  En fazla 4 soru; her soruya 2-5 kısa hazır cevap seçeneği. Gerçekten belirsizlik yoksa soru sorma.
- Kullanıcı cevap verdiyse tahmini güncelle ve artık soru sorma (questions boş dizi).
- "health_note": kullanıcının sağlık durumu ve diyet kurallarına göre bu öğünle ilgili tek cümlelik uyarı veya öneri (örn. insülin direnci için kan şekerini hızlı yükselten kalemler). Söylenecek bir şey yoksa boş bırak.
- "notes": tahminin dayanağı hakkında tek cümle.
Fotoğrafta yiyecek yoksa items boş, toplamlar 0 olsun ve notes'ta belirt.
${COMMON}

${context}`;

export const MEAL_SCHEMA = obj({
  meal_name: { type: "string", description: "Kısa öğün adı, örn. 'Tavuk sote ve pilav'" },
  items: { type: "array", items: obj({ name: str, portion: str, kcal: num, protein_g: num, carbs_g: num, fat_g: num }) },
  total: obj({ kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num, sugar_g: num }),
  confidence: { type: "string", enum: ["low", "medium", "high"] },
  questions: { type: "array", items: obj({ id: str, question: str, options: strList }) },
  notes: str,
  health_note: str,
});

export const mealFirstPrompt = ({ hasImage, note, today }) => {
  let text = hasImage ? "Bu öğünü analiz et." : "Bu öğünü açıklamadan analiz et.";
  if (note) text += `\nKullanıcının notu: ${note}`;
  if (today) text += `\n(Bilgi: ${today})`;
  return text;
};

export const mealAnswersPrompt = (answers) => {
  const lines = answers.map((a) => `- ${a.question} → ${a.answer || "bilmiyorum"}`).join("\n");
  return `Cevaplarım:\n${lines}\n\nBu cevaplara göre son tahmini ver, yeni soru sorma.`;
};

export function normalizeMeal(r) {
  const t = r?.total ?? {};
  return {
    meal_name: r?.meal_name || "Öğün",
    items: list(r?.items).map((i) => ({
      name: i.name ?? "", portion: i.portion ?? "",
      kcal: n(i.kcal), protein_g: n(i.protein_g), carbs_g: n(i.carbs_g), fat_g: n(i.fat_g),
    })),
    total: { kcal: n(t.kcal), protein_g: n(t.protein_g), carbs_g: n(t.carbs_g), fat_g: n(t.fat_g), fiber_g: n(t.fiber_g), sugar_g: n(t.sugar_g) },
    confidence: r?.confidence ?? "medium",
    questions: list(r?.questions).filter((q) => q?.question)
      .map((q, i) => ({ id: q.id ?? String(i), question: q.question, options: list(q.options) })),
    notes: r?.notes ?? "",
    health_note: r?.health_note ?? "",
  };
}

// ---------- Yemek / tarif önerisi ----------

export const suggestSystem = (context) => `Sen pratik bir diyetisyen ve aşçısın. Kullanıcının günün geri kalanında kalan kalori ve makrolarına uyan yemekler öner.
- Tam 3 öneri ver. Kalan kaloriyi aşma; mümkünse en eksik makroyu (çoğunlukla protein) tamamla.
- Kullanıcının sağlık durumuna ve diyet kurallarına mutlaka uy, kaçınması gerekenleri önerme.
- Saate uygun öğün öner (kahvaltı, öğle, akşam, ara öğün). Türkiye'de kolay bulunan malzemeler kullan.
- type: "recipe" evde yapılacak tarif, "quick" hazırlığı 5 dakikayı geçmeyen/hazır, "outside" dışarıda/restoranda sipariş edilebilecek.
- Tariflerde malzemeleri gram/ölçüyle, adımları kısa ve net yaz. "quick" ve "outside" için steps kısa olabilir.
- "why": bu önerinin kullanıcının kalan hedeflerine ve sağlık durumuna neden uyduğu, tek cümle.
- Çeşitlilik çok önemli: kullanıcının son günlerde yediklerini ve ona daha önce önerilenleri TEKRAR ETME;
  farklı protein kaynakları, mutfaklar ve pişirme yöntemleri kullan. Favorileri zevkini anlamak için ipucudur, aynısını önerme.
- Kullanıcı başka öneri isterse öncekilerden farklı 3 öneri ver.
${COMMON}

${context}`;

export const SUGGEST_SCHEMA = obj({
  suggestions: {
    type: "array",
    items: obj({
      title: str,
      type: { type: "string", enum: ["recipe", "quick", "outside"] },
      why: str,
      kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num,
      prep_minutes: num,
      ingredients: strList,
      steps: strList,
    }),
  },
  tip: { type: "string", description: "Güne dair kısa bir ipucu" },
});

export function normalizeSuggestions(r) {
  return {
    suggestions: list(r?.suggestions).map((s) => ({
      title: s.title || "Öneri", type: s.type || "recipe", why: s.why ?? "",
      kcal: n(s.kcal), protein_g: n(s.protein_g), carbs_g: n(s.carbs_g), fat_g: n(s.fat_g), fiber_g: n(s.fiber_g),
      prep_minutes: n(s.prep_minutes), ingredients: list(s.ingredients), steps: list(s.steps),
    })),
    tip: r?.tip ?? "",
  };
}

// ---------- Profil / hedef hesaplama ----------

export const PROFILE_SYSTEM = `Sen klinik deneyimi olan bir diyetisyensin. Kullanıcının fiziksel bilgileri, amacı ve kendi cümleleriyle anlattığı sağlık durumu
(ve varsa tahlil sonucu fotoğrafları) verilir. Görevin:
- Günlük kalori hedefini belirle. Kilo verme amacında güvenli bir açık kullan; kadınlarda 1200, erkeklerde 1500 kcal'in altına inme.
- Protein, karbonhidrat, yağ ve lif hedeflerini gram olarak belirle. Sağlık durumuna göre ayarla
  (örn. insülin direnci/prediyabet: karbonhidratı düşür, lifi ve proteini artır; yüksek LDL: doymuş yağı sınırla; böbrek sorunu: proteini aşırı yükseltme).
- Tahlil fotoğrafı varsa normal aralık dışındaki değerleri oku ve özetle.
- "health_summary": sağlık durumunun diyetle ilgili kısa özeti (yüksek/düşük değerler dahil), 1-2 cümle. Bilgi yoksa boş.
- "guidelines": uygulanacak en önemli 3-6 somut diyet kuralı.
- "avoid": sınırlanacak veya kaçınılacak yiyecek/içecekler (en fazla 6).
- "explanation": hedeflerin nasıl belirlendiğinin 2-3 cümlelik açıklaması. Ciddi bir durum görürsen doktora/diyetisyene danışmasını öner.
${COMMON}`;

export const PROFILE_SCHEMA = obj({
  daily_kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num,
  health_summary: str,
  guidelines: strList,
  avoid: strList,
  explanation: str,
});

export function profilePrompt(p, local) {
  return [
    `Bilgilerim: ${p.sex === "f" ? "kadın" : "erkek"}, ${p.age} yaş, ${p.height} cm, ${p.weight} kg, aktivite katsayısı ${p.activity}.`,
    `Amacım: ${GOAL_TEXT[p.goalType] ?? GOAL_TEXT.lose}${p.goalType === "lose" ? ` (günlük yaklaşık ${p.pace} kcal açık istiyorum)` : ""}.`,
    `Hesaplanan bazal metabolizma ${Math.round(local.bmr)} kcal, günlük harcama ${Math.round(local.tdee)} kcal.`,
    p.health ? `Sağlık durumum ve tahlil değerlerim: ${p.health}` : "Bilinen bir sağlık sorunum yok.",
    "Hedeflerimi ve diyet kurallarımı belirle.",
  ].join("\n");
}

export function normalizeProfile(r) {
  return {
    daily_kcal: n(r?.daily_kcal), protein_g: n(r?.protein_g), carbs_g: n(r?.carbs_g), fat_g: n(r?.fat_g), fiber_g: n(r?.fiber_g),
    health_summary: r?.health_summary ?? "", guidelines: list(r?.guidelines), avoid: list(r?.avoid), explanation: r?.explanation ?? "",
  };
}
