// Google Gemini sağlayıcısı (ücretsiz kota). İstek doğrudan tarayıcıdan generativelanguage.googleapis.com'a gider.
import { AiError } from "./prompt.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
// Google'ın en güncel modellerini gösteren takma adlar; çalışmazsa uygun model otomatik seçilir.
const TIERS = {
  standard: { alias: "gemini-flash-latest", pattern: /^gemini-[\d.]+-flash$/, ls: "kalori.geminiModel" },
  lite: { alias: "gemini-flash-lite-latest", pattern: /^gemini-[\d.]+-flash-lite$/, ls: "kalori.geminiModel.lite" },
};

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

/** Anahtarın erişebildiği modeller arasından bu seviyeye uygun en yeni modeli seçer (yoksa null). */
async function pickModel(apiKey, tier) {
  const res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw await apiError(res);
  const names = ((await res.json()).models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => TIERS[tier].pattern.test(n));
  const ver = (n) => parseFloat(n.match(/[\d.]+/)?.[0] ?? "0");
  return names.sort((a, b) => ver(b) - ver(a))[0] ?? null;
}

/** SSE akışını okuyup her parçadaki metni biriktirir. */
async function readStream(res, onText) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", text = "", last = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const chunk = JSON.parse(line.slice(5));
      last = chunk;
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      const add = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
      if (add) { text += add; onText(text); }
    }
  }
  // Son parçayı tüm metinle birleştir ki aşağıdaki kontroller aynı kalsın
  const cand = last?.candidates?.[0] ?? {};
  return { ...last, candidates: [{ ...cand, content: { parts: [{ text }] } }] };
}

export const userTurn = ({ text, images }) => ({
  role: "user",
  parts: [...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })), { text }],
});

export async function complete({ apiKey, system, turns, schema, tier = "standard", onText }) {
  const method = onText ? "streamGenerateContent?alt=sse" : "generateContent";
  const request = (model) => fetch(`${BASE}/models/${model}:${method}`, {
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
    let t = TIERS[tier] ?? TIERS.standard;
    let res = await request(localStorage.getItem(t.ls) || t.alias);
    if (res.status === 404) {
      // Model adı kalkmış/değişmiş olabilir: erişilebilir modellerden seç ve hatırla.
      let model = await pickModel(apiKey, tier);
      if (!model && tier !== "standard") { t = TIERS.standard; model = localStorage.getItem(t.ls) || await pickModel(apiKey, "standard"); }
      if (!model) throw new AiError("Uygun Gemini modeli bulunamadı.");
      localStorage.setItem(t.ls, model);
      res = await request(model);
    }
    if (!res.ok) throw await apiError(res);
    data = onText ? await readStream(res, onText) : await res.json();
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
