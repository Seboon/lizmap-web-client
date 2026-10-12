-- Empty the private and propositions schemas for a clean reinstall.
-- Drops ALL tables of both schemas (and the views that depend on them), the
-- functions of propositions, the audit history of both schemas and their QGIS
-- styles (public.layer_styles).
-- Schemas, roles, rights and default privileges are kept.
-- Usage (as postgres, AFTER a backup):
--   sudo -u postgres psql -d websig_local < 9_vider_private_propositions.sql
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'propositions' LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.f);
        RAISE NOTICE 'Fonction supprimée : %', r.f;
    END LOOP;
    FOR r IN SELECT schemaname, tablename FROM pg_tables
              WHERE schemaname IN ('propositions', 'private') ORDER BY schemaname DESC LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
        RAISE NOTICE 'Table supprimée : %.%', r.schemaname, r.tablename;
    END LOOP;
    IF to_regclass('audit.logged_actions') IS NOT NULL THEN
        DELETE FROM audit.logged_relations WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = relation_name);
        DELETE FROM audit.logged_actions WHERE schema_name IN ('private', 'propositions');
        RAISE NOTICE 'Historique de l''audit vidé pour private et propositions';
    END IF;
    IF to_regclass('public.layer_styles') IS NOT NULL THEN
        DELETE FROM public.layer_styles WHERE f_table_schema IN ('private', 'propositions');
        RAISE NOTICE 'Styles QGIS des couches de private et propositions supprimés';
    END IF;
    DROP TABLE IF EXISTS public.style_import;
END $$;
COMMIT;
\dt private.*
\dt propositions.*
\df propositions.*
SELECT count(*) AS evenements_restants FROM audit.logged_actions;
SELECT * FROM audit.logged_relations;
