-- Step 0: read-only inspection of one table of the private schema.
-- Usage (as postgres):
--   sudo -u postgres psql -d websig_local -v table=tabo_site_extent < 0_inspection.sql
\pset pager off
\if :{?table}
\else
  \echo 'Give the table name: -v table=...'
  \quit
\endif
SELECT set_config('websig.table', :'table', false) \gset
\echo '=== 1. Table, owner, primary key ==='
SELECT n.nspname AS schema, c.relname AS table, pg_get_userbyid(c.relowner) AS owner,
       (SELECT string_agg(a.attname || ' (' || format_type(a.atttypid, a.atttypmod) || ')', ', ')
          FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
         WHERE i.indrelid = c.oid AND i.indisprimary) AS primary_key
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'private' AND lower(c.relname) = lower(current_setting('websig.table')) AND c.relkind = 'r';
\echo '=== 2. Columns (those to rename are marked) ==='
SELECT a.attnum AS n, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull AS not_null,
       CASE WHEN a.attname <> trim(both '_' from regexp_replace(translate(lower(a.attname), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9_]+', '_', 'g'))
            THEN '-> ' || trim(both '_' from regexp_replace(translate(lower(a.attname), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9_]+', '_', 'g')) END AS rename_to
  FROM pg_attribute a
 WHERE a.attrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'private' AND lower(c.relname) = lower(current_setting('websig.table')) AND c.relkind = 'r')
   AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY a.attnum;
\echo '=== 3. Triggers on the table (audit_trigger_row / audit_trigger_stm if audited) ==='
SELECT t.tgname AS trigger, t.tgnargs AS nb_args
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'private' AND lower(c.relname) = lower(current_setting('websig.table')) AND NOT t.tgisinternal;
\echo '=== 4. Rows ==='
SELECT reltuples::bigint AS approx_rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'private' AND lower(c.relname) = lower(current_setting('websig.table'));
\echo '=== 5. Roles and memberships ==='
SELECT r.rolname AS role, r.rolcanlogin AS login,
       (SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) FROM pg_auth_members m
          JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of
  FROM pg_roles r
 WHERE r.rolname IN ('Seboon', 'seboon', 'websig_edition', 'sig_proprietaire', 'sig_contribution', 'sig_validation')
 ORDER BY 1;
\echo '=== 6. Existing tables in propositions ==='
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'propositions';
