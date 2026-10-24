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

## Flujo manual de fin de temporada (Etapa 1b)
Ejecuta `supabase/schema_temporadas.sql` una vez. Luego, al terminar cada temporada:
- **Temporada**: rellena PJ, minutos, goles, asistencias, imbatidas y nota de cada jugador (o pega desde Excel).
- **Clasificación**: pega o escribe la tabla final de la liga (los puntos se calculan si faltan).
- **Jugadores → Importar**: nombres, atributos y datos generales por CSV/JSON o pegando desde Excel.
Los totales de cada jugador = acumulado previo + temporadas anotadas (+ partidos si los registras; usa solo una vía por temporada).

## Economía (Etapa 2)
Ejecuta `supabase/schema_economia.sql`. Incluye presupuesto por temporada y áreas, gastos e ingresos, contratos y sueldos (editables) y reformas del estadio con precios orientativos.

## Pizarra táctica (Etapa 3)
Ejecuta `supabase/schema_pizarra.sql`. Incluye pizarra con formaciones, alineación rival, balón, pases, desmarques, zonas, uniones, Voronoi, superioridades, animación por fotogramas, guardado y jugadas a balón parado.

## Scouting (Etapa 4)
Ejecuta `supabase/schema_scouting.sql`. Carga tu base de jugadores (FC 27 y vida real) en Scouting → Importar (CSV, JSON o pegando desde Excel; modelo en `ejemplo_scouting.csv`). Incluye filtros avanzados, búsqueda por similitud, lista de seguimiento, gráficos scatter, radar y comparación con tu plantilla con percentiles.

## Scouting: base FC 27 completa (CSV de 60 columnas)
1. En Supabase → SQL Editor ejecuta `supabase/schema_scouting_fc27.sql` (solo añade columnas; se puede repetir).
2. Scouting → Importar → sube el CSV. Se detectan `player_id, common_name, first_name, last_name, overall_rating, position, alternate_positions, club, league, nationality, gender, preferred_foot, skill_moves, weak_foot, height_cm, weight_kg, birthdate, playstyles`, los 6 atributos principales, los 37 atributos detallados, `edition` y `snapshot_date`. La vista previa indica qué columnas se reconocieron, cuáles faltan y cuáles se ignoran.
3. Reimportar actualiza al jugador (mismo `player_id` y edición) sin perder la lista de seguimiento. La edad se calcula desde `birthdate` (respecto a `snapshot_date`).
4. Buscar: filtros nuevos por género, edición, fecha de datos, estilos de juego, filigranas, pie malo, altura, peso, posiciones alternativas y mín./máx. de cada atributo detallado; columnas extra elegibles en la tabla. Comparar: radar por grupo de atributos y filas de ficha. La similitud usa los atributos detallados cuando existen.
