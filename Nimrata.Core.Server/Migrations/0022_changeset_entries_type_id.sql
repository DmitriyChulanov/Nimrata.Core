-- Тип объекта в записи журнала: по нему журнал скрывает записи отключённых расширений.
-- Без внешнего ключа: запись переживает объект, а неопределённый тип (NULL) показывается всегда.
alter table changeset_entries add column type_id text;

-- Бэкфилл меняет уже записанные строки: на время обновления отключается триггер неизменяемости журнала.
alter table changeset_entries disable trigger trg_changeset_entries_immutable;

-- Живые объекты: тип из objects.
update changeset_entries e
set type_id = o.type_id
from objects o
where o.id = e.object_id;

-- Удалённые объекты: тип из снимка или из записи create того же объекта; если его нигде нет, остаётся NULL.
update changeset_entries e
set type_id = (
    select coalesce(s.snapshot ->> 'type', case when s.operation = 'create' then s.new_value ->> 'type' end)
    from changeset_entries s
    where s.object_id = e.object_id
      and coalesce(s.snapshot ->> 'type', case when s.operation = 'create' then s.new_value ->> 'type' end) is not null
    order by s.id
    limit 1)
where e.type_id is null;

alter table changeset_entries enable trigger trg_changeset_entries_immutable;
