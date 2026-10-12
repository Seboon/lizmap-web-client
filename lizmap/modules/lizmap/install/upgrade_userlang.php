<?php

/**
 * Adds the "lang" column to jlx_user: locale of a self-registered user
 * (see lzmAuthListener); empty for accounts created by the admin.
 *
 * Runs for an existing site when the installer is run again and the
 * version of the lizmap module (module.xml) is newer than the installed
 * one (upgrade). A fresh install does not run it: jcommunity creates the
 * table, or adds the missing columns, from the user DAO (lizmap~user),
 * which has the column.
 *
 * PostgreSQL: adding a column needs the owner of the table. preInstall()
 * checks it before any change of the upgrade and gives the SQL to run
 * otherwise (as the owner or postgres): either give the table to the
 * database user of Lizmap, or add the column by hand; the upgrader then
 * finds the column and does nothing.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
require_once __DIR__.'/LizmapDbOwnership.php';

class lizmapModuleUpgrader_userlang extends jInstallerModule
{
    // Jelix skips an upgrader whose target version is not higher than the
    // installed one: 3.9.11 never ran on a 3.9.11 site.
    public $targetVersions = array(
        '3.9.11.2',
    );
    public $date = '2026-09-29';

    public function preInstall()
    {
        $this->useDbProfile('jauth');
        $cnx = $this->dbConnection();
        $table = $cnx->schema()->getTable('jlx_user');
        if (!$table || $table->getColumn('lang')) {
            return;
        }
        $problems = LizmapDbOwnership::notAlterable($cnx, array('jlx_user'));
        if (!count($problems)) {
            return;
        }
        $user = LizmapDbOwnership::currentUser($cnx);
        $name = $problems[0]['table'];

        throw new Exception(
            'Upgrade of Lizmap: the column "lang" must be added to the table '.$name.', '
            .'which belongs to "'.$problems[0]['owner'].'", not to the database user of Lizmap ("'.$user.'"). '
            .'Run one of these as postgres or as "'.$problems[0]['owner'].'", then run the installer again:'."\n"
            .'- give the table to Lizmap: '.LizmapDbOwnership::fixSql($problems, $user)."\n"
            .'- or add the column: ALTER TABLE '.$name." ADD COLUMN lang VARCHAR(10) DEFAULT '';"
        );
    }

    public function install()
    {
        if ($this->firstDbExec()) {
            $this->useDbProfile('jauth');
            // The column may already exist (added by hand, or by an earlier run).
            $table = $this->dbConnection()->schema()->getTable('jlx_user');
            if ($table && !$table->getColumn('lang')) {
                $this->execSQLScript('sql/lizAddUserLang');
            }
        }
    }
}
