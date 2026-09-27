<?php

/**
 * Local addition (Seb's fork): "lang" column on jlx_user.
 *
 * Used to store the locale (e.g. fr_FR) of the person who submitted a
 * registration request (automatically captured when the form is
 * submitted, see lzmAuthListener::onjcommunity_registration_prepare_save
 * in the admin module). Stays empty for accounts created/imported by the
 * admin, since there is then no language to detect.
 *
 * This script only runs for an already-installed site that goes through
 * the Jelix installer again (php lizmap/install/installer.php) after
 * fetching these files -- not for a fresh install, where jcommunity's own
 * createTableFromDao() mechanism already creates the column directly from
 * the current DAO (see the README for the full investigation). It only
 * fires if the declared version of the lizmap module (module.xml) is
 * newer than the version already recorded as installed.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class lizmapModuleUpgrader_userlang extends jInstallerModule
{
    public $targetVersions = array(
        '3.9.11',
    );
    public $date = '2026-09-26';

    public function install()
    {
        if ($this->firstDbExec()) {
            $this->useDbProfile('jauth');
            $this->execSQLScript('sql/lizAddUserLang');
        }
    }
}
