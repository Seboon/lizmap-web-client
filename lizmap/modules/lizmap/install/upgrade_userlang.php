<?php

/**
 * Adds the "lang" column to jlx_user: locale of a self-registered user
 * (see lzmAuthListener); empty for accounts created by the admin.
 *
 * Runs for an existing site when the installer is run again and the
 * version of the lizmap module (module.xml) is newer than the installed
 * one; a fresh install creates the column from the DAO.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class lizmapModuleUpgrader_userlang extends jInstallerModule
{
    // Jelix skips an upgrader whose target version is not higher than the
    // installed one: 3.9.11 never ran on a 3.9.11 site.
    public $targetVersions = array(
        '3.9.11.2',
    );
    public $date = '2026-09-29';

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
