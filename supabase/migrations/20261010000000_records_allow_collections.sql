-- Lists of people ("For the round", "For hiring") are synced as a separate table of the app.
alter table public.records drop constraint records_tbl_known;
alter table public.records add constraint records_tbl_known
  check (tbl in ('people','interactions','reminders','circles','settings','intros','events','captures','leads','collections'));
