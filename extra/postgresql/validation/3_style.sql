-- Step 3: QGIS styles for a table and its proposals table.
-- Usage (as postgres, after step 2):
--   sudo -u postgres psql -d websig_local -v table=tabo_site_extent < 3_style.sql
--   ... -v style='Site_extent_style'   to choose a style by name (default: the default one)
--
-- Source of the style, in this order:
--   1. public.style_import: the layer_styles table of a GeoPackage, copied by ogr2ogr
--      (see LISEZMOI.md). The field names are fixed to the PostgreSQL ones
--      (Name -> name, fid -> the primary key) and the style becomes the default
--      style of private.<table> in public.layer_styles, under its GeoPackage name
--      (an older version with the same name is replaced). style_import is then dropped.
--   2. otherwise, the default style of private.<table> already in public.layer_styles
--      (saved from QGIS: Properties > Style > Save as default > Datasource database).
-- The reference also gets aliases, read-only flags and a "Suivi des modifications"
-- group for modifie_par / modifie_le.
-- Then the proposals table gets the same style, named "<style name> (propositions)", plus its own fields: a
-- "Proposition" group at the top of the form, aliases, value maps (operation,
-- statut), read-only fields, propose_par = @lizmap_user, and a symbology by
-- state: pending additions (green), corrections (orange), deletions (red, dashed),
-- validated (grey outline), refused (light grey, dotted).
-- QGIS loads these styles when the layer is added to a project.
\set ON_ERROR_STOP on
\if :{?table}
\else
  \echo 'Give the table name: -v table=...'
  \quit
\endif
\if :{?style}
\else
  \set style ''
\endif
SELECT set_config('websig.table', :'table', false) AS t, set_config('websig.style', :'style', false) AS s \gset
BEGIN;

-- Same structure as the table QGIS creates itself
CREATE TABLE IF NOT EXISTS public.layer_styles (
    id serial PRIMARY KEY,
    f_table_catalog varchar,
    f_table_schema varchar,
    f_table_name varchar,
    f_geometry_column varchar,
    stylename text,
    styleqml xml,
    stylesld xml,
    useasdefault boolean,
    description text,
    owner varchar(63) DEFAULT CURRENT_USER,
    ui xml,
    update_time timestamp DEFAULT CURRENT_TIMESTAMP,
    type varchar
);
GRANT SELECT ON public.layer_styles TO sig_lecture;
GRANT INSERT, UPDATE, DELETE ON public.layer_styles TO sig_validation;
DO $$
BEGIN
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO sig_validation',
                   pg_get_serial_sequence('public.layer_styles', 'id'));
END $$;

DO $$
DECLARE
    t text := current_setting('websig.table');
    wanted text := current_setting('websig.style');
    ref regclass;
    prop_tbl regclass;
    pk text;
    gcol text;
    gtype text;
    qml text;
    src text;
    sname text;
    col record;
    pos int;
    pos2 int;
    p_fields text;
    p_aliases text;
    p_defaults text;
    p_editable text;
    p_form text;
    p_renderer text;
    p_symbols text := '';
    r record;
    n int := 0;
