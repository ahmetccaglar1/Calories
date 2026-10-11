// Yapay zeka sağlayıcılarının (Gemini, Claude) ortak kullandığı talimat ve çıktı şeması.

export const SYSTEM = `Sen deneyimli bir diyetisyensin ve kullanıcının kalori açığıyla kilo vermesine yardım ediyorsun.
Kullanıcı yediği yemeğin fotoğrafını ve/veya açıklamasını gönderir. Görevin:
- Tabaktaki her yiyeceği tanımla, porsiyonu gram/adet olarak tahmin et (tabak, çatal, el gibi referanslardan ölçek çıkar).
- Her kalem için kcal, protein, karbonhidrat ve yağ (gram) tahmin et; toplamı hesapla.
- Türk mutfağını iyi bil (zeytinyağlılar, pilav, börek, kuru fasulye, döner vb.). Pişirme yağı ve tereyağı gibi gizli kalorileri hesaba kat.
- Tahmini en çok değiştirecek belirsizlikler için kısa sorular sor: nasıl pişti (kızartma/fırın/haşlama/ızgara), ne kadar yağ/tereyağı kondu, porsiyonun ne kadarı yendi, içinde görünmeyen malzeme var mı, sos/içecek vb.
  En fazla 4 soru sor; her soruya 2-5 kısa hazır cevap seçeneği ver. Gerçekten belirsizlik yoksa soru sorma.
- Kullanıcı cevap verdiyse tahmini cevaplara göre güncelle ve artık soru sorma (questions boş dizi).
Tüm metinleri Türkçe yaz. Sayıları tam sayıya yuvarla. "notes" alanına tek cümlelik kısa bir not yaz (örn. tahminin dayanağı ya da daha hafif bir alternatif).
Fotoğrafta yiyecek yoksa items boş, toplamlar 0 olsun ve notes'ta bunu belirt.`;

const macro = { type: "number" };

// Standart JSON Schema (Claude bunu doğrudan kullanır, Gemini için toGeminiSchema ile çevrilir).
export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meal_name", "items", "total", "confidence", "questions", "notes"],
  properties: {
    meal_name: { type: "string", description: "Kısa öğün adı, örn. 'Tavuk sote ve pilav'" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "portion", "kcal", "protein_g", "carbs_g", "fat_g"],
        properties: {
          name: { type: "string" },
          portion: { type: "string", description: "örn. '150 g' veya '1 dilim (30 g)'" },
          kcal: macro, protein_g: macro, carbs_g: macro, fat_g: macro,
        },
      },
    },
    total: {
      type: "object",
      additionalProperties: false,
      required: ["kcal", "protein_g", "carbs_g", "fat_g"],
      properties: { kcal: macro, protein_g: macro, carbs_g: macro, fat_g: macro },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "options"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes: { type: "string" },
  },
};

export const firstPrompt = ({ hasImage, note, context }) => {
  let text = hasImage ? "Bu öğünü analiz et." : "Bu öğünü açıklamadan analiz et.";
  if (note) text += `\nKullanıcının notu: ${note}`;
  if (context) text += `\n(Bilgi: ${context})`;
  return text;
};

export const answersPrompt = (answers) => {
  const lines = answers.map((a) => `- ${a.question} → ${a.answer || "bilmiyorum"}`).join("\n");
  return `Cevaplarım:\n${lines}\n\nBu cevaplara göre son tahmini ver, yeni soru sorma.`;
};

export class AiError extends Error {}

/** Modelin döndürdüğü JSON'u eksik alanlara karşı toparlar. */
export function normalizeResult(r) {
  const n = (x) => (Number.isFinite(+x) ? +x : 0);
  const items = Array.isArray(r?.items) ? r.items : [];
  const total = r?.total ?? {};
  return {
    meal_name: r?.meal_name || "Öğün",
    items: items.map((i) => ({
      name: i.name ?? "", portion: i.portion ?? "",
      kcal: n(i.kcal), protein_g: n(i.protein_g), carbs_g: n(i.carbs_g), fat_g: n(i.fat_g),
    })),
    total: { kcal: n(total.kcal), protein_g: n(total.protein_g), carbs_g: n(total.carbs_g), fat_g: n(total.fat_g) },
    confidence: r?.confidence ?? "medium",
    questions: (Array.isArray(r?.questions) ? r.questions : [])
      .filter((q) => q?.question)
      .map((q, i) => ({ id: q.id ?? String(i), question: q.question, options: Array.isArray(q.options) ? q.options : [] })),
    notes: r?.notes ?? "",
  };
}
