// Küçük ortak yardımcılar: DOM, biçimlendirme, bildirim, kaydırma hareketi, görsel işleme.

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmt = (n) => Math.round(n || 0).toLocaleString("tr-TR");
/** "85,9" veya "85.9" → 85.9; geçersizse 0. */
export const parseNum = (v) => Number(String(v ?? "").trim().replace(",", ".")) || 0;
export const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("tr-TR");

/** Destekleyen cihazlarda kısa titreşim. */
export const haptic = (ms = 10) => navigator.vibrate?.(ms);

/** Bir kapsayıcıya buton listesi yerleştirir: [{label, onClick, cls}] */
export function setButtons(container, btns) {
  container.innerHTML = "";
  for (const b of btns) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `btn ${b.cls ?? ""}`;
    el.textContent = b.label;
    el.onclick = b.onClick;
    container.append(el);
  }
}

export const loadingHtml = (text) => `
  <div class="loading"><div class="spinner"></div>${esc(text)}</div>
  <div class="skeleton"><i></i><i></i><i class="short"></i></div>`;

let toastTimer = null;
/** Alt kısımda kısa bildirim; isteğe bağlı eylem butonu (örn. Geri al). */
export function toast(text, { action, duration = 3500 } = {}) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove("show"); action.onClick(); };
    el.append(b);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

/**
 * Satırı sola kaydırınca silme. row içinde `.swipe-content` kayar, arkasındaki kırmızı alan görünür.
 * Kısa dokunuşta onTap çağrılır.
 */
export function enableSwipe(row, { onDelete, onTap }) {
  const content = row.querySelector(".swipe-content");
  let x0 = null, y0 = null, dx = 0, horizontal = null;
  const reset = () => { content.style.transition = "transform .2s"; content.style.transform = ""; };

  row.addEventListener("touchstart", (e) => {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horizontal = null;
    content.style.transition = "none";
  }, { passive: true });
  row.addEventListener("touchmove", (e) => {
    if (x0 === null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my);
    if (!horizontal) return;
    dx = Math.min(0, mx);
    content.style.transform = `translateX(${Math.max(dx, -140)}px)`;
  }, { passive: true });
  row.addEventListener("touchend", () => {
    if (horizontal && dx < -90) {
      content.style.transition = "transform .2s";
      content.style.transform = "translateX(-110%)";
      haptic(15);
      setTimeout(onDelete, 180);
    } else reset();
    x0 = null;
  });
  row.addEventListener("click", () => { if (!horizontal) onTap(); });
}

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function resize(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export function squareThumb(img, size) {
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}
