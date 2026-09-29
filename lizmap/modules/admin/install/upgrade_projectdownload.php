<?php

/**
 * Creates the right "Download the QGIS project" (lizmap.tools.project.download),
 * given per repository, and gives it to the admins group on the existing
 * repositories.
 *
 * Runs for an existing site when the installer is run again and the
 * installed version of the admin module is lower than 3.9.11.1; a fresh
 * install creates the right in install.php.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class adminModuleUpgrader_projectdownload extends jInstallerModule
{
    public $targetVersions = array(
        '3.9.11.1',
    );
    public $date = '2026-09-29';

    public function install()
    {
        if (!$this->firstExec('acl2')) {
            return;
        }
        $this->useDbProfile('auth');

        jAcl2DbManager::createRight(
            'lizmap.tools.project.download',
            'admin~jacl2.lizmap.tools.project.download',
            'lizmap.grp'
        );

        if (!jAcl2DbUserGroup::getGroup('admins')) {
            return;
        }
        foreach ($this->getRepositoryKeys() as $repository) {
            jAcl2DbManager::addRight('admins', 'lizmap.tools.project.download', $repository);
        }
    }

    /**
     * Keys of the repositories declared in lizmapConfig.ini.php.
     *
     * @return string[]
     */
    protected function getRepositoryKeys()
    {
        $file = jApp::varConfigPath('lizmapConfig.ini.php');
        if (!file_exists($file)) {
            return array();
        }
        $ini = parse_ini_file($file, true, INI_SCANNER_RAW);
        if (!$ini) {
            return array();
        }
        $keys = array();
        foreach (array_keys($ini) as $section) {
            if (strpos($section, 'repository:') === 0) {
                $keys[] = substr($section, strlen('repository:'));
            }
        }

        return $keys;
    }
}
