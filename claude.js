// Claude ile yemek analizi (ücretli, isteğe bağlı). Anahtar kullanıcının cihazında tutulur ve
// istek doğrudan tarayıcıdan api.anthropic.com'a gider.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.128.0";
import { SYSTEM, SCHEMA, firstPrompt, answersPrompt, AiError, normalizeResult } from "./prompt.js";

const MODEL = "claude-opus-5-5";

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
    content.push({ type: "text", text: firstPrompt({ hasImage: !!imageBase64, note, context }) });
    this.messages.push({ role: "user", content });
    return this.#send();
  }

  async answer(answers) {
    this.messages.push({ role: "user", content: answersPrompt(answers) });
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
      return normalizeResult(JSON.parse(textBlock.text));
    } catch {
      throw new AiError("Yanıt okunamadı. Tekrar dene.");
    }
  }
}
