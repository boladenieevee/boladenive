-- =========================================================================
-- Snowball · migración: fotos de perfil en los comentarios
-- -------------------------------------------------------------------------
-- Pega TODO este archivo en Supabase → SQL Editor → Run.
-- Es idempotente: puedes ejecutarlo varias veces sin romper nada.
-- =========================================================================

-- 1. Guardar la foto de Google en el perfil -------------------------------
alter table public.profiles add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
    'URL de la foto de perfil (la de Google). Se usa en los comentarios.';


-- 2. Perfil automático: al registrarse guarda también la foto -------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    base      text;
    candidate text;
    suffix    integer := 0;
    photo     text;
begin
    base := coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        split_part(coalesce(new.email, ''), '@', 1),
        'usuario'
    );

    base := regexp_replace(base, '[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ ._-]', '', 'g');
    base := left(btrim(base), 20);
    if base is null or base = '' then
        base := 'usuario';
    end if;
    if char_length(base) < 3 then
        base := base || 'anon';
    end if;

    candidate := base;

    while exists (
        select 1 from public.profiles p where lower(p.username) = lower(candidate)
    ) loop
        suffix := suffix + 1;
        candidate := left(base, 15) || '_' || suffix::text;
        exit when suffix > 100;
    end loop;

    -- Google manda la foto como "avatar_url" o "picture"
    photo := nullif(coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'
    ), '');

    insert into public.profiles (id, username, avatar_url)
    values (new.id, candidate, photo)
    on conflict (id) do nothing;

    return new;
end;
$$;


-- 3. Rellenar los perfiles que ya existen ---------------------------------
update public.profiles p
set avatar_url = coalesce(
        u.raw_user_meta_data ->> 'avatar_url',
        u.raw_user_meta_data ->> 'picture'
    )
from auth.users u
where u.id = p.id
  and (p.avatar_url is null or p.avatar_url = '')
  and coalesce(
        u.raw_user_meta_data ->> 'avatar_url',
        u.raw_user_meta_data ->> 'picture'
      ) is not null;


-- 4. Comprobar (opcional) -------------------------------------------------
-- Debería devolver tus usuarios con su foto.
select id, username, avatar_url from public.profiles order by created_at desc limit 20;
