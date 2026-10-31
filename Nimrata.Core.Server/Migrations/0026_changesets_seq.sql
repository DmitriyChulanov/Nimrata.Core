-- Курсор синхронизации: монотонный номер набора. Наборы пользователя фиксируются под advisory-блокировкой,
-- поэтому внутри пользователя порядок seq совпадает с порядком фиксации. Идентификатор набора присылает клиент.
alter table changesets add column seq bigint generated always as identity;
create unique index ux_changesets_seq on changesets (seq);
create index ix_changesets_user_id_seq on changesets (user_id, seq);
