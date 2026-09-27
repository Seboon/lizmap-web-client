<?php

/**
 * Builds the "Settings" menu (theme choice + language choice),
 * reusable from any template via {zone 'view~settings_menu'}.
 *
 * A zone recomputes its own data on every call (unlike a controller-assigned
 * variable such as $langMeta), so nothing needs duplicating in the
 * controllers of the pages that use it.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class settings_menuZone extends jZone
{
    protected $_tplname = 'settings_menu';

    protected function _prepareTpl()
    {
        // Available languages (locale => displayed label). No flag, label only.
        // Local addition (Seb's fork, 2026-09-26): list taken from
        // lizmapServices::getAvailableLocalesList(), which builds it from
        // availableLocales (mainconfig.ini.php) -- this used to be a
        // hardcoded array duplicated here, independent from
        // availableLocales: removing a locale from mainconfig would not
        // remove it from this menu (it stayed displayed but stopped
        // working, see jLocale::getCurrentLocale()). Both lists now share a
        // single source.
        $langMeta = lizmapServices::getAvailableLocalesList();

        // Current Jelix locale (session, via autolocale)
        $currentLocale = jLocale::getCurrentLocale();

        // Find the matching entry in $langMeta for the current locale
        $langKey = null;
        foreach ($langMeta as $key => $label) {
            if (strpos($key, $currentLocale) === 0) {
                $langKey = $key;

                break;
            }
        }
        // No match found: fallback
        if (!$langKey) {
            $langKey = 'en_US';
        }

        $this->_tpl->assign('langMeta', $langMeta);
        $this->_tpl->assign('currentLang', $langKey);

        // Page context ('map', 'general', 'admin', 'admin_login'...),
        // passed by the caller via {zone 'view~settings_menu', array('context' => ...)}.
        // jZone::_createContent() already auto-assigns every zone param to
        // the template (see $this->_params), so this isn't strictly
        // required for $context to reach settings_menu.tpl -- it's kept
        // explicit here for readability and to apply a default when a
        // caller forgets to pass it.
        $this->_tpl->assign('context', $this->param('context', 'general'));
    }
}
