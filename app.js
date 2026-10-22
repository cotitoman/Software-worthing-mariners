import { sb, configured, configProblem, clientError, deviceId } from "./db.js";
import { $, esc, toast } from "./util.js";
import { mountSquad } from "./squad.js";
import { mountFinance } from "./finance.js";
import { mountBoard } from "./board.js";
import { mountScouting } from "./scouting.js";
import { mountTraining } from "./training.js";
import { mountPlanning } from "./planning.js";

const root = document.getElementById("app");

async function boot() {
  if (!configured || !sb) {
    root.innerHTML = `<div class="gate"><div class="gate-card">
      <h1><span class="crest">WM</span> Falta configurar</h1>
      <p class="err">${esc(configProblem || clientError || "Configuración inválida.")}</p>
      <p class="muted">Abre <code>js/config.js</code> y pega la <b>Project URL</b> y la <b>anon key</b> de tu proyecto de Supabase
      (Project Settings → API). Luego ejecuta <code>supabase/schema.sql</code> en el SQL Editor.</p></div></div>`;
    return;
  }
  const { data: active, error } = await sb.rpc("gm_is_device_active", { p_device: deviceId });
  if (error) {
    const net = /fetch|network|failed|load/i.test(error.message);
    return fatal(net
      ? "No se pudo conectar con Supabase. La URL de js/config.js probablemente está mal escrita o el proyecto está pausado. (" + error.message + ")"
      : error.message);
  }
  if (!active) return showActivation();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAuth();
  showApp(session.user);
}

function fatal(msg) {
  root.innerHTML = `<div class="gate"><div class="gate-card"><h1>Error de conexión</h1>
    <p class="err">${esc(msg)}</p>
    <p class="muted">Revisa config.js y que hayas ejecutado schema.sql.</p></div></div>`;
}

/* ---------- 1) Clave de activación ---------- */
function showActivation() {
  root.innerHTML = `<div class="gate"><form class="gate-card" id="f">
    <h1><span class="crest">WM</span> Worthing Mariners</h1>
    <p class="muted">Introduce la clave de activación para usar el Club Manager en este dispositivo.</p>
    <label>Clave de activación</label>
    <input id="key" autocomplete="off" autofocus placeholder="XXXX-XXXX">
    <p class="err" id="err"></p>
    <button class="btn" style="width:100%;margin-top:.5rem">Activar dispositivo</button>
  </form></div>`;
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = $("#key").value.trim();
    if (!key) return;
    const { data, error } = await sb.rpc("gm_activate_device", { p_key: key, p_device: deviceId });
    if (error) return ($("#err").textContent = error.message);
    if (!data) return ($("#err").textContent = "Clave inválida o sin usos disponibles.");
    boot();
  });
}

/* ---------- 2) Crear cuenta / iniciar sesión ---------- */
function showAuth(mode = "login") {
  const reg = mode === "register";
  root.innerHTML = `<div class="gate"><form class="gate-card" id="f">
    <h1><span class="crest">WM</span> Club Manager</h1>
    <div class="tabs2">
      <button type="button" class="btn ${reg ? "ghost" : ""}" data-m="login">Iniciar sesión</button>
      <button type="button" class="btn ${reg ? "" : "ghost"}" data-m="register">Crear cuenta</button>
    </div>
    <label>Correo</label><input id="email" type="email" required autocomplete="email">
    <label>Contraseña</label><input id="pw" type="password" required minlength="6"
      autocomplete="${reg ? "new-password" : "current-password"}">
    <p class="err" id="err"></p>
    <button class="btn" style="width:100%;margin-top:.5rem">${reg ? "Crear cuenta" : "Entrar"}</button>
  </form></div>`;
  root.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => showAuth(b.dataset.m)));
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim(), password = $("#pw").value;
    const err = $("#err");
    err.textContent = "";
    if (reg) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { device_id: deviceId } } });
      if (error) {
        err.textContent = /database error/i.test(error.message)
          ? "No se pudo crear la cuenta: este dispositivo no está activado."
          : error.message;
        return;
      }
      if (data.session) return showApp(data.user);
      err.textContent = "Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.";
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return (err.textContent = "Correo o contraseña incorrectos.");
      showApp(data.user);
    }
  });
}

/* ---------- 3) Aplicación ---------- */
function showApp(user) {
  root.innerHTML = `
    <header class="top">
      <div class="brand"><span class="crest">WM</span> Worthing Mariners · Club Manager</div>
      <nav class="main">
        <button data-sec="plantilla" class="on">Plantilla</button>
        <button data-sec="economia">Economía</button>
        <button data-sec="pizarra">Pizarra táctica</button>
        <button data-sec="scouting">Scouting</button>
        <button data-sec="entrenamientos">Entrenamientos</button>
        <button data-sec="planificacion">Planificación</button>
      </nav>
      <span class="muted">${esc(user.email)}</span>
      <button class="btn ghost sm" id="out">Cerrar sesión</button>
    </header>
    <main id="view"></main>`;
  $("#out").addEventListener("click", async () => {
    await sb.auth.signOut();
    showAuth();
  });
  const go = (sec) => {
    root.querySelectorAll("[data-sec]").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
    const view = $("#view");
    view.innerHTML = "";
    if (sec === "pizarra") return mountPizarra(view, { sb, user });
    if (sec === "scouting") return mountScouting(view, { sb, user });
    if (sec === "entrenamientos") return mountTraining(view, { sb, user });
    if (sec === "planificacion") return mountPlanning(view, { sb, user });
    (sec === "economia" ? mountFinance : mountSquad)(view, { sb, user });
  };
  root.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => go(b.dataset.sec)));
  go("plantilla");
}

function mountPizarra(view, ctx, kind = "tactica") {
  view.innerHTML = `<div class="subtabs"><button data-k="tactica" class="${kind === "tactica" ? "on" : ""}">Pizarra táctica</button>
    <button data-k="pelota_parada" class="${kind === "pelota_parada" ? "on" : ""}">Jugadas a balón parado</button></div><div id="bd"></div>`;
  view.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => mountPizarra(view, ctx, b.dataset.k)));
  mountBoard($("#bd", view), { ...ctx, kind });
}

sb?.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") showAuth(); });

boot().catch((e) => { console.error(e); fatal(e.message || String(e)); });
