<?php
/**
 * Jelix coordinator plugin: persists the chosen language beyond the PHP
 * session.
 *
 * Context: the native "autolocale" plugin (vendor/jelix/jelix/lib/jelix/
 * plugins/coord/autolocale/autolocale.coord.php) reads the URL parameter
 * "lang" (the one used by our Settings > Language menu) and stores the
 * choice in $_SESSION['JX_LANG']. Problem: logging out destroys the
 * session (expected, for security), so that choice disappears with it and
 * the language falls back to browser detection on the next page load.
 *
 * This plugin adds durable persistence via a cookie ("lizmap-lang"),
 * without touching autolocale or any file under vendor/:
 *   - when the user clicks a language link (?lang=... present in the
 *     URL), their choice is also written to the cookie;
 *   - when the session no longer carries a language (e.g. right after a
 *     logout) but the cookie exists, the session is refilled from the
 *     cookie BEFORE autolocale runs, so it picks up the right language
 *     directly instead of falling back to the browser.
 *
 * NOTE ON EXECUTION ORDER: this plugin is designed to work regardless of
 * the relative execution order with "autolocale" (the exact order when
 * both are declared in different ini files, merged by Jelix, is not
 * guaranteed). Rather than "pre-filling" the session for autolocale to
 * read afterwards, this plugin applies the cookie value itself, directly,
 * to $_SESSION and jApp::config()->locale — whether it runs before or
 * after autolocale, the final result is the same: absent an explicit
 * choice in the current request, the last write (ours) wins, without ever
 * overriding a choice coming from a ?lang=... present in THIS request
 * (absolute priority, handled in the if block below).
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class langpersistCoordPlugin implements jICoordPlugin
{
    /** Must match urlParamNameLanguage from [coordplugin_autolocale]. */
    const URL_PARAM = 'lang';
 
    /** Persistence cookie name. */
    const COOKIE_NAME = 'lizmap-lang';
 
    /** Cookie lifetime: 1 year. */
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
            // The user just picked a language via our switcher: absolute
            // priority to this choice, and we make it durable.
            $lang = jLocale::getCorrespondingLocale($requested);
            if ($lang != '' && !headers_sent()) {
                $this->setCookie($lang);
            }
            // We then let autolocale do its normal work with this same
            // URL parameter (updating $_SESSION['JX_LANG'] and
            // jApp::config()->locale): nothing else to do here.
            return null;
        }
 
        // No explicit choice in this request (no ?lang=...): if a
        // persistent cookie exists, we apply it ourselves — whether to
        // restore the language after a logout (empty session) or simply
        // to confirm the current state. We don't touch anything if no
        // cookie exists (a user who never used our switcher: Lizmap's
        // original behaviour is fully preserved, browser detection via
        // autolocale).
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
        $secure = $this->isHttps();
 
        if (PHP_VERSION_ID >= 70300) {
            setcookie(self::COOKIE_NAME, $lang, array(
                'expires' => time() + self::COOKIE_LIFETIME,
                'path' => '/',
                'samesite' => 'Lax',
                'secure' => $secure,
            ));
        } else {
            setcookie(self::COOKIE_NAME, $lang, time() + self::COOKIE_LIFETIME, '/', '', $secure);
        }
    }
 
    /**
     * Detects whether the current request is HTTPS, including behind a
     * reverse proxy that terminates TLS (X-Forwarded-Proto). Used to set
     * the cookie's "secure" flag only when it's actually meaningful — a
     * hardcoded true would silently stop the cookie from being sent/stored
     * on any plain-HTTP access (local testing, a misconfigured proxy...).
     */
    private function isHttps()
    {
        if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        if (!empty($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443) {
            return true;
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
            return true;
        }

        return false;
    }
 
    public function beforeOutput()
    {
    }
 
    public function afterProcess()
    {
    }
}
