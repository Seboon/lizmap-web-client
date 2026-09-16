<?php

/**
 * Construit le menu "Paramètres" (choix du thème + choix de la langue),
 * réutilisable depuis n'importe quel template via {zone 'view~settings_menu'}.
 *
 * Contrairement à une variable assignée dans un contrôleur (ex. $langMeta),
 * une zone calcule ses propres données à chaque appel : il n'y a donc rien
 * à dupliquer dans les contrôleurs des pages qui l'utilisent.
 */
class settings_menuZone extends jZone
{
    protected $_tplname = 'settings_menu';

    protected function _prepareTpl()
    {
        // Définition du tableau des langues et drapeaux
        $langMeta = array(
            'ar_EG' => array('eg', 'العربية (مصر)'),
            'ar_SD' => array('sd', 'العربية (السودان)'),
            'fr_FR' => array('fr', 'Français'),
            'en_US' => array('gb', 'English'),
            'es_ES' => array('es', 'Español'),
            'pt_PT' => array('pt', 'Português'),
            'pt_BR' => array('brz', 'Português (Brasil)'),
            'it_IT' => array('it', 'Italiano'),
            'de_DE' => array('de', 'Deutsch'),
            'nl_NL' => array('nl', 'Nederlands'),
            'pl_PL' => array('pl', 'Polski'),
            'ro_RO' => array('ro', 'Română'),
            'cs_CZ' => array('cz', 'Čeština'),
            'sk_SK' => array('sk', 'Slovensko'),
            'sl_SI' => array('sl', 'Slovenščina'),
            'fi_FI' => array('fi', 'Suomi'),
            'sv_SE' => array('se', 'Svenska'),
            'hu_HU' => array('hu', 'Magyar'),
            'no_NO' => array('no', 'Norsk'),
            'el_GR' => array('gr', 'Ελληνικά'),
            'ru_RU' => array('ru', 'Русский'),
            'uk_UA' => array('ua', 'Українська'),
            'ja_JP' => array('jp', '日本語'),
        );

        // Récupère la langue active Jelix (celle en session via autolocale)
        $currentLocale = jLocale::getCurrentLocale();

        // Cherche la bonne entrée dans $langMeta correspondant à la langue courante
        $langKey = null;
        foreach ($langMeta as $key => $meta) {
            if (strpos($key, $currentLocale) === 0) {
                $langKey = $key;

                break;
            }
        }
        // Si aucune correspondance trouvée, fallback
        if (!$langKey) {
            $langKey = 'en_US';
        }

        $this->_tpl->assign('langMeta', $langMeta);
        $this->_tpl->assign('currentLang', $langKey);
    }
}
