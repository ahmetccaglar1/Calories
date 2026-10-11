// Küçük ortak yardımcılar: DOM, biçimlendirme, görsel işleme.

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmt = (n) => Math.round(n || 0).toLocaleString("tr-TR");

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

export const loadingHtml = (text) => `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;

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
