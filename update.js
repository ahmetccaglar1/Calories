// Yeni sürüm kontrolü (deploy sonrası otomatik yenileme) ve aşağı çekerek yenileme.
import { toast } from "./util.js";

// Sitedeki bu dosyalardan biri değişirse yeni sürüm çıkmış demektir.
const FILES = [
  "./", "styles.css", "sw.js", "manifest.json",
  "app.js", "nav.js", "store.js", "db.js", "util.js", "ai.js", "prompt.js", "gemini.js", "claude.js", "today.js", "meal.js", "history.js", "charts.js", "suggest.js", "profile.js", "barcode.js", "onboarding.js", "update.js",
];
const CHECK_EVERY_MS = 2 * 60 * 1000;

async function fingerprint() {
  try {
    const tags = await Promise.all(FILES.map(async (f) => {
      const res = await fetch(f, { method: "HEAD", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return res.headers.get("etag") || res.headers.get("last-modified") || res.headers.get("content-length") || "";
    }));
    return tags.join("|");
  } catch {
    return null; // çevrimdışı vb.: bu sefer karar verme
  }
}

/** Service worker'ı güncelleyip sayfayı ağdan yeniden yükler. */
export async function hardReload(message = "Yenileniyor…") {
  toast(message, { duration: 0 });
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
  location.reload();
}

/** @param {() => boolean} isBusy kullanıcı bir işin ortasındaysa true (yenileme ertelenir) */
export function initAutoUpdate(isBusy) {
  let base = null;
  let lastCheck = 0;
  let pending = false;

  fingerprint().then((f) => { base = f; });

  const tryReload = () => {
    if (isBusy()) return setTimeout(tryReload, 3000);
    hardReload("Yeni sürüm yükleniyor…");
  };

  const check = async () => {
    if (pending || document.visibilityState !== "visible" || Date.now() - lastCheck < 15000) return;
    lastCheck = Date.now();
    const f = await fingerprint();
    if (!f) return;
    if (!base) { base = f; return; }
    if (f !== base) { pending = true; tryReload(); }
  };

  document.addEventListener("visibilitychange", check);
  setInterval(check, CHECK_EVERY_MS);
}

/** Sayfanın en üstündeyken aşağı çekip bırakınca yeniler. */
export function initPullToRefresh(isBusy) {
  const el = document.createElement("div");
  el.className = "ptr";
  el.innerHTML = `<span class="ptr-icon">↓</span><span class="ptr-text">Yenilemek için çek</span>`;
  document.body.prepend(el);
  const text = el.querySelector(".ptr-text");
  const THRESHOLD = 90;
  let startY = null;
  let dist = 0;

  const reset = () => {
    startY = null;
    dist = 0;
    el.style.transform = "";
    el.classList.remove("pulling", "ready");
  };

  window.addEventListener("touchstart", (e) => {
    startY = window.scrollY <= 0 && !isBusy() && e.touches.length === 1 ? e.touches[0].clientY : null;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    dist = (e.touches[0].clientY - startY) * 0.5;
    if (dist <= 0) { el.classList.remove("pulling"); el.style.transform = ""; return; }
    el.classList.add("pulling");
    el.style.transform = `translateY(${Math.min(dist, 120)}px)`;
    const ready = dist > THRESHOLD;
    el.classList.toggle("ready", ready);
    text.textContent = ready ? "Bırak, yenilensin" : "Yenilemek için çek";
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (startY !== null && dist > THRESHOLD) {
      text.textContent = "Yenileniyor…";
      hardReload();
    } else {
      reset();
    }
  });
  window.addEventListener("touchcancel", reset);
}
