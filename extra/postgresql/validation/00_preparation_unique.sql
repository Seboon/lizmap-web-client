-- One-time preparation (server administrator, as postgres):
--   sudo -u postgres psql -d websig_local < 00_preparation_unique.sql
-- Data managers (import, create tables, set up validation): members of sig_proprietaire.
-- Validators: members of sig_validation. Give these roles separately, for example:
--   GRANT sig_proprietaire, sig_validation TO alice;
-- Audit: validators read the history (History viewer), data managers activate it
GRANT USAGE ON SCHEMA audit TO sig_validation, sig_proprietaire;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO sig_validation, sig_proprietaire;
GRANT INSERT, DELETE ON audit.logged_relations TO sig_proprietaire;
-- QGIS styles stored in the database (Style > Save > In database)
CREATE TABLE IF NOT EXISTS public.layer_styles (
    id serial PRIMARY KEY, f_table_catalog varchar, f_table_schema varchar, f_table_name varchar,
    f_geometry_column varchar, stylename text, styleqml xml, stylesld xml, useasdefault boolean,
    description text, owner varchar(63) DEFAULT CURRENT_USER, ui xml,
    update_time timestamp DEFAULT CURRENT_TIMESTAMP, type varchar);
GRANT SELECT ON public.layer_styles TO sig_lecture;
GRANT INSERT, UPDATE, DELETE ON public.layer_styles TO sig_proprietaire, sig_validation;
GRANT USAGE ON SEQUENCE public.layer_styles_id_seq TO sig_proprietaire, sig_validation;
-- Proposals schema and its two control functions (shared by all tables)
CREATE SCHEMA IF NOT EXISTS propositions AUTHORIZATION sig_proprietaire;
GRANT USAGE ON SCHEMA propositions TO sig_lecture;
SET ROLE sig_proprietaire;
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
RESET ROLE;
