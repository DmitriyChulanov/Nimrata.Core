create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null,
    password_hash text not null,
    is_admin      boolean not null default false,
    is_active     boolean not null default true,
    created_at    timestamptz not null default now()
);

create unique index ux_users_email on users (lower(email));

create table refresh_tokens (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id) on delete cascade,
    token_hash text not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz
);

create index ix_refresh_tokens_user_id on refresh_tokens (user_id);
