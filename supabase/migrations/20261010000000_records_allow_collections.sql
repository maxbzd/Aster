-- Списки людей («Для раунда», «Для найма») синхронизируются как отдельная таблица приложения.
alter table public.records drop constraint records_tbl_known;
alter table public.records add constraint records_tbl_known
  check (tbl in ('people','interactions','reminders','circles','settings','intros','events','captures','leads','collections'));
