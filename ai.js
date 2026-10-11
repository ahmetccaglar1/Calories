// Claude ile yemek analizi. Anahtar kullanıcının cihazında tutulur ve
// istek doğrudan tarayıcıdan api.anthropic.com'a gider.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.128.0";

const MODEL = "claude-opus-5-5";

const SYSTEM = `Sen deneyimli bir diyetisyensin ve kullanıcının kalori açığıyla kilo vermesine yardım ediyorsun.
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
const SCHEMA = {
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

export class AiError extends Error {}

/**
 * Bir analiz oturumu: ilk istek (fotoğraf + not) ve ardından soruların cevapları.
 * Konuşma geçmişi yalnızca sona ekleme ile büyür; modelin cevabı olduğu gibi geri gönderilir.
 */
export class MealAnalysis {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.messages = [];
  }

  async start({ imageBase64, note, context }) {
    const content = [];
    if (imageBase64) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
    }
    let text = imageBase64 ? "Bu öğünü analiz et." : "Bu öğünü açıklamadan analiz et.";
    if (note) text += `\nKullanıcının notu: ${note}`;
    if (context) text += `\n(Bilgi: ${context})`;
    content.push({ type: "text", text });
    this.messages.push({ role: "user", content });
    return this.#send();
  }

  async answer(answers) {
    const lines = answers.map((a) => `- ${a.question} → ${a.answer || "bilmiyorum"}`).join("\n");
    this.messages.push({
      role: "user",
      content: `Cevaplarım:\n${lines}\n\nBu cevaplara göre son tahmini ver, yeni soru sorma.`,
    });
    return this.#send();
  }

  async #send() {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: this.messages,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      this.messages.pop(); // başarısız isteği geçmişten çıkar, tekrar denenebilsin
      if (err instanceof Anthropic.AuthenticationError) throw new AiError("API anahtarı geçersiz. Ayarlardan kontrol et.");
      if (err instanceof Anthropic.PermissionDeniedError) throw new AiError("Bu API anahtarının modele erişim izni yok.");
      if (err instanceof Anthropic.RateLimitError) throw new AiError("Çok fazla istek. Biraz bekleyip tekrar dene.");
      if (err instanceof Anthropic.APIConnectionError) throw new AiError("Bağlantı kurulamadı. İnterneti kontrol et.");
      if (err instanceof Anthropic.APIError) throw new AiError(`API hatası (${err.status ?? "?"}): ${err.message}`);
      throw err;
    }

    if (response.stop_reason === "refusal") {
      this.messages.pop();
      throw new AiError("Model bu isteği yanıtlamadı. Farklı bir fotoğrafla dene.");
    }
    if (response.stop_reason === "max_tokens") {
      this.messages.pop();
      throw new AiError("Yanıt yarıda kesildi. Tekrar dene.");
    }

    this.messages.push({ role: "assistant", content: response.content });
    const textBlock = response.content.filter((b) => b.type === "text").pop();
    try {
      return JSON.parse(textBlock.text);
    } catch {
      throw new AiError("Yanıt okunamadı. Tekrar dene.");
    }
  }
}
