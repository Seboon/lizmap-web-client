# Roadmap of the fork

This page lists what is planned or still incomplete in this fork of
Lizmap Web Client 3.9.11. See the [README](README.md#about-this-fork) for what
the fork already adds. Items are grouped by theme; the order inside a theme
is not a priority order.

## Measure menu and elevation profile

- [ ] Elevation profile: show Zmin, Zmax and the length below the graph.
- [ ] Elevation profile: check the live refresh of the graph with a second
      elevation layer under the same line, and finish the translations.
- [ ] Publish the **ElevationProfile** QGIS Server plugin used by the profile
      (elevation layers of the project, Copernicus GLO-30 source with a
      persistent disk cache).
- [ ] Snapping in the measure tools and the profile (see *QGIS features*).

## QGIS features and icons

The guideline of the fork: bring QGIS Desktop tools and their native icons
(`lizmap/www/assets/icons/qgis/`) into the WebGIS, as done for the Measure
menu.

- [ ] Snapping tool like the QGIS snapping toolbar (vertices, segments,
      tolerance, layers) with tracing along features, based on the OpenLayers
      [Draw, modify, trace and snap](https://openlayers.org/en/latest/examples/draw-modify-trace-snap.html)
      example. Shared by the measure tools, the profile, drawing and editing
      (to be merged with the existing Lizmap snapping module of the editing
      tool).
- [ ] Editing: tools and icons of the QGIS digitizing toolbar (add feature,
      vertex tool, move, delete…).
- [ ] Edition button of the top bar: work like QGIS Desktop, on the layer
      selected in the layer tree; without an editable selected layer, keep
      the current behaviour (open the Edition panel).
- [ ] Layer tree: editing icon (QGIS pencil) next to the editable layers,
      dimmed when the user cannot edit them.
- [ ] Identify features: a QGIS-like "Identify" button that must be pressed
      before a click on the map opens popups (no automatic popup), and the
      same for tooltips.
- [ ] Zoom to coordinates.
- [ ] Drop Bootstrap in the long run: replace the `.caret` arrows, `.btn`
      buttons and drop-down menus by the fork's own styles and SVG icons
      (`lizmap/www/assets/icons/`, `.svg-icon` mask).

## Layer tree and layer comparison

- [ ] Drag and drop: the visibility checkbox of a moved layer still depends
      on its former group (checked/unchecked cascade not updated).
- [ ] Drag and drop with the "single WMS image" option: the stacking order
      of the combined request is not updated.
- [ ] Context menu: add a menu on groups and more entries (properties,
      export…).
- [ ] Theme menu: check or uncheck all the layers, with the QGIS icons.
- [ ] Add or remove a layer from the WebGIS (URL or local file), as in QWC2.
- [ ] Comparison slider: better interface and translations.

## Map interface

- [ ] Movable, dockable and resizable windows for all the panels (done for
      the measure tools and the profile with `DockWindow.js`).

## Settings menu

- [ ] "Help" entry: Lizmap documentation and help for the JavaScript tools
      (for example Escape closes the comparison slider).
- [ ] "Links" entry: useful web links.
- [ ] "Guided tour" entry: short tour of the WebGIS, see the
      [driver tutorial](https://github.com/3liz/lizmap-javascript-scripts/tree/master/library/ui/driver_tutorial)
      script.

## Dark theme and CSS

- [ ] Complete dark theme (colours of every panel).
- [ ] Move the rules of `var/lizmap-theme-config/theme.css` to the stylesheets
      of the matching assets.

## Users, rights, registration and language

- [ ] Language preference stored with the user account instead of a browser
      cookie, so that it follows the user on every device.
- [ ] Setting for the language of the account request e-mails.
- [ ] `importUser` of jcommunity: adapt it to the new account statuses of
      the registration workflow.
- [ ] Administration: button to clear the error logs.

## Editing, rights and data validation (PostgreSQL)

Editable layers are stored in PostgreSQL. Edits made from QGIS Desktop go
straight to the database, outside the Lizmap rights, so traceability and
validation have to live in PostgreSQL.

Editing access in the WebGIS:

- [ ] Answer to editing access requests: requests stored in the database and
      listed in the administration (user, project, layers, message, date,
      status), "Accept" (adds the user to the chosen editing group for the
      repository) and "Decline" (optional reason) buttons, e-mail to the user
      in their language.
- [ ] User page in the administration: "Remove the editing right" (per
      repository or everywhere) with an automatic e-mail to the user. As
      Lizmap rights are set per group and repository, this must remove the
      user from the editing groups, or deny the right on the repository for
      the user's private group.

**Download the QGIS project** — the current version only sends the `.qgs`
file and its `.qgs.cfg` (in a zip), and refuses projects whose data sources
contain a password.

- [ ] Download the complete project folder (`.qgs`, `.cfg`, thumbnail,
      `data/`, `media/`, rasters; without the other projects of the folder
      nor temporary files). A first attempt built the zip during the HTTP
      request and blocked the PHP workers, so it must run in the background:
  - [ ] Click on "Download" → rights checked → zip ready and up to date: sent
        at once; otherwise the request is queued and the user is told they
        will get an e-mail.
  - [ ] Queue: one request per project (duplicates merged).
  - [ ] Worker outside the web server: PHP command run by cron, one zip at a
        time (lock), low priority (`nice`, `ionice`), maximum total size
        (refused above it, with an e-mail to the administrator), zip written
        to a temporary file then moved to the cache.
  - [ ] Cache: fingerprint of the folder (files, sizes, modification dates)
        stored with the zip; zip rebuilt when the fingerprint changes; unused
        zips cleaned.
  - [ ] File sent by nginx (`X-Accel-Redirect`): PHP only checks the rights.
  - [ ] Interface: "Download (size, date)" when ready, "Being prepared…"
        otherwise; e-mail to the user when ready, to the administrator on
        failure.
  - [ ] Alternatives to compare: nightly preparation of the modified
        projects; zip streamed by the nginx `mod_zip` module.
- [ ] Package with a `pg_service.conf` without password and an installation
      guide.

Direct PostgreSQL access from QGIS Desktop:

- [ ] Individual (or per group) PostgreSQL roles limited to the relevant
      tables, instead of a single shared account.
- [ ] Secure exposure of PostgreSQL: mandatory SSL, restricted `pg_hba.conf`
      or VPN.
- [ ] Downloadable `pg_service.conf` (dedicated right) without credentials,
      which are entered in the QGIS authentication manager; installation
      guide per operating system (`PGSERVICEFILE`, default locations).
- [ ] Alternative to study: editing from QGIS Desktop through the Lizmap WFS
      (keeps the Lizmap rights), if the Lizmap proxy accepts WFS-T.

Traceability:

- [ ] Audit triggers on the editable tables (full history: date, author,
      old and new values), browsed and rolled back with the QGIS plugin
      "History viewer for a PostgreSQL base with audit triggers".
- [ ] Author field filled with `@lizmap_user` for edits made in the WebGIS;
      reliable authors from QGIS Desktop only with individual PostgreSQL
      roles.
- [ ] Author and date fields filled by Lizmap itself on every save, as the
      QWC data service does (`create_user_field`, `edit_timestamp_field`…).
- [ ] Check what the Lizmap logs record about saves and deletions.

Validation ("model B": proposals kept apart from the reference data):

- [ ] Contributors never write into the reference tables: their inserts,
      updates and deletions go to a proposals table (feature, operation,
      proposed values, author, date, status, reviewer, review date, comment).
- [ ] One layer per table in the projects: an updatable view (reference +
      pending proposals) with `INSTEAD OF` triggers writing the proposals;
      trusted users write to the reference directly.
- [ ] Validation function applying an accepted proposal to the reference in
      a transaction, under the audit trigger.
- [ ] Review interface: proposals layer in QGIS Desktop, then a "Changes to
      review" page in the Lizmap administration.
- [ ] Daily summary e-mail of the pending proposals.

## Offline editing with QField (without QFieldCloud)

WebGIS, QGIS Desktop and QField share one source of truth: PostgreSQL.

- [ ] Workflow through the QFieldSync plugin of QGIS Desktop: package the
      project for the field, copy it to the device, then synchronise the
      changes back into PostgreSQL.
- [ ] Author of field edits: a global variable per device in QField, used in
      the author field default value
      (`coalesce(@lizmap_user, @operator, @user_account_name)`).
- [ ] UUID primary keys on the editable tables (offline creations on several
      devices).
- [ ] Changes synchronised from QField also become proposals (model B).
- [ ] Conflicts (same feature edited offline and at the office) and photos
      (QField project folder vs Lizmap `media/`).

## Data, formats and 3D

- [ ] Support projects saved as `.qgz` (zip holding the `.qgs` and the
      auxiliary storage `.qgd`). QGIS Server already reads them; the blockers
      are in Lizmap:
  - [ ] Lizmap Web Client: list `.qgz` files in the repositories, read the
        project XML inside the zip (`zip://` stream, PHP zip extension),
        accept a `name.qgz.cfg` configuration, adapt the project cache,
        thumbnails, tiler and project download (`.qgs` is hard-coded there).
  - [ ] Lizmap QGIS Desktop plugin (3liz/lizmap-plugin): it refuses `.qgz`
        projects; needs a change there too, ideally proposed to 3liz first.
  - Trade-offs: smaller files and embedded auxiliary storage, but a binary
    project that can no longer be compared line by line in Git.
- [ ] Cloud Optimized GeoTIFF (COG) rasters.
- [ ] 3D module with CesiumJS: 3D Tiles and photogrammetry.

## Translations

- [ ] Check that every string added or changed by the fork exists in all the
      locales.
- [ ] Send the fork translations to Transifex (Lizmap locales project),
      request the `ar_SD` language there, and propose the jcommunity and
      jauthdb_admin fixes to the Jelix translation project.

## Code quality and upstream contributions

- [ ] Fix the JavaScript lint (`npm run pretest`) and run php-cs-fixer.
- [ ] Copyright and licence headers in the fork's files.
- [ ] Move the custom JavaScript assets into the existing asset groups.
- [ ] Propose the vendor patches (`patches/vendor/`) to Jelix and
      jcommunity-module, so the fork no longer depends on them.
- [ ] Contribute features to Lizmap from clean branches based on `master`
      (first candidate: the layer tree context menu).
- [ ] Rebase the fork on the next official releases (3.9.12…).

## Documentation

- [ ] User documentation of the fork's features (Measure menu, elevation
      profile, Settings menu, layer tree, comparison, language,
      registration, editing access, project download, nginx setup).
