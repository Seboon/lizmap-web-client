# Changelog of the fork

Changes of this fork compared to the official Lizmap Web Client release it is
based on. The changes of the official releases are in `CHANGELOG-3.9.md`.

<!--
Format from https://keepachangelog.com/en/1.0.0/ (added, fixed, changed,
removed, security, backend, translations).
One section per release: "## <tag> - YYYY-MM-DD". The release workflow
(.github/workflows/fork-release.yml) copies the section of the pushed tag
into the GitHub release notes.
-->

## Unreleased

## 3.9.11-fork.2 - 2026-10-12

Second release of the fork, based on Lizmap Web Client 3.9.11.

### Added

* **Lizmap panels in dockable windows**: the left dock (layer tree, information...), the right dock, the bottom dock (attribute table), the layer information (sub-dock) and the mini-dock (drawing, selection, locate by layer, printing...) open in windows like the measure tools: moved by their title bar, resized by their edges, docked to the left, right or bottom edge of the map, maximized. They open at the usual place of each panel (left, right, bottom, top right) and keep the place given by the user until the page is reloaded (nothing saved in the browser). Not offered on small screens (mobile layout) nor in embedded maps.

* **Full screen from the logo**: a click on the logo of the map header (or Enter / Space when it has the focus) puts the page in full screen; a second click or Escape leaves it. Its tooltip tells which one it does. Labelled in the 24 languages.

* **Status bar at the bottom of the map**, like QGIS Desktop and QWC2: scale line; coordinates under the mouse in a CRS chosen in a list (CRS of the project, of the map and of the layers, WGS 84 in decimal degrees, DM and DMS, MGRS with its grid); the coordinates field is editable (Enter centers the map on the typed coordinates and marks the point); scale chosen in a list or typed (closest scale of the map); attributions of the layers. The dockable windows stay above the bar. On small screens and in embedded maps, only the attributions are shown and the overview keeps its scale and coordinates. Labelled in the 24 languages.

* **Download of the whole QGIS project, prepared in the background**: the zip holds the folder of the project (`.qgs`, `.cfg`, thumbnail, data, media, rasters), the files it uses outside the folder (in `external/`, the project pointing to them) and a README listing the layers not included (databases, web services) and the files not found. It is never built during a web request: when it is up to date it is sent at once, otherwise the request is queued and the command `project:zip:build`, run every minute by cron at low priority, builds it in the folder `project-zips` next to the root folder of the repositories (e.g. `/srv/webgis-projects/` gives `/srv/project-zips/`; shown in the administration, Lizmap configuration, Projects, with its state, the command to create it and the nginx configuration; not editable; without root folder, no folder and no download). The download buttons are shown only when this folder is ready; they show the state of the zip (waiting, progress of the preparation in %, size and date when ready), and the command shows a progress bar when run by hand and e-mails the user a download link valid 7 days (for that user only, logged in, right still granted). The administrator receives an e-mail for every request and every failure. A zip is rebuilt when a file of the project changes, and deleted when not downloaded for 15 days. The file is sent by nginx (`X-Accel-Redirect` to an internal location), by PHP on other web servers. Projects whose data sources hold a password are still refused. Labelled in the 24 languages.

* **Edition per project, user by user**: the rights page of a user (Administration → Rights → Users) has a new section "Edition per repository and project". For each repository, the right "Use the edition tool" of the user can be: no, all the projects (also the ones added later), or chosen projects. It is stored as a right of the private group of the user on the repository or on the resource "<repository>~<project>", checked at the four places where Lizmap checks the edition right (Project::canUseEditionTool()). The section also shows what the groups of the user already give, and warns when the right is given for all the repositories in the table above. It lists the editable layers the user will not be able to edit in these projects because of the groups allowed in the Lizmap plugin (unknown group identifiers are flagged). The groups allowed for each editable layer (Lizmap plugin) still apply. Deleting a repository deletes these rights. Labelled in the 24 languages.

* **PostgreSQL scripts** in `extra/postgresql/` for editable layers with validation of the changes: complete example of roles and database, fix of the audit trigger for names with capitals, and generic scripts to put a table under validation (proposals table, control triggers, validate / refuse functions, spatial indexes, rights, audit, QGIS styles with a symbology by status). See its README.

### Changed

