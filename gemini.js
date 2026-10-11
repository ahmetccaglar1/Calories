// Google Gemini sağlayıcısı (ücretsiz kota). İstek doğrudan tarayıcıdan generativelanguage.googleapis.com'a gider.
import { AiError } from "./prompt.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
// Google'ın en güncel Flash modelini gösteren takma ad; çalışmazsa uygun model otomatik seçilir.
const DEFAULT_MODEL = "gemini-flash-latest";
const LS_MODEL = "kalori.geminiModel";

// Gemini'nin şema biçimi: büyük harfli tipler, additionalProperties yok.
function toGeminiSchema(s) {
  const out = { type: s.type.toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = s.required;
    out.propertyOrdering = Object.keys(s.properties);
  }
  return out;
}
const schemaCache = new WeakMap();
const geminiSchema = (s) => {
  if (!schemaCache.has(s)) schemaCache.set(s, toGeminiSchema(s));
  return schemaCache.get(s);
};

async function apiError(res) {
  let msg = "";
  try { msg = (await res.json())?.error?.message ?? ""; } catch {}
  if (/leaked/i.test(msg)) return new AiError("Bu Gemini anahtarı sızdırılmış olarak işaretlenmiş. AI Studio'dan yeni anahtar oluştur.");
  if (res.status === 400 && /api key/i.test(msg)) return new AiError("Gemini API anahtarı geçersiz. Ayarlardan kontrol et.");
  if (res.status === 403) return new AiError("Bu anahtarın Gemini API'ye erişim izni yok. AI Studio'dan yeni anahtar oluştur.");
  if (res.status === 429) return new AiError("Ücretsiz kullanım kotası doldu. Biraz bekleyip (veya yarın) tekrar dene.");
  if (res.status >= 500) return new AiError("Gemini şu an yanıt vermiyor. Biraz sonra tekrar dene.");
  return new AiError(`Gemini hatası (${res.status}): ${msg || res.statusText}`);
}

/** Anahtarın erişebildiği modeller arasından en uygun Flash modelini seçer. */
async function pickModel(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw await apiError(res);
  const names = ((await res.json()).models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash(-latest)?$/.test(n) || n === "gemini-flash-latest");
  if (!names.length) throw new AiError("Uygun Gemini modeli bulunamadı.");
  const ver = (n) => parseFloat(n.match(/[\d.]+/)?.[0] ?? "0");
  return names.sort((a, b) => ver(b) - ver(a))[0];
}

export const userTurn = ({ text, images }) => ({
  role: "user",
  parts: [...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })), { text }],
});

export async function complete({ apiKey, system, turns, schema }) {
  const request = (model) => fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns,
      generationConfig: { responseMimeType: "application/json", responseSchema: geminiSchema(schema) },
    }),
  });

  let data;
  try {
    let model = localStorage.getItem(LS_MODEL) || DEFAULT_MODEL;
    let res = await request(model);
    if (res.status === 404) {
      // Model adı kalkmış/değişmiş olabilir: erişilebilir modellerden seç ve hatırla.
      model = await pickModel(apiKey);
      localStorage.setItem(LS_MODEL, model);
      res = await request(model);
    }
    if (!res.ok) throw await apiError(res);
    data = await res.json();
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("Bağlantı kurulamadı. İnterneti kontrol et.");
  }

  const cand = data.candidates?.[0];
  if (!cand || data.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(cand.finishReason)) {
    throw new AiError("Gemini bu isteği yanıtlamadı. Farklı bir fotoğraf veya açıklamayla dene.");
  }
  if (cand.finishReason === "MAX_TOKENS") throw new AiError("Yanıt yarıda kesildi. Tekrar dene.");

  const text = (cand.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  return { text, turn: { role: "model", parts: [{ text }] } };
}
