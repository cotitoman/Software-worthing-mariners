# Worthing Mariners · Club Manager (Etapa 1: Plantilla)

Web estática para GitHub Pages con Supabase como base de datos.
Al abrirla pide una **clave de activación** por dispositivo; una vez activado, se puede crear cuenta o iniciar sesión.

## Qué incluye esta etapa
- Activación por dispositivo + cuentas (Supabase Auth)
- **Jugadores**: tabla ordenable y filtrable, perfil con estadísticas completas (PJ, minutos, goles, asistencias, porterías imbatidas, goles/partido, asistencias/partido, nota media) y radar de atributos
- **Partidos**: registro de cada partido con minutos, goles, asistencias y portería imbatida por jugador (las estadísticas se actualizan solas)
- **Minutos**: % de minutos por jugador según su rol (titular, rotación, suplente, juvenil) con alertas de sobrecarga o poco uso
- **Comparar**: hasta 3 jugadores con radar y tabla (el mejor valor se resalta)
- **Importar datos**: CSV/JSON y capturas de pantalla con OCR (con revisión antes de guardar)

Economía, Pizarra táctica y Scouting aparecen en el menú como "pronto" y se construyen en las siguientes etapas.

## Puesta en marcha
1. **Crea un proyecto nuevo en Supabase** (recomendado distinto al de la web del club: el trigger de registro de `schema.sql` aplica a todas las cuentas del proyecto).
2. En Supabase → **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
3. En Supabase → **Authentication → Providers → Email**, desactiva "Confirm email" si quieres entrar de inmediato tras crear la cuenta.
4. En Supabase → **Project Settings → API**, copia la *Project URL* y la *anon public key* y pégalas en `js/config.js`.
5. Sube la carpeta a un repositorio de GitHub y activa **Settings → Pages** (rama `main`, carpeta raíz).
6. Abre la web, escribe la clave **`MARINERS-2026`** (5 usos; cámbiala o crea otras en la tabla `gm_activation_keys`) y crea tu cuenta.

## Claves de activación
Se gestionan desde Supabase (Table Editor → `gm_activation_keys`): `max_uses` es el número de dispositivos que puede activar cada clave y `active` la desactiva. Si borras los datos del navegador, ese dispositivo pide activación otra vez y consume un uso más.

## Importar datos del FC 27
El modo carrera de FC 27 no ofrece una exportación oficial, así que esta etapa trae los datos por dos vías:
- **CSV/JSON**: usa `ejemplo_plantilla.csv` como modelo. Reconoce columnas en español e inglés.
- **Capturas con OCR**: sube capturas de la plantilla o de las estadísticas, elige qué significa cada columna, corrige lo mal leído y guarda.

Las estadísticas importadas se guardan como "acumulado previo". Si ya registras partidos en la app, impórtalas una sola vez (estado inicial) para no duplicarlas.

## Seguridad (importante)
- La clave de activación y el bloqueo de registro se validan en Supabase (funciones SQL y trigger), no solo en la página.
- Cada usuario solo ve y modifica sus propios datos (RLS).
- La `anon key` es pública por diseño; no pegues nunca la `service_role key` en la web.
