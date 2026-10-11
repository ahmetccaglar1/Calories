// Sekmeler, seçili gün ve yeniden çizim. Görünümler render fonksiyonlarını buraya kaydeder.
import { dayKey } from "./store.js";

export const nav = { day: dayKey(), tab: "today" };
const renderers = new Set();

export const onRender = (fn) => renderers.add(fn);
export const rerender = () => renderers.forEach((fn) => fn());

export function showTab(tab) {
  nav.tab = tab;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${tab}`));
  document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  window.scrollTo(0, 0);
  rerender();
}

export function openDay(day) {
  nav.day = day;
  showTab("today");
}