* **Continuous scale**, like QGIS: the map can show any scale between the smallest and the largest scales of the project (typed scale in the status bar, box zoom, pinch, fit to a feature...). The scales of the project remain the steps of the +/- buttons and of the mouse wheel, and the list of the status bar.
* Elevation profile and measure windows: opened again during the same visit, they take back the place they had when closed (kept in memory only, like the mini-dock window; default place again after a page reload).

* Map: no Lizmap logo at the bottom right of the map any more; the attributions of the layers stay.

### Fixed

* Installer (PostgreSQL): when a Lizmap table must be altered but belongs to another database role ("must be owner of table jlx_user"), the installer now stops before any change, both for an installation from scratch on a database that already holds the Lizmap tables and for an upgrade (column "lang" of jlx_user), and gives the SQL that solves it.
* Overview: the extent of the map (box of the OpenLayers overview control) is drawn as a dark dashed outline with a light halo, without fill, like QWC2, instead of the blue box, and stays at least 8 px wide. With a fixed-scale overview, the overview now follows the map at every move (centered on it, the box in its middle) and keeps its scale. When the map shows more than the overview can hold, the overview zooms out so that the box stays visible, and comes back to its scale when the map zooms in. The old box styles and the overview_replacement images are removed.
* Home page: the "Download the QGIS project" button stays on the right of the other buttons of the project tile, instead of going below them on narrow tiles.

### Upgrade

* Project download: create the folder shown in Administration > Lizmap configuration > Projects, add the cron entry of the command `project:zip:build` (every minute) and the nginx location given on that page.

## 3.9.11-fork.1 - 2026-09-29

First release of the fork, based on Lizmap Web Client 3.9.11.

### Added

* **Measure menu** in the top bar, modelled on the QGIS Desktop toolbar, with the QGIS icons and OpenLayers 10 tools: length, area, angle and bearing (ellipsoidal by default, or in the map projection), labels on the map, pointer help, keyboard shortcuts, settings remembered in the browser. Shown only when the Measure option is enabled in the Lizmap plugin of QGIS.
* **Elevation profile** in the Measure menu: elevation layers of the project and online Copernicus GLO-30 source on one graph, graph and map hover sync, several lines, node editing. Requires the ElevationProfile QGIS Server plugin.
* Dockable windows for the measure tools and the profile: floating, docked on an edge of the map, resizable, maximized or in a separate browser window.
* **Settings menu** (gear icon) on every page: help submenu and dark theme.
* **Layer tree**: drag and drop of layers and groups, multi-selection (Ctrl / Shift), context menu with "Zoom to layer" and a layer comparison slider.
* **Editing access**: when a project has editable layers that the user cannot edit, an "Edition" entry lists them and lets a connected user request access from the administrators by e-mail (one request per user and project per 24 hours); visitors are sent to the login and registration pages. A message on the map tells about it at each opening of the project.
* **Edition button** in the top bar, with the QGIS "Toggle Editing" icon.
* **Download the QGIS project**: new right per repository (admins only by default), with buttons on the project tile and in the project information. Sends the project and its Lizmap configuration in a zip; refused when a data source of the project contains a password.
* **Registration**: e-mail validation before the administrator approval, new account statuses, language of the notification e-mails to the administrator (Administration > Configuration > E-mails), language of the user stored with the account for the e-mails sent to them.
* The language chosen by the user is kept in a cookie (langpersist plugin).

### Changed

* The OpenLayers 2 measure tool of the mini-dock is replaced by the Measure menu.
* The fork icons are separate SVG files in `lizmap/www/assets/icons/`.

### Fixed

* Selection tool, backported from the official development branch: displayed selected features with "selectable visible layers", message closed with the dock, `isExportable` and the `exportLayers` option of the JavaScript configuration API.
* Zoom to layer on rasters ("Cannot read properties of null").

### Backend

* Module versions: admin 3.9.11.1 and lizmap 3.9.11.2, so that the upgrade scripts of the fork run (new right, `lang` column of the users).
* Jelix 1.8.27 and jcommunity-module 1.4.7 pinned; the fork patches (`patches/vendor/`) are applied automatically after `composer install`.

### Translations

* New language ar_SD (Arabic, Sudan).
* Strings of the fork translated in the 24 languages; repaired jcommunity and jauthdb_admin locale files.
