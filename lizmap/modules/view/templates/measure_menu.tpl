{* Measure tools menu of the map page top bar (included by
   map_headermenu.tpl), modelled on the QGIS Desktop "Measure" toolbar
   button and using the native QGIS icons (assets/icons/qgis/): the icon
   starts the current tool, the small arrow next to it opens the list of
   the tools, where the current tool is chosen.
   data-target: Bootstrap 2 looks for the menu with the "href" of the
   arrow otherwise, and "#" is not a valid selector for jQuery 3.
   The entries (data-measure-tool attribute) are handled by the
   <lizmap-measures> component (assets/src/components/Measures.js),
   which opens the matching tool; only "profile" is available for now.

   @copyright 2026 S.Poudroux / Kheper 3D
   @license MPL-2.0 *}
<li id="measure-menu" class="measure-menu-item dropdown">
  <a href="#" class="measure-menu-run" role="button" aria-pressed="false" title="{@view~measure_menu.title@}">
    <img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionMeasure.svg" alt="{@view~measure_menu.title@}" width="20" height="20"/>
  </a>
  <a href="#" class="dropdown-toggle measure-menu-arrow" data-toggle="dropdown" data-target="#measure-menu" aria-haspopup="true" aria-expanded="false" title="{@view~measure_menu.choose@}" aria-label="{@view~measure_menu.choose@}">
    <span class="caret"></span>
  </a>
  <ul class="dropdown-menu">
    <li><a href="#" data-measure-tool="length"><img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionMeasure.svg" alt="" width="20" height="20"/> {@view~measure_menu.length@}</a></li>
    <li><a href="#" data-measure-tool="area"><img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionMeasureArea.svg" alt="" width="20" height="20"/> {@view~measure_menu.area@}</a></li>
    <li><a href="#" data-measure-tool="angle"><img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionMeasureAngle.svg" alt="" width="20" height="20"/> {@view~measure_menu.angle@}</a></li>
    <li><a href="#" data-measure-tool="bearing"><img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionMeasureBearing.svg" alt="" width="20" height="20"/> {@view~measure_menu.bearing@}</a></li>
    <li><a href="#" data-measure-tool="profile"><img class="qgis-icon" src="{$j_basepath}assets/icons/qgis/mActionElevationProfile.svg" alt="" width="20" height="20"/> {@view~measure_menu.profile@}</a></li>
  </ul>
  <lizmap-measures></lizmap-measures>
</li>