BEGIN
    ref := to_regclass(format('private.%I', t));
    IF ref IS NULL THEN
        RAISE EXCEPTION 'Table private.% not found', t;
    END IF;
    prop_tbl := to_regclass(format('propositions.%I', t));
    SELECT a.attname INTO pk
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = ref AND i.indisprimary;
    SELECT a.attname, CASE WHEN a.atttypmod > 0 THEN postgis_typmod_type(a.atttypmod) END INTO gcol, gtype
      FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
     WHERE a.attrelid = ref AND ty.typname = 'geometry' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum LIMIT 1;
    -- QGIS stores the geometry family (Point, Line, Polygon) in "type"
    gtype := CASE WHEN gtype ~* 'point' THEN 'Point' WHEN gtype ~* 'line' THEN 'Line'
                  WHEN gtype ~* 'polygon' THEN 'Polygon' END;

    -- 1. Style of the reference
    IF to_regclass('public.style_import') IS NOT NULL THEN
        -- Prefer the styles of the GeoPackage layer with the same name as the table
        -- (a GeoPackage may hold several layers), then the default one
        SELECT styleqml, format('GeoPackage style "%s" of layer "%s"', stylename, f_table_name), stylename
          INTO qml, src, sname
          FROM public.style_import
         WHERE wanted = '' OR stylename = wanted
         ORDER BY (lower(f_table_name) = t) DESC, (stylename = wanted) DESC, useasdefault DESC,
                  update_time DESC NULLS LAST
         LIMIT 1;
        IF qml IS NULL THEN
            RAISE EXCEPTION 'Style "%" not found in public.style_import. Available: %', wanted,
                (SELECT string_agg(format('"%s"%s', stylename, CASE WHEN useasdefault THEN ' (default)' ELSE '' END), ', ')
                   FROM public.style_import);
        END IF;
        -- Field names: same name whatever the case (Name -> name), in attributes
        -- (name="Name", field="Name") and in expressions (&quot;Name&quot; or "Name")
        FOR col IN SELECT a.attname::text AS name FROM pg_attribute a
                    WHERE a.attrelid = ref AND a.attnum > 0 AND NOT a.attisdropped LOOP
            qml := regexp_replace(qml, '(")' || col.name || '(")', '\1' || col.name || '\2', 'gi');
            qml := regexp_replace(qml, '(&quot;)' || col.name || '(&quot;)', '\1' || col.name || '\2', 'gi');
        END LOOP;
        -- Fields of the style that do not exist in the table (style made for another layer?)
        FOR col IN SELECT DISTINCT m[1] AS name
                     FROM regexp_matches(substring(qml FROM '<fieldConfiguration>.*</fieldConfiguration>'),
                                         '<field name="([^"]+)"', 'g') AS m
                    WHERE m[1] NOT IN (SELECT attname FROM pg_attribute WHERE attrelid = ref AND attnum > 0 AND NOT attisdropped)
                      AND m[1] <> 'fid' LOOP
            RAISE WARNING 'Field "%" of the style does not exist in private.%: its settings are ignored', col.name, t;
        END LOOP;
        -- The GeoPackage key "fid" becomes the primary key of the table
        IF pk <> 'fid' AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ref AND attname = 'fid') THEN
            qml := regexp_replace(qml, '(")fid(")', '\1' || pk || '\2', 'g');
            qml := regexp_replace(qml, '(&quot;)fid(&quot;)', '\1' || pk || '\2', 'g');
        END IF;
        -- Tracking columns added by 2_propositions.sql: aliases, read-only
        qml := CASE WHEN qml ~ '</aliases>' THEN replace(qml, '</aliases>',
                    '<alias field="modifie_par" name="Modifié par"/><alias field="modifie_le" name="Modifié le"/> </aliases>')
                    ELSE qml END;
        qml := CASE WHEN qml ~ '</editable>' THEN replace(qml, '</editable>',
                    '<field name="modifie_par" editable="0"/><field name="modifie_le" editable="0"/> </editable>')
                    ELSE qml END;
        IF qml ~ '<editorlayout>tablayout</editorlayout>' AND qml ~ '</attributeEditorForm>' THEN
            qml := replace(qml, '</attributeEditorForm>',
                '<attributeEditorContainer name="Suivi des modifications" type="GroupBox" groupBox="1" columnCount="1" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="" collapsed="0" collapsedExpressionEnabled="0" collapsedExpression="" verticalStretch="0" horizontalStretch="0">'
                '<attributeEditorField name="modifie_par" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>'
                '<attributeEditorField name="modifie_le" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>'
                '</attributeEditorContainer></attributeEditorForm>');
        END IF;
        -- Same name as in the GeoPackage; an older version with this name is replaced
        DELETE FROM public.layer_styles
         WHERE f_table_catalog = current_database() AND f_table_schema = 'private' AND f_table_name = t
           AND stylename = sname;
        UPDATE public.layer_styles SET useasdefault = false
         WHERE f_table_catalog = current_database() AND f_table_schema = 'private' AND f_table_name = t;
        INSERT INTO public.layer_styles (f_table_catalog, f_table_schema, f_table_name, f_geometry_column,
                                         stylename, styleqml, useasdefault, description, type)
        VALUES (current_database(), 'private', t, gcol, sname, XMLPARSE(DOCUMENT qml), true,
                'Copied by 3_style.sql: ' || src, gtype);
        DROP TABLE public.style_import;
        RAISE NOTICE 'Style "%" of private.% saved as default (from the %)', sname, t, src;
    ELSE
        SELECT styleqml::text, format('style "%s" of private.%s', stylename, t), stylename INTO qml, src, sname
          FROM public.layer_styles
         WHERE f_table_catalog = current_database() AND f_table_schema = 'private' AND f_table_name = t
           AND (wanted = '' AND useasdefault OR stylename = wanted)
         ORDER BY update_time DESC LIMIT 1;
        IF qml IS NULL THEN
            RAISE EXCEPTION 'No style for private.%: copy the GeoPackage styles first (ogr2ogr, LISEZMOI.md) or save the style from QGIS (Style > Save as default > Datasource database)', t;
        END IF;
        RAISE NOTICE 'Using the %', src;
    END IF;

    -- 2. Style of the proposals table
    IF prop_tbl IS NULL THEN
        RAISE NOTICE 'No table propositions.%: run 2_propositions.sql first for its style', t;
        RETURN;
    END IF;

    p_fields := '
  <field name="operation" configurationFlags="NoFlag"><editWidget type="ValueMap"><config><Option type="Map"><Option type="List" name="map">
   <Option type="Map"><Option type="QString" name="Ajout" value="INSERT"/></Option>
   <Option type="Map"><Option type="QString" name="Correction" value="UPDATE"/></Option>
   <Option type="Map"><Option type="QString" name="Suppression" value="DELETE"/></Option>
  </Option></Option></config></editWidget></field>
  <field name="statut" configurationFlags="NoFlag"><editWidget type="ValueMap"><config><Option type="Map"><Option type="List" name="map">
   <Option type="Map"><Option type="QString" name="En attente" value="en_attente"/></Option>
   <Option type="Map"><Option type="QString" name="Validée" value="validee"/></Option>
   <Option type="Map"><Option type="QString" name="Refusée" value="refusee"/></Option>
  </Option></Option></config></editWidget></field>
  <field name="commentaire" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option type="Map">
   <Option type="bool" name="IsMultiline" value="true"/><Option type="bool" name="UseHtml" value="false"/>
  </Option></config></editWidget></field>
