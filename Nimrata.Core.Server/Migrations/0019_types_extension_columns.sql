alter table types rename column module_id to extension_id;
alter table types rename column module_version to extension_version;
alter index ix_types_module_id rename to ix_types_extension_id;
