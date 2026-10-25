create table types (
    id             text primary key,
    module_id      text not null,
    module_version integer not null,
    definition     jsonb not null,
    updated_at     timestamptz not null default now()
);

create index ix_types_module_id on types (module_id);
