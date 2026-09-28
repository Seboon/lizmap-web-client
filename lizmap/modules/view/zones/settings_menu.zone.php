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
        $langMeta = lizmapServices::getAvailableLocalesList();

        $currentLocale = jLocale::getCurrentLocale();

        $langKey = null;
        foreach ($langMeta as $key => $label) {
            if (strpos($key, $currentLocale) === 0) {
                $langKey = $key;

                break;
            }
        }
        if (!$langKey) {
            $langKey = 'en_US';
        }

        $this->_tpl->assign('langMeta', $langMeta);
        $this->_tpl->assign('currentLang', $langKey);

        // Page context ('map', 'general', 'admin', 'admin_login'...), with a
        // default when the caller doesn't pass it.
        $this->_tpl->assign('context', $this->param('context', 'general'));
    }
}
