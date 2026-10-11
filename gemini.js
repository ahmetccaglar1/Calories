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

async function apiError(res, model) {
  let msg = "";
  try { msg = (await res.json())?.error?.message ?? ""; } catch {}
  console.warn("Gemini hatası", res.status, model, msg);
  if (/leaked/i.test(msg)) return new AiError("Bu Gemini anahtarı sızdırılmış olarak işaretlenmiş. AI Studio'dan yeni anahtar oluştur.");
  if (res.status === 400 && /api key/i.test(msg)) return new AiError("Gemini API anahtarı geçersiz. Ayarlardan kontrol et.");
  if (res.status === 403) return new AiError("Bu anahtarın Gemini API'ye erişim izni yok. AI Studio'dan yeni anahtar oluştur.");
  if (res.status === 429) return new AiError("Ücretsiz kullanım kotası doldu. Biraz bekleyip (veya yarın) tekrar dene.");
  if (res.status >= 500) return new AiError(`Gemini şu an yanıt vermiyor (${res.status}${msg ? `: ${msg.slice(0, 140)}` : ""}). Birkaç dakika sonra tekrar dene; olmazsa Profil'den öğün analizini "Daha doğru (Flash)" yap.`);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isServerError = (res) => res.status >= 500 && res.status < 600;

/** Bu seviyenin model adını döndürür; ad kalkmışsa (404) erişilebilir modellerden seçip hatırlar. */
async function resolveModel(apiKey, tier, request) {
  let t = TIERS[tier] ?? TIERS.standard;
  const model = localStorage.getItem(t.ls) || t.alias;
  const res = await request(model);
  if (res.status !== 404) return { model, res };
  let picked = await pickModel(apiKey, tier);
  if (!picked && tier !== "standard") { t = TIERS.standard; picked = localStorage.getItem(t.ls) || await pickModel(apiKey, "standard"); }
  if (!picked) throw new AiError("Uygun Gemini modeli bulunamadı.");
  localStorage.setItem(t.ls, picked);
  return { model: picked, res: await request(picked) };
}

export async function complete({ apiKey, system, turns, schema, tier = "standard", onText }) {
  const method = onText ? "streamGenerateContent?alt=sse" : "generateContent";
  // strict=false: şema zorlaması olmadan JSON modu (bazı şemalarda Gemini 500 dönebiliyor); şema talimata eklenir
  const request = (model, strict = true) => fetch(`${BASE}/models/${model}:${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: strict ? system : `${system}\n\nYanıtı yalnızca şu JSON şemasına uyan tek bir JSON nesnesi olarak ver:\n${JSON.stringify(schema)}` }] },
      contents: turns,
      generationConfig: strict
        ? { responseMimeType: "application/json", responseSchema: geminiSchema(schema) }
        : { responseMimeType: "application/json" },
    }),
  });

  let data;
  try {
    let { model, res } = await resolveModel(apiKey, tier, request);
    // Sunucu hatası (500/503 "aşırı yüklü" vb.): kısa beklemeyle iki kez tekrar dene
    for (const wait of [1200, 3000]) {
      if (!isServerError(res)) break;
      await sleep(wait);
      res = await request(model);
    }
    // Hâlâ olmuyorsa diğer modeli dene (Flash-Lite ↔ Flash)
    if (isServerError(res)) {
      const other = tier === "lite" ? "standard" : "lite";
      try {
        const alt = await resolveModel(apiKey, other, request);
        if (alt.res.ok || !isServerError(alt.res)) ({ model, res } = alt);
      } catch {}
    }
    // Son çare: şema zorlaması olmadan
    if (isServerError(res)) res = await request(model, false);
    if (!res.ok) throw await apiError(res, model);
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
