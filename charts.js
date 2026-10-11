// Küçük SVG grafikler: tek seri sütun (haftalık kalori) ve çizgi (kilo). Dokunma/fare ile ipucu gösterir.
import { esc, fmt } from "./util.js";

const NS = "http://www.w3.org/2000/svg";

function niceMax(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
}

function setupTooltip(container) {
  let tip = container.querySelector(".tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    container.append(tip);
  }
  return {
    show(x, y, html) {
      tip.innerHTML = html;
      tip.classList.add("show");
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(x - w / 2, 0), container.clientWidth - w)}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() { tip.classList.remove("show"); },
  };
}

/** Sütun üstü yuvarlak, tabanı düz bir yol. */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param {HTMLElement} container
 * @param {{label: string, title: string, value: number, highlight?: boolean}[]} bars
 * @param {{goal?: number, unit: string}} opts
 */
export function barChart(container, bars, { goal = 0, unit }) {
  const W = container.clientWidth || 320, H = 170;
  const pad = { l: 34, r: 8, t: 18, b: 22 };
  const max = niceMax(Math.max(goal, ...bars.map((b) => b.value)) * 1.08);
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const band = plotW / bars.length;
  const bw = Math.min(24, band * 0.55);
  const y = (v) => pad.t + plotH - (v / max) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Son 7 günün kalorisi">`;
  for (const t of [0, max / 2, max]) {
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  }
  bars.forEach((b, i) => {
    const cx = pad.l + band * i + band / 2;
    const h = Math.max(0, y(0) - y(b.value));
    if (h > 0) svg += `<path class="bar-mark${b.highlight ? " hl" : ""}" d="${barPath(cx - bw / 2, y(b.value), bw, h, 4)}"/>`;
    svg += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    if (b.highlight && b.value > 0) svg += `<text class="val" x="${cx}" y="${y(b.value) - 5}" text-anchor="middle">${fmt(b.value)}</text>`;
  });
  if (goal) {
    svg += `<line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${y(goal)}" y2="${y(goal)}"/>`;
    svg += `<text class="ref-label" x="${pad.l + 4}" y="${y(goal) - 4}">Hedef ${fmt(goal)}</text>`;
  }
  svg += `<rect class="hit" x="${pad.l}" y="0" width="${plotW}" height="${H}" fill="transparent"/></svg>`;
  container.innerHTML = svg;

  const tip = setupTooltip(container);
  const hit = container.querySelector(".hit");
  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    const px = (e.touches?.[0] ?? e).clientX - rect.left;
    const i = Math.min(bars.length - 1, Math.max(0, Math.floor((px - pad.l) / band)));
    const b = bars[i];
    tip.show(pad.l + band * i + band / 2, y(b.value), `<b>${esc(b.title)}</b><br>${fmt(b.value)} ${unit}`);
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", tip.hide);
}

/**
 * @param {HTMLElement} container
 * @param {{date: string, value: number}[]} points tarihe göre sıralı
 * @param {{target?: number, unit: string}} opts
 */
export function lineChart(container, points, { target = 0, unit }) {
  if (points.length < 2) {
    container.innerHTML = `<p class="hint chart-empty">${points.length ? "Grafik için en az iki gün kilo gir." : "Henüz kilo kaydı yok."}</p>`;
    return;
  }
  const W = container.clientWidth || 320, H = 170;
  const pad = { l: 34, r: 48, t: 14, b: 22 };
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points.at(-1).date);
  const vals = points.map((p) => p.value).concat(target ? [target] : []);
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const x = (d) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(points.at(-1).date)},${y(lo)}L${x(points[0].date)},${y(lo)}Z`;
  const last = points.at(-1);
  const fmtD = (d) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  const fmtKg = (v) => v.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Kilo değişimi">`;
  for (const t of [lo, (lo + hi) / 2, hi]) {
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtKg(t)}</text>`;
  }
  svg += `<text class="axis" x="${pad.l}" y="${H - 6}">${fmtD(points[0].date)}</text>`;
  svg += `<text class="axis" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmtD(last.date)}</text>`;
  if (target) {
    svg += `<line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${y(target)}" y2="${y(target)}"/>`;
    svg += `<text class="ref-label" x="${W - pad.r + 4}" y="${y(target) + 4}">Hedef</text>`;
  }
  svg += `<path class="area-mark" d="${area}"/><path class="line-mark" d="${line}"/>`;
  svg += `<circle class="dot-mark" cx="${x(last.date)}" cy="${y(last.value)}" r="4"/>`;
  svg += `<text class="val" x="${x(last.date) + 8}" y="${y(last.value) + 4}">${fmtKg(last.value)}</text>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>`;
  svg += `<circle class="dot-mark hover" r="4" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/></svg>`;
  container.innerHTML = svg;

  const tip = setupTooltip(container);
  const cross = container.querySelector(".cross");
  const hdot = container.querySelector(".dot-mark.hover");
  const hit = container.querySelector(".hit");
  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    const px = (e.touches?.[0] ?? e).clientX - rect.left;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    const bx = x(best.date), by = y(best.value);
    cross.setAttribute("x1", bx); cross.setAttribute("x2", bx); cross.setAttribute("visibility", "visible");
    hdot.setAttribute("cx", bx); hdot.setAttribute("cy", by); hdot.setAttribute("visibility", "visible");
    tip.show(bx, by, `<b>${fmtD(best.date)}</b><br>${fmtKg(best.value)} ${unit}`);
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", () => { tip.hide(); cross.setAttribute("visibility", "hidden"); hdot.setAttribute("visibility", "hidden"); });
}
