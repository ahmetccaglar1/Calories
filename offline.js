// Bugün sekmesindeki bildirim kartları: çevrimdışıyken kaydedilen (bekleyen) fotoğraflar ve yedek hatırlatması.
import { $, esc, toast } from "./util.js";
import { pendingSorted, removePending, backupDue, snoozeBackup, settings } from "./store.js";
import { onRender, rerender, nav } from "./nav.js";
import { openAnalysis, ensureKey } from "./meal.js";
import { backupNow } from "./backup.js";

function render() {
  const box = $("notices");
  const pending = pendingSorted();
  let html = "";
  if (pending.length) {
    html += `
      <div class="notice card">
        <div class="notice-thumbs">${pending.slice(0, 3).map((p) => p.thumb ? `<img src="${p.thumb}" alt="">` : `<span class="ph">🍽️</span>`).join("")}</div>
        <div class="notice-text"><b>${pending.length} öğün analiz bekliyor</b><small>${navigator.onLine ? "İnternet var, şimdi analiz edebilirsin." : "İnternet gelince analiz edebilirsin."}</small></div>
        <button type="button" class="btn small" id="pendingGo" ${navigator.onLine ? "" : "disabled"}>Analiz et</button>
      </div>`;
  }
  if (backupDue()) {
    const last = settings.lastBackup
      ? `Son yedek: ${new Date(settings.lastBackup + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}`
      : "Henüz hiç yedek almadın";
    html += `
      <div class="notice card">
        <span class="notice-icon">💾</span>
        <div class="notice-text"><b>Verilerini yedekle</b><small>${esc(last)}. Veriler sadece bu telefonda duruyor.</small></div>
        <div class="notice-actions">
          <button type="button" class="btn small" id="backupGo">Yedekle</button>
          <button type="button" class="btn ghost small" id="backupLater">Sonra</button>
        </div>
      </div>`;
  }
  box.innerHTML = html;
  $("pendingGo")?.addEventListener("click", openNextPending);
  $("backupGo")?.addEventListener("click", async () => { if (await backupNow()) rerender(); });
  $("backupLater")?.addEventListener("click", () => { snoozeBackup(); rerender(); });
}

/** Sıradaki bekleyen fotoğrafı analiz penceresinde açar. */
function openNextPending() {
  const p = pendingSorted()[0];
  if (!p || !ensureKey()) return;
  openAnalysis({
    imageB64: p.imageB64, thumb: p.thumb, preview: `data:image/jpeg;base64,${p.imageB64}`, note: p.note ?? "",
    pending: p,
  });
}

/** Analiz sonrası bekleyen kaydı kaldır ve sırada başka varsa haber ver. */
export function pendingDone(id) {
  removePending(id);
  const left = pendingSorted().length;
  if (left) setTimeout(() => toast(`${left} öğün daha analiz bekliyor`, { action: { label: "Sıradaki", onClick: openNextPending } }), 3600);
}

export function initOffline() {
  onRender(() => { if (nav.tab === "today") render(); });
  window.addEventListener("online", () => {
    rerender();
    if (pendingSorted().length) toast(`İnternet geldi. ${pendingSorted().length} öğün analiz bekliyor.`, { action: { label: "Analiz et", onClick: openNextPending } });
  });
  window.addEventListener("offline", rerender);
}
