/* Almacenamiento del archivo de vídeo.
   · Local: IndexedDB del navegador (no se pierde al recargar; es propio de cada dispositivo).
   · Nube (opcional): Supabase Storage, bucket privado "gm-videos", máx. 50 MB en el plan gratuito. */

const DB = "wm_videos", STORE = "files";
export const CLOUD_LIMIT = 50 * 1024 * 1024;

function open() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("Este navegador no permite IndexedDB."));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("No se pudo abrir el almacenamiento local."));
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = () => { db.close(); rej(t.error || new Error("Error de almacenamiento local.")); };
    t.onabort = () => { db.close(); rej(t.error || new Error("No hay espacio suficiente o el navegador bloqueó el guardado.")); };
  });
}
export const putFile = (id, blob) => tx("readwrite", (s) => s.put(blob, id));
export const getFile = (id) => tx("readonly", (s) => s.get(id));
export const delFile = (id) => tx("readwrite", (s) => s.delete(id));

export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return null; }
}

export async function uploadCloud(sb, userId, projectId, file) {
  if (file.size > CLOUD_LIMIT) throw new Error("El archivo supera 50 MB, el límite de Supabase Storage en el plan gratuito.");
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${userId}/${projectId}/${safe}`;
  const { error } = await sb.storage.from("gm-videos").upload(path, file, { upsert: true, contentType: file.type || "video/mp4" });
  if (error) throw new Error(error.message);
  return path;
}
export async function downloadCloud(sb, path) {
  const { data, error } = await sb.storage.from("gm-videos").download(path);
  if (error) throw new Error(error.message);
  return data;
}
export async function deleteCloud(sb, path) {
  const { error } = await sb.storage.from("gm-videos").remove([path]);
  if (error) throw new Error(error.message);
}
export const fmtBytes = (n) => (n == null ? "–" : n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB");