';
    p_aliases := '
  <alias field="id_proposition" name="N° de proposition"/>
  <alias field="operation" name="Opération"/>
  <alias field="id_reference" name="Objet concerné"/>
  <alias field="propose_par" name="Proposé par"/>
  <alias field="propose_le" name="Proposé le"/>
  <alias field="statut" name="Statut"/>
  <alias field="valide_par" name="Traité par"/>
  <alias field="valide_le" name="Traité le"/>
  <alias field="commentaire" name="Commentaire"/>
';
    p_defaults := '
  <default field="operation" expression="''INSERT''" applyOnUpdate="0"/>
  <default field="propose_par" expression="@lizmap_user" applyOnUpdate="0"/>
';
    p_editable := '
  <field name="id_proposition" editable="0"/>
  <field name="propose_par" editable="0"/>
  <field name="propose_le" editable="0"/>
  <field name="statut" editable="0"/>
  <field name="valide_par" editable="0"/>
  <field name="valide_le" editable="0"/>
';
    p_form := '
  <attributeEditorContainer name="Proposition" type="GroupBox" groupBox="1" columnCount="1" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="" collapsed="0" collapsedExpressionEnabled="0" collapsedExpression="" verticalStretch="0" horizontalStretch="0">
   <attributeEditorField name="id_proposition" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="operation" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="id_reference" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="commentaire" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="propose_par" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="propose_le" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="statut" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="valide_par" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
   <attributeEditorField name="valide_le" index="-1" showLabel="1" verticalStretch="0" horizontalStretch="0"/>
  </attributeEditorContainer>
