-- Каталог расширений (метаданные берутся из манифестов при старте) и личные подключения пользователей.
create table extensions (
    id              text primary key,
    name            text not null,
    description     text not null,
    icon            text not null,
    default_enabled boolean not null
);

-- Нет записи — действует default_enabled расширения. Удаляется вместе с пользователем.
create table user_extensions (
    user_id      uuid not null references users (id) on delete cascade,
    extension_id text not null,
    enabled      boolean not null,
    updated_at   timestamptz not null default now(),
    primary key (user_id, extension_id)
);

-- Типы платформы не принадлежат расширению и видны всегда.
alter table types alter column extension_id drop not null;

-- Включено ли расширение для пользователя: платформа (нет расширения) и неописанные расширения включены всегда.
create function is_extension_enabled(p_user uuid, p_extension text) returns boolean
    language sql stable as $$
    select p_extension is null or coalesce(
        (select enabled from user_extensions where user_id = p_user and extension_id = p_extension),
        (select default_enabled from extensions where id = p_extension),
        true)
$$;
