/* Jugadores "activos": excluye a los vendidos o cedidos (marcados en gm_player_status.left_club).
   Si la tabla de estados todavía no existe, devuelve todos los jugadores. */
export async function activePlayers(sb, table = "gm_players") {
  const [p, st] = await Promise.all([sb.from(table).select("*"), sb.from("gm_player_status").select("player_id,left_club")]);
  if (p.error || st.error) return p;
  const hidden = new Set((st.data || []).filter((s) => s.left_club).map((s) => s.player_id));
  return { data: (p.data || []).filter((x) => !hidden.has(x.id)), error: null };
}
