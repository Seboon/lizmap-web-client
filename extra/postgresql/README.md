# PostgreSQL scripts of the fork

SQL scripts for editable layers stored in PostgreSQL, with **validation of
the changes**: contributors (in the WebSIG or in QGIS Desktop) write
proposals in a separate table, and a validator applies or refuses them; the
changes of the reference tables are recorded by an audit trigger.

They are not used by Lizmap Web Client itself: they set up the database
that the QGIS projects published with Lizmap use. Run them with `psql`.

## Requirements

* PostgreSQL (tested with 16) and PostGIS.
* The audit trigger `audit.sql` (Oslandia version, the one read by the
  History viewer plugin of QGIS), installed once in the database (never run
  again), then `audit_fix_majuscules.sql`.
* For the QGIS styles (script 3): `ogr2ogr` (GDAL), to copy the styles of a
  GeoPackage.
* `@lizmap_user` as default value of the author field needs the
  `lizmap_server` plugin of QGIS Server.

The names used are those of the example server: database `websig`
(`websig_local` in the examples of the `validation` scripts), schemas
`private` (reference tables) and `propositions` (proposals), roles
`sig_proprietaire` (owner of the data), `sig_lecture`, `sig_contribution`,
`sig_validation`, `sig_web` and the login roles `webgisadmin` (Lizmap tables)
and `websig_edition` (QGIS Server and the Lizmap edition tool). The data
model (columns, status values, messages) is in French.

## Files

| File | What it does |
|---|---|
| `roles_and_database.sql` | Complete example: roles, database, schemas, an example table `private.sites` with its proposals table, control triggers, validate / refuse functions, rights, audit. Change the passwords and the personal accounts first. |
| `audit_fix_majuscules.sql` | Fix of `audit.sql`: `replay_event` and `rollback_event` quote the table, schema and column names (names with capitals). Run once after `audit.sql`; safe to run again. |
| `validation/00_preparation_unique.sql` | Once per database, as `postgres`: rights of the data managers on the audit, table `public.layer_styles` (QGIS styles), schema `propositions` and its shared control functions. |
| `validation/0_inspection.sql` | Read-only: owner, primary key, columns and planned renamings, audit, roles of one table. |
| `validation/1_minuscules.sql` | Table and column names in lowercase (accents, spaces), audit history updated. Not needed when the import already used lowercase names. |
| `validation/2_propositions.sql` | Proposals table `propositions.<table>`, `modifie_par` / `modifie_le` columns, control triggers, `valider_<table>()` / `refuser_<table>()`, spatial indexes, rights, audit. Can be run again (e.g. after adding a column to both tables). |
| `validation/3_style.sql` | Default QGIS styles in `public.layer_styles` for the reference table and the proposals table (proposal fields, value lists, read-only fields, symbology by status), from the styles of a GeoPackage copied with `ogr2ogr`. |
| `validation/9_vider_private_propositions.sql` | **Drops all the tables** of the schemas `private` and `propositions`, their audit history and their QGIS styles: for a clean reinstall of a test database only. |
| `validation/10_manuel_tabo_site_extent.sql` | The same setup done by hand for one example table, to paste in the SQL window of the QGIS DB Manager. |

## Order

```bash
# once per database
sudo -u postgres psql -d websig -f roles_and_database.sql   # or your own roles and database
sudo -u postgres psql -v ON_ERROR_STOP=1 -d websig -f audit.sql
sudo -u postgres psql -d websig -f audit_fix_majuscules.sql
sudo -u postgres psql -d websig < validation/00_preparation_unique.sql

# for each table of the schema private (name in lowercase)
sudo -u postgres pg_dump -Fc -d websig -f /tmp/websig_before.dump
sudo -u postgres psql -d websig -v table=my_table < validation/0_inspection.sql
sudo -u postgres psql -d websig -v table=my_table < validation/1_minuscules.sql
sudo -u postgres psql -d websig -v table=my_table < validation/2_propositions.sql
# styles: copy those of the GeoPackage, then script 3
sudo -u postgres ogr2ogr -f PostgreSQL "PG:dbname=websig" my_layer.gpkg layer_styles \
    -nln style_import -lco SCHEMA=public -overwrite
sudo -u postgres psql -d websig -v table=my_table < validation/3_style.sql
```

Each `validation` script is one transaction: on error, nothing is changed.

Validate or refuse a proposal, as a member of `sig_validation`:

```sql
SELECT propositions.valider_my_table(1, 'Checked on the ground');
SELECT propositions.refuser_my_table(2, 'Duplicate');
```

Notes:

* Primary key: keep the `fid` of the GeoPackage when importing; script 2
  adds the automatic numbering it lacks and converts a `bigint` key to
  `integer` (recommended by Lizmap).
* For a correction, an empty field (NULL or empty text) keeps the current
  value.
* Reference table with Z: the proposals table gets the 2D type (what the
  WebSIG draws) and the validation adds Z = 0 when copying.
* Column added later: add it to both tables, then run script 2 again.
