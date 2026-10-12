// Yedekleme: verileri JSON dosyası olarak paylaş menüsüyle (Dosyalar / iCloud Drive) kaydetme ya da indirme.
import { toast } from "./util.js";
import { exportAll, dayKey, markBackedUp } from "./store.js";

/** Yedek dosyasını oluşturup kaydettirir. Başarılıysa true. */
export async function backupNow() {
  const name = `kalori-yedek-${dayKey()}.json`;
  const json = JSON.stringify(exportAll());
  const file = new File([json], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Kalori yedeği" });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  } catch (err) {
    if (err?.name !== "AbortError") toast("Yedek oluşturulamadı.");
    return false;
  }
  markBackedUp();
  toast("Yedek hazır ✓ Dosyalar'a veya iCloud Drive'a kaydettiğinden emin ol.", { duration: 5000 });
  return true;
}
