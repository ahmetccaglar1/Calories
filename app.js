// Giriş noktası: verileri yükler, görünümleri ve akışları başlatır.
import { initStore, settings, dayKey, requestPersistence } from "./store.js";
import { nav, showTab, rerender } from "./nav.js";
import { initToday } from "./today.js";
import { initHistory } from "./history.js";
import { initSuggest } from "./suggest.js";
import { initProfile } from "./profile.js";
import { initMeal, mealBusy } from "./meal.js";
import { initBarcode } from "./barcode.js";
import { initOnboarding, startOnboarding } from "./onboarding.js";
import { initOffline } from "./offline.js";
import { initAutoUpdate, initPullToRefresh } from "./update.js";

await initStore();

// Her sheet'teki ✕ butonu kendi penceresini kapatır; arka plana dokununca da kapanır.
document.addEventListener("click", (e) => {
  const closer = e.target.closest("[data-close]");
  if (closer) closer.closest("dialog")?.close();
});
document.querySelectorAll("dialog.sheet").forEach((d) => {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
});

document.querySelectorAll(".tabbar [data-tab]").forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

initToday();
initHistory();
initSuggest();
initProfile();
initMeal();
initBarcode();
initOnboarding();
initOffline();
requestPersistence();

const anyDialogOpen = () => [...document.querySelectorAll("dialog")].some((d) => d.open);
const busy = () => mealBusy() || anyDialogOpen();
initAutoUpdate(busy);
initPullToRefresh(busy);

// Gece yarısı geçtiyse ve kullanıcı "bugün"e bakıyorsa yeni güne geç
let lastToday = dayKey();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = dayKey();
  if (today !== lastToday && nav.day === lastToday) nav.day = today;
  lastToday = today;
  rerender();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

rerender();
if (!settings.onboarded) startOnboarding();
