-- «Номер» объекта: целое ≥ 1 вместо дробного порядка; считается внутри коллекции дочерних объектов узла.
alter table objects rename column sort_order to number;
alter table objects alter column number drop default;
alter table objects alter column number type integer using greatest(1, round(number)::integer);
alter table objects alter column number set default 1;
alter table objects add constraint ck_objects_number_positive check (number >= 1);
