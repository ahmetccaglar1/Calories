// Küçük IndexedDB sarmalayıcısı. IndexedDB yoksa (bazı özel modlar) localStorage'a düşer.

const DB_NAME = "kalori";
const DB_VERSION = 2;
export const STORES = ["meals", "weights", "water", "favorites", "suggested", "pending"];

function idbBackend() {
  const dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (store, mode, fn) => {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    ready: dbp,
    getAll: (s) => run(s, "readonly", (st) => st.getAll()),
    put: (s, v) => run(s, "readwrite", (st) => st.put(v)),
    putMany: (s, list) => run(s, "readwrite", (st) => { for (const v of list) st.put(v); }),
    del: (s, id) => run(s, "readwrite", (st) => st.delete(id)),
    clear: (s) => run(s, "readwrite", (st) => st.clear()),
  };
}

function lsBackend() {
  const key = (s) => `kalori.db.${s}`;
  const read = (s) => { try { return JSON.parse(localStorage.getItem(key(s))) ?? []; } catch { return []; } };
  const write = (s, list) => localStorage.setItem(key(s), JSON.stringify(list));
  const upsert = (list, v) => { const i = list.findIndex((x) => x.id === v.id); i >= 0 ? (list[i] = v) : list.push(v); };
  return {
    ready: Promise.resolve(),
    getAll: async (s) => read(s),
    put: async (s, v) => { const l = read(s); upsert(l, v); write(s, l); },
    putMany: async (s, vs) => { const l = read(s); vs.forEach((v) => upsert(l, v)); write(s, l); },
    del: async (s, id) => write(s, read(s).filter((x) => x.id !== id)),
    clear: async (s) => write(s, []),
  };
}

export async function openDb() {
  if (!("indexedDB" in window)) return lsBackend();
  const b = idbBackend();
  try { await b.ready; return b; } catch { return lsBackend(); }
}
