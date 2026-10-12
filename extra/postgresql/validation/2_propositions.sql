-- Step 2: proposals table, validation and audit for one table (guide 15.2, 15.3).
-- Usage (as postgres, after step 1; the table name in lowercase):
--   sudo -u postgres psql -d websig_local -v table=tabo_site_extent < 2_propositions.sql
-- Creates, for private.<table>:
--   - columns modifie_par / modifie_le on the reference table;
--   - propositions.<table>: the business columns (all columns except the primary
--     key, modifie_par and modifie_le) plus the proposal columns;
--   - the control triggers, propositions.valider_<table>() and refuser_<table>();
--   - the spatial indexes (both tables) and an index on id_reference;
--   - the rights, and the audit on the reference table if not active yet.
-- Can be run again: the proposals table is kept, the functions are recreated
-- (useful after adding a column to both tables).
\set ON_ERROR_STOP on
\if :{?table}
\else
  \echo 'Give the table name: -v table=...'
  \quit
\endif
SELECT set_config('websig.table', :'table', false) \gset
BEGIN;

-- 1. Schema
CREATE SCHEMA IF NOT EXISTS propositions AUTHORIZATION sig_proprietaire;
GRANT USAGE ON SCHEMA propositions TO sig_lecture;

-- 2. Control triggers, shared by every proposals table
CREATE OR REPLACE FUNCTION propositions.controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = 'sig_proprietaire' THEN
        RETURN NEW;   -- valider / refuser
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.statut <> 'en_attente' THEN
            RAISE EXCEPTION 'Proposition % déjà traitée : elle ne peut plus être modifiée', OLD.id_proposition;
        END IF;
        NEW.propose_par := OLD.propose_par;
        NEW.propose_le := OLD.propose_le;
    ELSIF NOT pg_has_role(session_user, 'sig_web', 'MEMBER') OR NEW.propose_par IS NULL THEN
        NEW.propose_par := session_user;
    END IF;
    NEW.statut := 'en_attente';
    NEW.valide_par := NULL;
    NEW.valide_le := NULL;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION propositions.supprimer_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> 'sig_proprietaire' AND OLD.statut <> 'en_attente' THEN
        RAISE EXCEPTION 'Proposition % déjà traitée : elle ne peut plus être supprimée', OLD.id_proposition;
    END IF;
    RETURN OLD;
END $$;
ALTER FUNCTION propositions.controle() OWNER TO sig_proprietaire;
ALTER FUNCTION propositions.supprimer_controle() OWNER TO sig_proprietaire;

-- 3. Everything specific to the table
DO $$
DECLARE
    t text := current_setting('websig.table');
    ref regclass;
    prop_tbl regclass;
    pk text;
    pk_type text;
    col record;
    col_list text;
    sel_list text;
    set_list text;
    fn_valider text;
    fn_refuser text;
    col_type text;
    expr text;
    skip text[];
