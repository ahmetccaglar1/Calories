// Anthropic Claude sağlayıcısı (ücretli, isteğe bağlı). İstek doğrudan tarayıcıdan api.anthropic.com'a gider.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.128.0";
import { AiError } from "./prompt.js";

const MODEL = "claude-opus-5-5";

let client = null;
let clientKey = null;
function getClient(apiKey) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

export const userTurn = ({ text, images }) => ({
  role: "user",
  content: [
    ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text },
  ],
});

export async function complete({ apiKey, system, turns, schema }) {
  let response;
  try {
    response = await getClient(apiKey).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: turns,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("API anahtarı geçersiz. Ayarlardan kontrol et.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError("Bu API anahtarının modele erişim izni yok.");
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Çok fazla istek. Biraz bekleyip tekrar dene.");
    if (err instanceof Anthropic.APIConnectionError) throw new AiError("Bağlantı kurulamadı. İnterneti kontrol et.");
    if (err instanceof Anthropic.APIError) throw new AiError(`API hatası (${err.status ?? "?"}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new AiError("Model bu isteği yanıtlamadı. Farklı bir fotoğraf veya açıklamayla dene.");
  if (response.stop_reason === "max_tokens") throw new AiError("Yanıt yarıda kesildi. Tekrar dene.");

  const text = response.content.filter((b) => b.type === "text").pop()?.text ?? "";
  return { text, turn: { role: "assistant", content: response.content } };
}
