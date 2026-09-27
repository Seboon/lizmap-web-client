{* @copyright 2026 S.Poudroux / Kheper 3D
   @license MPL-2.0 *}
<li class="settings-item dropdown">
  <a href="#" class="dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
    <span class="svg-icon svg-cog "></span> <span class="text hidden-phone">{@view~settings_menu.title@}</span>
  </a>
  <ul class="dropdown-menu">
    <li class="dropdown-submenu">
      <a href="#" tabindex="-1">{@view~settings_menu.theme@}</a>
      <ul class="dropdown-menu">
        <li><a href="#" data-theme-choice="default">{@view~settings_menu.theme.default@}</a></li>
        <li><a href="#" data-theme-choice="dark">{@view~settings_menu.theme.dark@}</a></li>
      </ul>
    </li>
    {if isset($langMeta)}
    <li class="dropdown-submenu">
      <a href="#" tabindex="-1">{@view~settings_menu.lang@}</a>
      <ul class="dropdown-menu">
        {foreach $langMeta as $locale => $label}
          <li><a href="?lang={$locale}">{$label}</a></li>
        {/foreach}
      </ul>
    </li>
    {/if}
    {if isset($context) and $context == 'map'}
    {* Help/"Aide" entry: map view only, per user request. Placeholder
       for now (no target page/content yet). *}
    <li><a href="#" tabindex="-1">{@view~settings_menu.help@}</a></li>
    {/if}
  </ul>
</li>
