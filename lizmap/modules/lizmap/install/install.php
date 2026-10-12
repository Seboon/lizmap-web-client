<?php

use Jelix\IniFile\IniModifier;

/**
 * @author    3liz
 * @copyright 2011 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */
require_once __DIR__.'/LizmapDbOwnership.php';

class lizmapModuleInstaller extends jInstallerModule
{
    /**
     * Fork: installation from scratch on a database that already holds the
     * Lizmap tables (database kept from another installation, without its
     * var/config/installer.ini.php). jcommunity then alters every column
     * of jlx_user to match the user DAO (it adds the "lang" column), which
     * PostgreSQL only allows to the owner of the table. Stop before any
     * change, with the way out, rather than in the middle of the install.
     */
    public function preInstall()
    {
        $this->useDbProfile('jauth');
        $cnx = $this->dbConnection();
        if ($cnx->dbms != 'pgsql' || !$cnx->schema()->getTable('jlx_user')) {
            // New database: the tables are created by the database user of
            // Lizmap, who owns them.
            return;
        }
        $problems = LizmapDbOwnership::notAlterable($cnx, array('jlx_user'));
        if (!count($problems)) {
            return;
        }
        $user = LizmapDbOwnership::currentUser($cnx);

        throw new Exception(
            'Lizmap is installed from scratch on a database that already holds its tables, '
            .'but the table '.$problems[0]['table'].' belongs to "'.$problems[0]['owner'].'", '
            .'not to the database user of Lizmap ("'.$user.'"): the installer could not alter it. '
            ."Either:
"
            .'- upgrade instead of installing: copy lizmap/var/config/installer.ini.php '
            .'(and the other files of lizmap/var/config) from the previous installation, '
            ."then run the installer again;
"
            .'- or install on an empty database;'."
"
            .'- or give the table to "'.$user.'" (as postgres or as its owner), '
            ."then run the installer again:
"
            .LizmapDbOwnership::fixSql($problems, $user)
        );
    }

    public function install()
    {
        $lizmapConfFile = jApp::varConfigPath('lizmapConfig.ini.php');
        if (!file_exists($lizmapConfFile)) {
            $lizmapConfFileDist = jApp::varConfigPath('lizmapConfig.ini.php.dist');
            if (file_exists($lizmapConfFileDist)) {
                copy($lizmapConfFileDist, $lizmapConfFile);
            } else {
                $this->copyFile('config/lizmapConfig.ini.php', $lizmapConfFile);
            }
        }

        $localConfig = jApp::varConfigPath('localconfig.ini.php');
        if (!file_exists($localConfig)) {
            $localConfigDist = jApp::varConfigPath('localconfig.ini.php.dist');
            if (file_exists($localConfigDist)) {
                copy($localConfigDist, $localConfig);
            } else {
                file_put_contents($localConfig, ';<?php die(\'\');?>');
            }
        }
        $ini = new IniModifier($localConfig);
        $ini->setValue('lizmap', 'lizmapConfig.ini.php', 'coordplugins');
        $ini->save();

        if ($this->firstDbExec()) {

            // Add log table
            $this->useDbProfile('lizlog');
            $this->execSQLScript('sql/lizlog');

            // Add geobookmark table
            $this->useDbProfile('jauth');
            $this->execSQLScript('sql/lizgeobookmark');
        }
    }
}
