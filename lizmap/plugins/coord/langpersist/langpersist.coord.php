<?php
/**
 * Plugin coordinateur Jelix : persistance du choix de langue au-delà de la
 * session PHP.
 *
 * Contexte : le plugin natif "autolocale" (vendor/jelix/jelix/lib/jelix/
 * plugins/coord/autolocale/autolocale.coord.php) lit le paramètre d'URL
 * "lang" (celui utilisé par notre menu Paramètres > Langue) et mémorise le
 * choix dans $_SESSION['JX_LANG']. Problème : la déconnexion détruit la
 * session (normal, pour la sécurité), donc ce choix disparaît avec elle et
 * la langue retombe sur la détection navigateur au prochain chargement.
 *
 * Ce plugin ajoute une mémorisation durable via un cookie ("lizmap-lang"),
 * sans toucher à autolocale ni à aucun fichier de vendor/ :
 *   - quand l'utilisateur clique sur un lien de langue (paramètre ?lang=...
 *     présent dans l'URL), son choix est aussi écrit dans le cookie ;
 *   - quand la session ne contient plus de langue (ex. juste après une
 *     déconnexion) mais que le cookie existe, la session est réalimentée
 *     à partir du cookie AVANT qu'autolocale ne s'exécute, pour qu'il
 *     retrouve directement la bonne langue au lieu de retomber sur le
 *     navigateur.
 *
 * NOTE SUR L'ORDRE D'EXÉCUTION : ce plugin est conçu pour fonctionner quel
 * que soit l'ordre relatif d'exécution avec "autolocale" (l'ordre exact
 * quand les deux sont déclarés dans des fichiers ini différents, fusionnés
 * par Jelix, n'est pas garanti). Plutôt que de "pré-remplir" la session
 * pour qu'autolocale la lise ensuite, ce plugin applique lui-même,
 * directement, la valeur du cookie à $_SESSION et jApp::config()->locale —
 * que ce soit avant ou après le passage d'autolocale, le résultat final
 * est le même : en l'absence de choix explicite dans la requête courante,
 * la dernière écriture (la nôtre) fait foi, sans jamais écraser un choix
 * venant d'un ?lang=... présent dans CETTE requête (priorité absolue,
 * gérée dans le bloc if ci-dessous).
 */
class langpersistCoordPlugin implements jICoordPlugin
{
    /** Doit correspondre à urlParamNameLanguage de [coordplugin_autolocale]. */
    const URL_PARAM = 'lang';
 
    /** Nom du cookie de persistance. */
    const COOKIE_NAME = 'lizmap-lang';
 
    /** Durée de vie du cookie : 1 an. */
    const COOKIE_LIFETIME = 31536000;
 
    public $config;
 
    public function __construct($config)
    {
        $this->config = $config;
    }
 
    public function beforeAction($params)
    {
        $requested = jApp::coord()->request->getParam(self::URL_PARAM);
 
        if ($requested !== null) {
            // L'utilisateur vient de choisir une langue via notre switcher :
            // priorité absolue à ce choix, et on le rend durable.
            $lang = jLocale::getCorrespondingLocale($requested);
            if ($lang != '' && !headers_sent()) {
                $this->setCookie($lang);
            }
            // On laisse ensuite autolocale faire son travail normal avec ce
            // même paramètre d'URL (mise à jour de $_SESSION['JX_LANG'] et
            // de jApp::config()->locale) : rien d'autre à faire ici.
            return null;
        }
 
        // Pas de choix explicite dans cette requête (pas de ?lang=...) :
        // si un cookie persistant existe, on l'applique nous-mêmes — que ce
        // soit pour restaurer la langue après une déconnexion (session vide)
        // ou simplement pour confirmer l'état courant. On ne touche à rien
        // si aucun cookie n'existe (utilisateur qui n'a jamais utilisé notre
        // switcher : comportement d'origine de Lizmap entièrement préservé,
        // détection navigateur via autolocale).
        if (isset($_COOKIE[self::COOKIE_NAME]) && $_COOKIE[self::COOKIE_NAME] != '') {
            $lang = jLocale::getCorrespondingLocale($_COOKIE[self::COOKIE_NAME]);
            if ($lang != '') {
                $_SESSION['JX_LANG'] = $lang;
                jApp::config()->locale = $lang;
            }
        }
 
        return null;
    }
 
    private function setCookie($lang)
    {
        if (PHP_VERSION_ID >= 70300) {
            setcookie(self::COOKIE_NAME, $lang, array(
                'expires' => time() + self::COOKIE_LIFETIME,
                'path' => '/',
                'samesite' => 'Lax',
            ));
        } else {
            setcookie(self::COOKIE_NAME, $lang, time() + self::COOKIE_LIFETIME, '/');
        }
    }
 
    public function beforeOutput()
    {
    }
 
    public function afterProcess()
    {
    }
}