-- PostgreSQL for Lizmap and editing: complete example script (tested on PostgreSQL 16).
-- Names used on the server: database websig, webgisadmin (Lizmap tables),
-- websig_edition (WebSIG: QGIS Server and Lizmap edition tool), sig_proprietaire.
-- Replace the passwords and the personal accounts (bob, alice) before running it.

-- 1. Roles (as postgres). All names in lowercase.
CREATE ROLE sig_proprietaire NOLOGIN;                        -- owner of the data
CREATE ROLE sig_lecture NOLOGIN;                             -- group: read
CREATE ROLE sig_contribution NOLOGIN IN ROLE sig_lecture;    -- group: propose changes
CREATE ROLE sig_validation NOLOGIN IN ROLE sig_lecture;      -- group: edit the reference, validate
CREATE ROLE sig_web NOLOGIN;                                 -- group: accounts of the web server
CREATE ROLE webgisadmin LOGIN PASSWORD 'MotDePasseLizmap';   -- Lizmap tables (accounts, rights)
CREATE ROLE websig_edition LOGIN PASSWORD 'MotDePasseWeb'
    IN ROLE sig_web, sig_contribution, sig_validation;       -- QGIS Server + Lizmap edition tool
-- one person = one account, in one group
CREATE ROLE bob LOGIN PASSWORD 'xxx' IN ROLE sig_validation;
GRANT sig_proprietaire TO bob;                               -- for SET ROLE sig_proprietaire
CREATE ROLE alice LOGIN PASSWORD 'yyy' IN ROLE sig_contribution;

-- 2. Database (as postgres): a single database, websig
CREATE DATABASE websig;

\c websig
-- 3. Database websig (as postgres, connected to websig)
CREATE EXTENSION postgis;
-- Lizmap creates its tables in public: it needs the right to create there
GRANT CREATE, USAGE ON SCHEMA public TO webgisadmin;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA private AUTHORIZATION sig_proprietaire;
CREATE SCHEMA propositions AUTHORIZATION sig_proprietaire;
REVOKE ALL ON DATABASE websig FROM PUBLIC;
GRANT CONNECT ON DATABASE websig TO webgisadmin, sig_lecture, sig_web;
GRANT USAGE ON SCHEMA private, propositions TO sig_lecture;

SET ROLE sig_proprietaire;
CREATE TABLE private.sites (
    id serial PRIMARY KEY,
    nom text NOT NULL,
    geom geometry(Point, 4326),
    modifie_par text,
    modifie_le timestamptz DEFAULT now()
);
CREATE TABLE propositions.sites (
    id_proposition serial PRIMARY KEY,
    operation text NOT NULL DEFAULT 'INSERT' CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    id_reference integer REFERENCES private.sites (id) ON DELETE SET NULL,
    nom text,
    geom geometry(Point, 4326),
    propose_par text,
    propose_le timestamptz NOT NULL DEFAULT now(),
    statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'validee', 'refusee')),
    valide_par text,
    valide_le timestamptz,
    commentaire text
);

-- Author and status, enforced by the database:
-- - author = the PostgreSQL account of the person; for the WebSIG (shared
--   account, group sig_web), the Lizmap login filled in by the form
--   (default value @lizmap_user);
-- - a proposal already validated or refused can no longer be changed;
-- - only the validation functions (run as sig_proprietaire) change the
--   status.
-- The messages shown to the users are in French, like the data model.
CREATE FUNCTION propositions.controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = 'sig_proprietaire' THEN
        RETURN NEW;   -- validate / refuse
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
CREATE TRIGGER controle BEFORE INSERT OR UPDATE ON propositions.sites
    FOR EACH ROW EXECUTE FUNCTION propositions.controle();

CREATE FUNCTION propositions.supprimer_controle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> 'sig_proprietaire' AND OLD.statut <> 'en_attente' THEN
        RAISE EXCEPTION 'Proposition % déjà traitée : elle ne peut plus être supprimée', OLD.id_proposition;
    END IF;
    RETURN OLD;
END $$;
CREATE TRIGGER supprimer_controle BEFORE DELETE ON propositions.sites
    FOR EACH ROW EXECUTE FUNCTION propositions.supprimer_controle();

-- Validate: applies the proposal to the reference, in one transaction.
CREATE FUNCTION propositions.valider_site(p_id integer, p_commentaire text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    p propositions.sites%ROWTYPE;
BEGIN
    SELECT * INTO p FROM propositions.sites
        WHERE id_proposition = p_id AND statut = 'en_attente' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposition % introuvable ou déjà traitée', p_id;
    END IF;
    IF p.operation = 'INSERT' THEN
        INSERT INTO private.sites (nom, geom, modifie_par) VALUES (p.nom, p.geom, p.propose_par);
    ELSIF p.operation = 'UPDATE' THEN
        UPDATE private.sites SET nom = p.nom, geom = p.geom, modifie_par = p.propose_par, modifie_le = now()
            WHERE id = p.id_reference;
    ELSE
        DELETE FROM private.sites WHERE id = p.id_reference;
    END IF;
    UPDATE propositions.sites
        SET statut = 'validee', valide_par = session_user, valide_le = now(),
            commentaire = coalesce(p_commentaire, commentaire)
        WHERE id_proposition = p_id;
END $$;

-- Refuse: the reference does not change.
CREATE FUNCTION propositions.refuser_site(p_id integer, p_commentaire text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    UPDATE propositions.sites
        SET statut = 'refusee', valide_par = session_user, valide_le = now(),
            commentaire = coalesce(p_commentaire, commentaire)
        WHERE id_proposition = p_id AND statut = 'en_attente';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposition % introuvable ou déjà traitée', p_id;
    END IF;
END $$;
RESET ROLE;

-- Rights
GRANT SELECT ON ALL TABLES IN SCHEMA private, propositions TO sig_lecture;
GRANT INSERT, UPDATE, DELETE ON propositions.sites TO sig_contribution;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA propositions TO sig_contribution;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA private TO sig_validation;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA private TO sig_validation;
REVOKE ALL ON FUNCTION propositions.valider_site(integer, text), propositions.refuser_site(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION propositions.valider_site(integer, text), propositions.refuser_site(integer, text) TO sig_validation;
-- Tables created later by sig_proprietaire: same rights automatically
ALTER DEFAULT PRIVILEGES FOR ROLE sig_proprietaire IN SCHEMA private, propositions GRANT SELECT ON TABLES TO sig_lecture;
ALTER DEFAULT PRIVILEGES FOR ROLE sig_proprietaire IN SCHEMA private GRANT INSERT, UPDATE, DELETE ON TABLES TO sig_validation;
ALTER DEFAULT PRIVILEGES FOR ROLE sig_proprietaire IN SCHEMA private GRANT USAGE ON SEQUENCES TO sig_validation;

-- ---------------------------------------------------------------
-- Audit, as postgres, AFTER: psql -v ON_ERROR_STOP=1 -d websig -f audit.sql
-- then: psql -d websig -f audit_fix_majuscules.sql
-- (audit.sql: once only, never run again)
-- ---------------------------------------------------------------
SELECT audit.audit_table('private.sites', true, true, '{modifie_le}'::text[]);
GRANT USAGE ON SCHEMA audit TO sig_validation;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO sig_validation;
