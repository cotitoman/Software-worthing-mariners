import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Comprueba config.js y devuelve un texto explicando qué está mal (o null si todo bien).
function checkConfig() {
  const url = String(SUPABASE_URL ?? "").trim();
  const key = String(SUPABASE_ANON_KEY ?? "").trim();
  if (url.includes("TU-PROYECTO") || key.includes("TU-ANON-KEY")) {
    return "Todavía están los textos de ejemplo en js/config.js. Pega tu URL y tu anon key de Supabase.";
  }
  if (!/^https:\/\//i.test(url)) {
    return "La URL de Supabase debe empezar con https:// (por ejemplo https://abcdefgh.supabase.co).";
  }
  if (/supabase\.com|\/dashboard|\/rest\/|\/auth\/|\/project\//i.test(url)) {
    return "Esa no es la Project URL. Debe ser la de Project Settings → API, con forma https://xxxx.supabase.co (no la dirección del panel de Supabase).";
  }
  if (/\s/.test(url) || /[‘’“”]/.test(url + key)) {
    return "La URL o la key tienen espacios o comillas raras. Revisa que estén entre comillas normales (\").";
  }
  if (key.length < 20) {
    return "La anon key parece incompleta. Cópiala entera desde Project Settings → API.";
  }
  if (/service_role/i.test(key)) {
    return "Pegaste la service_role key. Usa la anon (public) key; la service_role nunca debe ir en la web.";
  }
  return null;
}

export const configProblem = checkConfig();
export const configured = configProblem === null;

let client = null;
if (configured) {
  try {
    client = createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim());
  } catch (e) {
    client = null;
  }
}
export const sb = client;
export const clientError = configured && !client ? "No se pudo crear la conexión con Supabase. Revisa la URL y la key de js/config.js." : null;

// Identificador único de este dispositivo/navegador. Se guarda localmente;
// si se borran los datos del navegador hará falta activar de nuevo.
function getDeviceId() {
  try {
    let id = localStorage.getItem("gm_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("gm_device_id", id);
    }
    return id;
  } catch (e) {
    return crypto.randomUUID(); // navegador que bloquea el almacenamiento local
  }
}
export const deviceId = getDeviceId();
