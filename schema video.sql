-- =====================================================================
-- Worthing Mariners · Club Manager — Módulo: VISOR Y EDITOR TÁCTICO DE VÍDEO
-- Ejecútalo después de schema.sql. Se puede ejecutar varias veces.
--
-- Dónde se guarda cada cosa:
--   · Proyectos, anotaciones, jugadas destacadas y escenas → tablas de Supabase (se conservan entre dispositivos).
--   · El archivo de vídeo → en el navegador de cada dispositivo (IndexedDB), y opcionalmente en
--     Supabase Storage (bucket privado "gm-videos") si pesa 50 MB o menos (límite del plan gratuito).
-- =====================================================================

create table if not exists gm_video_projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null,
  notes         text,                         -- observaciones del analista
  link_type     text check (link_type in ('partido','entrenamiento','jugador')),
  link_id       uuid,
  file_name     text,
  file_size     bigint,
  file_modified bigint,
  duration      numeric,
  fps           int not null default 25 check (fps between 10 and 120),
  cloud_path    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists gm_video_annotations (
  id         uuid primary key,               -- lo genera la aplicación
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references gm_video_projects(id) on delete cascade,
  type       text not null,
  data       jsonb not null default '{}'::jsonb,   -- geometría normalizada (0..1) respecto al vídeo
  color      text not null default '#f5b041',
  width      numeric not null default 4,
  t_start    numeric not null default 0,
  t_end      numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists gm_video_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references gm_video_projects(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists gm_video_moments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references gm_video_projects(id) on delete cascade,
  t          numeric not null,
  t_end      numeric,                          -- si existe, es un clip [t, t_end]
  kind       text not null default 'otro'
             check (kind in ('gol','ocasion','error_defensivo','presion','transicion','balon_parado','otro')),
  comment    text,
  list_id    uuid references gm_video_lists(id) on delete set null,
  player_id  uuid references gm_players(id) on delete set null,
  thumb      text,                             -- captura anotada (JPEG reducido)
  created_at timestamptz not null default now()
);

-- Escenas tácticas: grupos de anotaciones reutilizables (tiempos relativos)
create table if not exists gm_video_scenes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  items      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table gm_video_projects    enable row level security;
alter table gm_video_annotations enable row level security;
alter table gm_video_lists       enable row level security;
alter table gm_video_moments     enable row level security;
alter table gm_video_scenes      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['gm_video_projects','gm_video_annotations','gm_video_lists','gm_video_moments','gm_video_scenes'] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

create index if not exists gm_video_ann_project_idx on gm_video_annotations (project_id);
create index if not exists gm_video_mom_project_idx on gm_video_moments (project_id);

-- Almacenamiento opcional de vídeos en la nube (privado, por usuario)
insert into storage.buckets (id, name, public, file_size_limit)
values ('gm-videos', 'gm-videos', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

drop policy if exists "gm videos select" on storage.objects;
drop policy if exists "gm videos insert" on storage.objects;
drop policy if exists "gm videos update" on storage.objects;
drop policy if exists "gm videos delete" on storage.objects;
create policy "gm videos select" on storage.objects for select to authenticated
  using (bucket_id = 'gm-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gm videos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'gm-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gm videos update" on storage.objects for update to authenticated
  using (bucket_id = 'gm-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gm videos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'gm-videos' and (storage.foldername(name))[1] = auth.uid()::text);
