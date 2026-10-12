-- Step 1: table and column names in lowercase (guide 13.5).
-- Usage (as postgres, after a backup):
--   sudo -u postgres psql -d websig_local -v table=Tabo_Fence < 1_minuscules.sql
-- The name may be given in any case. One transaction: on error, nothing changes.
-- The audit history (table name, hstore keys, key column) is updated too.
\set ON_ERROR_STOP on
\if :{?table}
\else
  \echo 'Give the table name: -v table=...'
  \quit
\endif
SELECT set_config('websig.table', :'table', false) \gset
BEGIN;

DO $$
DECLARE
    old_table text;
    new_table text;
    col record;
    new_name text;
    has_audit boolean := to_regclass('audit.logged_actions') IS NOT NULL;
BEGIN
    SELECT c.relname INTO old_table
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND lower(c.relname) = lower(current_setting('websig.table'))
       AND c.relkind = 'r';
    IF old_table IS NULL THEN
        RAISE EXCEPTION 'Table private.% not found (whatever the case)', current_setting('websig.table');
    END IF;
    new_table := trim(both '_' from regexp_replace(translate(lower(old_table),
                 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9_]+', '_', 'g'));

    -- 1. Columns
    FOR col IN
        SELECT a.attname::text AS name
          FROM pg_attribute a
         WHERE a.attrelid = format('private.%I', old_table)::regclass
           AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum
    LOOP
        new_name := trim(both '_' from regexp_replace(translate(lower(col.name),
                    'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9_]+', '_', 'g'));
        CONTINUE WHEN new_name = col.name;
        IF EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = format('private.%I', old_table)::regclass
                      AND attname = new_name AND NOT attisdropped) THEN
            RAISE EXCEPTION 'Cannot rename column "%" to %: a column % already exists', col.name, new_name, new_name;
        END IF;
        EXECUTE format('ALTER TABLE private.%I RENAME COLUMN %I TO %I', old_table, col.name, new_name);
        RAISE NOTICE 'Column "%" renamed to %', col.name, new_name;
        IF has_audit THEN
            UPDATE audit.logged_actions
               SET row_data = CASE WHEN row_data ? col.name
                                   THEN (row_data - col.name) || hstore(new_name, row_data -> col.name)
                                   ELSE row_data END,
                   changed_fields = CASE WHEN changed_fields ? col.name
                                   THEN (changed_fields - col.name) || hstore(new_name, changed_fields -> col.name)
                                   ELSE changed_fields END
             WHERE schema_name = 'private' AND table_name = old_table
               AND (row_data ? col.name OR changed_fields ? col.name);
            UPDATE audit.logged_relations SET uid_column = new_name
             WHERE relation_name = format('private.%I', old_table)::regclass AND uid_column = col.name;
        END IF;
    END LOOP;

    -- 2. Table
    IF old_table <> new_table THEN
        EXECUTE format('ALTER TABLE private.%I RENAME TO %I', old_table, new_table);
        RAISE NOTICE 'Table "%" renamed to %', old_table, new_table;
        IF has_audit THEN
            UPDATE audit.logged_actions SET table_name = new_table
             WHERE schema_name = 'private' AND table_name = old_table;
        END IF;
    ELSE
        RAISE NOTICE 'Table name % already in lowercase', new_table;
    END IF;

    -- 3. Audit trigger with ignored columns: their names are stored in the trigger
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('private.%I', new_table)::regclass
                AND tgname = 'audit_trigger_row' AND tgnargs > 1) THEN
        RAISE WARNING 'The audit trigger lists ignored columns: run audit_table again with the new names (guide 15.3)';
    END IF;
END $$;

COMMIT;