';
    -- Symbology by state: rule-based renderer on statut and operation.
    -- Pending proposals stand out by operation, processed ones are discreet.
    FOR r IN SELECT * FROM (VALUES
        ('À valider : ajout',       '"statut" = ''en_attente'' AND "operation" = ''INSERT''', '51,160,44',  'solid', 'solid'),
        ('À valider : correction',  '"statut" = ''en_attente'' AND "operation" = ''UPDATE''', '255,127,0',  'solid', 'solid'),
        ('À valider : suppression', '"statut" = ''en_attente'' AND "operation" = ''DELETE''', '227,26,28',  'dash',  'solid'),
        ('Validée',                 '"statut" = ''validee''',                                 '120,120,120','solid', 'no'),
        ('Refusée',                 '"statut" = ''refusee''',                                 '190,190,190','dot',   'no')
    ) AS v(label, filter, rgb, line_style, fill_style)
    LOOP
        p_renderer := concat(p_renderer, format(
            '<rule key="{%s}" filter="%s" label="%s" symbol="%s"/>',
            gen_random_uuid(), replace(r.filter, '"', '&quot;'), r.label, n));
        p_symbols := p_symbols || CASE
            WHEN gtype = 'Point' THEN format(
                '<symbol type="marker" name="%s" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleMarker" enabled="1" locked="0" pass="0"><Option type="Map">'
                '<Option type="QString" name="name" value="circle"/><Option type="QString" name="size" value="3"/><Option type="QString" name="size_unit" value="MM"/>'
                '<Option type="QString" name="color" value="%s,%s"/><Option type="QString" name="outline_color" value="%s,255"/>'
                '<Option type="QString" name="outline_style" value="%s"/><Option type="QString" name="outline_width" value="0.5"/><Option type="QString" name="outline_width_unit" value="MM"/>'
                '</Option></layer></symbol>', n, r.rgb, CASE WHEN r.fill_style = 'no' THEN '0' ELSE '160' END, r.rgb, r.line_style)
            WHEN gtype = 'Line' THEN format(
                '<symbol type="line" name="%s" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleLine" enabled="1" locked="0" pass="0"><Option type="Map">'
                '<Option type="QString" name="line_color" value="%s,255"/><Option type="QString" name="line_style" value="%s"/>'
                '<Option type="QString" name="line_width" value="0.8"/><Option type="QString" name="line_width_unit" value="MM"/>'
                '</Option></layer></symbol>', n, r.rgb, r.line_style)
            ELSE format(
                '<symbol type="fill" name="%s" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleFill" enabled="1" locked="0" pass="0"><Option type="Map">'
                '<Option type="QString" name="color" value="%s,90"/><Option type="QString" name="style" value="%s"/>'
                '<Option type="QString" name="outline_color" value="%s,255"/><Option type="QString" name="outline_style" value="%s"/>'
                '<Option type="QString" name="outline_width" value="0.6"/><Option type="QString" name="outline_width_unit" value="MM"/>'
                '</Option></layer></symbol>', n, r.rgb, r.fill_style, r.rgb, r.line_style)
            END;
        n := n + 1;
    END LOOP;
    p_renderer := format(
        '<renderer-v2 type="RuleRenderer" forceraster="0" enableorderby="0" symbollevels="0" referencescale="-1">'
        '<rules key="{%s}">%s</rules><symbols>%s</symbols></renderer-v2>',
        gen_random_uuid(), p_renderer, p_symbols);
    IF qml ~ '<renderer-v2' THEN
        qml := regexp_replace(qml, '<renderer-v2.*</renderer-v2>', p_renderer);
    ELSE
        qml := replace(qml, '</qgis>', p_renderer || '</qgis>');
    END IF;

    -- The "Suivi des modifications" group of the reference has no field here: remove it
    pos := strpos(qml, '<attributeEditorContainer name="Suivi des modifications"');
    IF pos = 0 THEN
        pos := position('name="Suivi des modifications"' IN qml);
        IF pos > 0 THEN
            pos := length(substr(qml, 1, pos)) - strpos(reverse(substr(qml, 1, pos)), reverse('<attributeEditorContainer')) - length('<attributeEditorContainer') + 2;
        END IF;
    END IF;
    IF pos > 0 THEN
        pos2 := strpos(substr(qml, pos), '</attributeEditorContainer>');
        qml := substr(qml, 1, pos - 1) || substr(qml, pos + pos2 - 1 + length('</attributeEditorContainer>'));
    END IF;

    -- Add each block at the end of its section (or create the section if empty)
    qml := CASE WHEN qml ~ '</fieldConfiguration>' THEN replace(qml, '</fieldConfiguration>', p_fields || ' </fieldConfiguration>')
                ELSE regexp_replace(qml, '<fieldConfiguration/>', '<fieldConfiguration>' || p_fields || '</fieldConfiguration>') END;
    qml := CASE WHEN qml ~ '</aliases>' THEN replace(qml, '</aliases>', p_aliases || ' </aliases>')
                ELSE regexp_replace(qml, '<aliases/>', '<aliases>' || p_aliases || '</aliases>') END;
    qml := CASE WHEN qml ~ '</defaults>' THEN replace(qml, '</defaults>', p_defaults || ' </defaults>')
                ELSE regexp_replace(qml, '<defaults/>', '<defaults>' || p_defaults || '</defaults>') END;
    qml := CASE WHEN qml ~ '</editable>' THEN replace(qml, '</editable>', p_editable || ' </editable>')
                ELSE regexp_replace(qml, '<editable/>', '<editable>' || p_editable || '</editable>') END;
    -- Drag and drop form: the "Proposition" group goes first (after the form's own labelStyle)
    IF qml ~ '<editorlayout>tablayout</editorlayout>' THEN
        pos := strpos(qml, '<attributeEditorForm>');
        IF pos > 0 THEN
            pos := pos + length('<attributeEditorForm>');
            IF ltrim(substr(qml, pos), E' \n\r\t') LIKE '<labelStyle%' THEN
                pos2 := strpos(substr(qml, pos), '</labelStyle>');
                pos := pos + pos2 - 1 + length('</labelStyle>');
            END IF;
            qml := substr(qml, 1, pos - 1) || p_form || substr(qml, pos);
        ELSE
            qml := replace(qml, '<attributeEditorForm/>', '<attributeEditorForm>' || p_form || '</attributeEditorForm>');
        END IF;
    END IF;

    sname := coalesce(sname, t) || ' (propositions)';
    DELETE FROM public.layer_styles
     WHERE f_table_catalog = current_database() AND f_table_schema = 'propositions' AND f_table_name = t
       AND stylename = sname;
    UPDATE public.layer_styles SET useasdefault = false
     WHERE f_table_catalog = current_database() AND f_table_schema = 'propositions' AND f_table_name = t;
    INSERT INTO public.layer_styles (f_table_catalog, f_table_schema, f_table_name, f_geometry_column,
                                     stylename, styleqml, useasdefault, description, type)
    VALUES (current_database(), 'propositions', t, gcol, sname, XMLPARSE(DOCUMENT qml), true,
            'Copied by 3_style.sql from the ' || src || ', with the proposal fields', gtype);
    RAISE NOTICE 'Style "%" of propositions.% saved as default', sname, t;
END $$;

SELECT f_table_schema AS schema, f_table_name AS table, stylename, useasdefault, update_time
  FROM public.layer_styles
 WHERE f_table_name = current_setting('websig.table')
 ORDER BY 1, update_time DESC;
COMMIT;
