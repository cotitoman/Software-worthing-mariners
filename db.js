import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured =
  !SUPABASE_URL.includes("TU-PROYECTO") && !SUPABASE_ANON_KEY.includes("TU-ANON-KEY");

export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Identificador único de este dispositivo/navegador. Se guarda localmente;
// si se borran los datos del navegador hará falta activar de nuevo.
function getDeviceId() {
  let id = localStorage.getItem("gm_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("gm_device_id", id);
  }
  return id;
}
export const deviceId = getDeviceId();
