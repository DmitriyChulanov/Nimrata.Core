create table objects (
    id         uuid primary key,
    type_id    text not null references types (id),
    parent_id  uuid references objects (id),
    owner_id   uuid not null references users (id),
    sort_order double precision not null default 0,
    properties jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index ix_objects_owner_id on objects (owner_id);
create index ix_objects_parent_id on objects (parent_id);
create index ix_objects_properties on objects using gin (properties);

-- Журнал: набор изменений и его записи «было/стало». Ссылок на objects нет: объект может быть удалён, а запись остаётся.
create table changesets (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id),
    created_at timestamptz not null default now()
);

create index ix_changesets_user_id on changesets (user_id, created_at);

create table changeset_entries (
    id           bigint generated always as identity primary key,
    changeset_id uuid not null references changesets (id),
    seq          integer not null,
    object_id    uuid not null,
    operation    text not null check (operation in ('create', 'update', 'move', 'delete')),
    property     text,
    old_value    jsonb,
    new_value    jsonb,
    snapshot     jsonb,
    unique (changeset_id, seq)
);

create index ix_changeset_entries_object_id on changeset_entries (object_id);

-- Журнал только дописывается: правка и удаление запрещены на уровне БД.
create function forbid_journal_change() returns trigger as $$
begin
    raise exception 'Журнал изменений неизменяем';
end;
$$ language plpgsql;

create trigger trg_changesets_immutable
    before update or delete on changesets
    for each row execute function forbid_journal_change();

create trigger trg_changeset_entries_immutable
    before update or delete on changeset_entries
    for each row execute function forbid_journal_change();
