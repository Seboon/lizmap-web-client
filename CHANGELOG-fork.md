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