BEGIN
    IF t !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'Table name "%" is not in lowercase: run step 1 first', t;
    END IF;
    ref := to_regclass(format('private.%I', t));
    IF ref IS NULL THEN
        RAISE EXCEPTION 'Table private.% not found', t;
    END IF;
    fn_valider := 'valider_' || t;
    fn_refuser := 'refuser_' || t;

    -- 3a. Reference table: owner and "last modified" columns
    EXECUTE format('ALTER TABLE %s OWNER TO sig_proprietaire', ref);
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS modifie_par text', ref);
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS modifie_le timestamp(0) DEFAULT localtimestamp(0)', ref);

    -- 3b. Primary key (one column)
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) INTO pk, pk_type
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = ref AND i.indisprimary;
    IF pk IS NULL THEN
        RAISE EXCEPTION 'private.% has no primary key: add one first', t;
    END IF;
    IF (SELECT count(*) FROM pg_index i, unnest(i.indkey) k WHERE i.indrelid = ref AND i.indisprimary) > 1 THEN
        RAISE EXCEPTION 'The primary key of private.% has several columns: not handled', t;
    END IF;

    -- 3b0. Key in bigint (the GeoPackage fid is a 64-bit integer): Lizmap recommends
    -- a plain integer key. Convert it when the values fit, here and in the proposals.
    IF pk_type = 'bigint' THEN
        EXECUTE format('SELECT coalesce(max(%I), 0) <= 2147483647 FROM %s', pk, ref) INTO STRICT expr;
        IF expr::boolean THEN
            EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE integer', ref, pk);
            IF to_regclass(format('propositions.%I', t)) IS NOT NULL THEN
                EXECUTE format('ALTER TABLE propositions.%I ALTER COLUMN id_reference TYPE integer', t);
            END IF;
            pk_type := 'integer';
            RAISE NOTICE 'Key %: bigint converted to integer (recommended by Lizmap)', pk;
        ELSE
            RAISE WARNING 'Key % is bigint with values above 2147483647: kept in bigint', pk;
        END IF;
    END IF;

    -- 3b bis. Key imported from a GeoPackage (fid) has no automatic numbering:
    -- add it, starting after the highest existing value
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = ref AND a.attname = pk AND (a.atthasdef OR a.attidentity <> '')) THEN
        EXECUTE format('ALTER TABLE %s ALTER COLUMN %I ADD GENERATED BY DEFAULT AS IDENTITY', ref, pk);
        EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, %L), greatest((SELECT max(%I) FROM %s), 1))',
                       ref::text, pk, pk, ref);
        RAISE NOTICE 'Key %: automatic numbering added (after the highest existing value)', pk;
    END IF;
    -- Columns that are not business data: the key, the tracking columns, and an old
    -- GeoPackage key "fid" kept as a plain column when another key was chosen at import
    skip := ARRAY[pk, 'modifie_par', 'modifie_le'];
    IF pk <> 'fid' AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ref AND attname = 'fid' AND NOT attisdropped) THEN
        skip := skip || 'fid'::text;
        RAISE NOTICE 'Column fid (GeoPackage key) is not the primary key: not copied to the proposals. It can be dropped: ALTER TABLE % DROP COLUMN fid;', ref;
    END IF;

    -- 3c. Proposals table (created once; kept if it already exists)
    IF to_regclass(format('propositions.%I', t)) IS NULL THEN
        EXECUTE format($q$
            CREATE TABLE propositions.%I (
                id_proposition serial PRIMARY KEY,
                operation text NOT NULL DEFAULT 'INSERT' CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
                id_reference %s REFERENCES %s (%I) ON DELETE SET NULL
            )$q$, t, pk_type, ref, pk);
        FOR col IN
            SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type,
                   ty.typname::text AS typname, a.atttypmod AS typmod
              FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
             WHERE a.attrelid = ref AND a.attnum > 0 AND NOT a.attisdropped
               AND a.attname <> ALL (skip)
             ORDER BY a.attnum
        LOOP
            col_type := col.type;
            -- Geometry with Z and/or M: the proposals get the 2D type, as drawn in
            -- the WebSIG (a 3D column refuses a 2D geometry before any trigger runs).
            -- Validation adds the missing dimensions when copying to the reference.
            IF col.typname = 'geometry' AND col.typmod > 0 AND postgis_typmod_dims(col.typmod) > 2 THEN
                col_type := format('geometry(%s,%s)',
                                   regexp_replace(postgis_typmod_type(col.typmod), '(ZM|Z|M)$', ''),
                                   postgis_typmod_srid(col.typmod));
                RAISE NOTICE 'Column %: % in the reference, % in the proposals', col.name, col.type, col_type;
            END IF;
            EXECUTE format('ALTER TABLE propositions.%I ADD COLUMN %I %s', t, col.name, col_type);
        END LOOP;
        EXECUTE format($q$
            ALTER TABLE propositions.%I
                ADD COLUMN propose_par text,
                ADD COLUMN propose_le timestamp(0) NOT NULL DEFAULT localtimestamp(0),
                ADD COLUMN statut text NOT NULL DEFAULT 'en_attente'
                    CHECK (statut IN ('en_attente', 'validee', 'refusee')),
                ADD COLUMN valide_par text,
                ADD COLUMN valide_le timestamp(0),
                ADD COLUMN commentaire text$q$, t);
        EXECUTE format('ALTER TABLE propositions.%I OWNER TO sig_proprietaire', t);
        EXECUTE format('CREATE INDEX ON propositions.%I (statut)', t);
        RAISE NOTICE 'Table propositions.% created', t;
    ELSE
        RAISE NOTICE 'Table propositions.% already exists: kept as is', t;
    END IF;
    prop_tbl := format('propositions.%I', t)::regclass;

    -- 3c bis. Indexes (both tables; only the missing ones, so it can be run again):
    -- spatial index (GiST) on every geometry/geography column, and an index on id_reference.
    FOR col IN
        SELECT a.attrelid::regclass AS tbl, a.attname::text AS name, a.attnum
          FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
         WHERE a.attrelid IN (ref, prop_tbl) AND a.attnum > 0 AND NOT a.attisdropped
           AND ty.typname IN ('geometry', 'geography')
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_index i
                         JOIN pg_class ic ON ic.oid = i.indexrelid
                         JOIN pg_am am ON am.oid = ic.relam
                        WHERE i.indrelid = col.tbl AND am.amname IN ('gist', 'spgist', 'brin')
                          AND col.attnum = ANY (i.indkey)) THEN
            EXECUTE format('CREATE INDEX ON %s USING gist (%I)', col.tbl, col.name);
            RAISE NOTICE 'Spatial index created on %.%', col.tbl, col.name;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid
                    WHERE i.indrelid = prop_tbl AND a.attname = 'id_reference'
                      AND i.indkey[0] = a.attnum) THEN
        EXECUTE format('CREATE INDEX ON %s (id_reference)', prop_tbl);
    END IF;

    -- 3c ter. Dates without time zone, to the second: the Lizmap form refuses values
    -- like 2026-10-07 16:01:07.675841+02 ("La saisie de ... est invalide").
    FOR col IN
        SELECT a.attrelid::regclass AS tbl, a.attname::text AS name
          FROM pg_attribute a
         WHERE ((a.attrelid = ref AND a.attname = 'modifie_le')
             OR (a.attrelid = prop_tbl AND a.attname IN ('propose_le', 'valide_le')))
           AND a.atttypid = 'timestamptz'::regtype AND NOT a.attisdropped
    LOOP
        EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE timestamp(0)', col.tbl, col.name);
        EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT localtimestamp(0)', col.tbl, col.name);
        IF col.name = 'valide_le' THEN
            EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP DEFAULT', col.tbl, col.name);
        END IF;
        RAISE NOTICE 'Column %.%: timestamptz converted to timestamp(0) (Lizmap form)', col.tbl, col.name;
    END LOOP;

    -- 3d. Business columns = columns present in both tables.
    -- For a correction, an empty field keeps the current value (NULL, or '' for text).
    col_list := NULL; sel_list := NULL; set_list := NULL;
    FOR col IN
        SELECT a.attname::text AS name, ty.typname::text AS typname, a.atttypmod AS typmod, a.atttypid AS typid
          FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
         WHERE a.attrelid = ref AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attname <> ALL (skip)
           AND EXISTS (SELECT 1 FROM pg_attribute b
                        WHERE b.attrelid = prop_tbl AND b.attname = a.attname AND NOT b.attisdropped)
         ORDER BY a.attnum
    LOOP
        expr := format('p.%I', col.name);
        -- Geometry: give it the dimensions of the reference column (Z = 0 / M = 0 if missing)
        IF col.typname = 'geometry' AND col.typmod > 0 THEN
            expr := CASE
                WHEN postgis_typmod_type(col.typmod) ~ 'ZM$' THEN format('ST_Force4D(%s)', expr)
                WHEN postgis_typmod_type(col.typmod) ~ 'Z$'  THEN format('ST_Force3DZ(%s)', expr)
                WHEN postgis_typmod_type(col.typmod) ~ 'M$'  THEN format('ST_Force3DM(%s)', expr)
                ELSE format('ST_Force2D(%s)', expr) END;
        ELSIF col.typid IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype) THEN
            expr := format('nullif(%s, %L)', expr, '');
        END IF;
        col_list := concat_ws(', ', col_list, format('%I', col.name));
        sel_list := concat_ws(', ', sel_list, expr);
        set_list := concat_ws(', ', set_list, format('%1$I = coalesce(%2$s, r.%1$I)', col.name, expr));
    END LOOP;
    IF col_list IS NULL THEN
        RAISE EXCEPTION 'No business column in common between the two tables';
    END IF;
    RAISE NOTICE 'Business columns: %', col_list;

    -- 3e. Validate: applies the proposal to the reference, in one transaction
    EXECUTE format($f$
        CREATE OR REPLACE FUNCTION propositions.%1$I(p_id integer, p_commentaire text DEFAULT NULL)
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $body$
        DECLARE
            prop %2$s%%ROWTYPE;
        BEGIN
            SELECT * INTO prop FROM %2$s
             WHERE id_proposition = p_id AND statut = 'en_attente' FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Proposition %% introuvable ou déjà traitée', p_id;
            END IF;
            IF prop.operation = 'INSERT' THEN
                INSERT INTO %3$s (%4$s, modifie_par)
                SELECT %5$s, p.propose_par FROM %2$s p WHERE p.id_proposition = p_id;
            ELSIF prop.id_reference IS NULL THEN
                RAISE EXCEPTION 'Proposition %% : objet de référence non indiqué (id_reference)', p_id;
            ELSIF prop.operation = 'UPDATE' THEN
                UPDATE %3$s r
                   SET %6$s, modifie_par = p.propose_par, modifie_le = localtimestamp(0)
                  FROM %2$s p
                 WHERE p.id_proposition = p_id AND r.%7$I = p.id_reference;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Proposition %% : l''objet %% n''existe plus', p_id, prop.id_reference;
                END IF;
            ELSE
                DELETE FROM %3$s WHERE %7$I = prop.id_reference;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Proposition %% : l''objet %% n''existe plus', p_id, prop.id_reference;
                END IF;
            END IF;
            UPDATE %2$s
               SET statut = 'validee', valide_par = session_user, valide_le = localtimestamp(0),
                   commentaire = coalesce(p_commentaire, commentaire)
             WHERE id_proposition = p_id;
        END $body$
    $f$, fn_valider, prop_tbl, ref, col_list, sel_list, set_list, pk);

    -- 3f. Refuse: the reference does not change
    EXECUTE format($f$
        CREATE OR REPLACE FUNCTION propositions.%1$I(p_id integer, p_commentaire text DEFAULT NULL)
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $body$
        BEGIN
            UPDATE %2$s
               SET statut = 'refusee', valide_par = session_user, valide_le = localtimestamp(0),
                   commentaire = coalesce(p_commentaire, commentaire)
             WHERE id_proposition = p_id AND statut = 'en_attente';
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Proposition %% introuvable ou déjà traitée', p_id;
            END IF;
        END $body$
    $f$, fn_refuser, prop_tbl);
    EXECUTE format('ALTER FUNCTION propositions.%I(integer, text) OWNER TO sig_proprietaire', fn_valider);
    EXECUTE format('ALTER FUNCTION propositions.%I(integer, text) OWNER TO sig_proprietaire', fn_refuser);

    -- 3g. Triggers
    EXECUTE format('DROP TRIGGER IF EXISTS controle ON %s', prop_tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS supprimer_controle ON %s', prop_tbl);
    EXECUTE format('CREATE TRIGGER controle BEFORE INSERT OR UPDATE ON %s
                    FOR EACH ROW EXECUTE FUNCTION propositions.controle()', prop_tbl);
    EXECUTE format('CREATE TRIGGER supprimer_controle BEFORE DELETE ON %s
                    FOR EACH ROW EXECUTE FUNCTION propositions.supprimer_controle()', prop_tbl);

    -- 3h. Rights
    EXECUTE format('GRANT SELECT ON %s, %s TO sig_lecture', ref, prop_tbl);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %s TO sig_validation', ref);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %s TO sig_contribution', prop_tbl);
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA private TO sig_validation;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA propositions TO sig_contribution;
    EXECUTE format('REVOKE ALL ON FUNCTION propositions.%I(integer, text), propositions.%I(integer, text) FROM PUBLIC',
                   fn_valider, fn_refuser);
    EXECUTE format('GRANT EXECUTE ON FUNCTION propositions.%I(integer, text), propositions.%I(integer, text) TO sig_validation',
                   fn_valider, fn_refuser);

    -- 3i. Audit on the reference table, if installed and not active yet
    IF to_regprocedure('audit.audit_table(regclass, boolean, boolean)') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ref AND tgname = 'audit_trigger_row') THEN
            DELETE FROM audit.logged_relations WHERE relation_name = ref;
            PERFORM audit.audit_table(ref, true, true);
            RAISE NOTICE 'Audit activated on %', ref;
        ELSE
            RAISE NOTICE 'Audit already active on %', ref;
        END IF;
    ELSE
        RAISE WARNING 'audit.sql is not installed: no history for %', ref;
    END IF;

    RAISE NOTICE 'Done. Validate: SELECT propositions.%(<id_proposition>, ''comment'');', fn_valider;
    RAISE NOTICE '      Refuse:   SELECT propositions.%(<id_proposition>, ''comment'');', fn_refuser;
END $$;

COMMIT;
