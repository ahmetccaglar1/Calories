// Sağlayıcıdan bağımsız sohbet: geçmişi tutar, seçili sağlayıcıyı (Gemini/Claude) çağırır, JSON sonucu döndürür.
import { AiError } from "./prompt.js";
import { settings, activeKey } from "./store.js";

const loadProvider = () => (settings.provider === "claude" ? import("./claude.js") : import("./gemini.js"));

export class Chat {
  /**
   * @param {{system: string, schema: object, normalize: (r: any) => any, tier?: "lite"|"standard"}} opts
   * tier: "lite" hızlı/ucuz model (öğün analizi), "standard" daha güçlü model.
   */
  constructor({ system, schema, normalize, tier = "standard" }) {
    this.system = system;
    this.schema = schema;
    this.normalize = normalize;
    this.tier = tier;
    this.turns = [];
  }

  /** Kullanıcı mesajı gönderir; images: base64 JPEG listesi; onText: akış sırasında birikmiş metin. */
  async send({ text, images = [], onText }) {
    let provider;
    try { provider = await loadProvider(); }
    catch { throw new AiError("Yapay zeka modülü yüklenemedi. İnterneti kontrol et."); }

    this.turns.push(provider.userTurn({ text, images }));
    let out;
    try {
      out = await provider.complete({ apiKey: activeKey(), system: this.system, turns: this.turns, schema: this.schema, tier: this.tier, onText });
    } catch (err) {
      this.turns.pop(); // başarısız isteği geçmişten çıkar, tekrar denenebilsin
      throw err instanceof AiError ? err : new AiError(`Beklenmeyen hata: ${err.message}`);
    }
    this.turns.push(out.turn);
    try {
      return this.normalize(JSON.parse(out.text));
    } catch {
      throw new AiError("Yanıt okunamadı. Tekrar dene.");
    }
  }
}
