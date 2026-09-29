{* Edition button of the map page top bar (included by map_headermenu.tpl,
   next to the measure menu), with the native QGIS "Toggle Editing" icon.
   The <lizmap-edition-button> component (assets/src/components/EditionButton.js)
   opens the Edition entry of the map: the edition tool, or the request
   for access when the user cannot edit the layers.
   Only included when the project has editable layers.

   @copyright 2026 S.Poudroux / Kheper 3D
   @license MPL-2.0 *}
<li id="edition-menu" class="edition-menu-item">
  <a href="#" class="edition-menu-run" role="button" aria-pressed="false" title="{@view~edition.navbar.title@}">
    <img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionToggleEditing.svg" alt="{@view~edition.navbar.title@}" width="20" height="20"/>
  </a>
  <lizmap-edition-button></lizmap-edition-button>
</li>
