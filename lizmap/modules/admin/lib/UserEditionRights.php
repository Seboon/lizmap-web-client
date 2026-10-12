<?php

namespace LizmapAdmin;

use Lizmap\Project\Project;
use Lizmap\Project\ProjectMainData;

/**
 * Right "Use the edition tool" (lizmap.tools.edition.use) of one user,
 * repository by repository and project by project, for the rights page of
 * a user in the administration.
 *
 * The right is given to the private group of the user, either on the
 * repository (all its projects, also the ones added later) or on the
 * resource "<repository>~<project>" for chosen projects
 * (Project::canUseEditionTool()). The rights the user gets from his other
 * groups are shown, not changed.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class UserEditionRights
{
    public const RIGHT = 'lizmap.tools.edition.use';

    /** Length of the column jacl2_rights.id_aclres */
    public const RESOURCE_MAX_LENGTH = 100;

    /** @var string */
    protected $login;

    /** @var null|string private group of the user */
    protected $privateGroup;

    /** @var array id => name of the other groups of the user */
    protected $groups = array();

    /** @var array id => name of all the groups that exist */
    protected $allGroups;

    /**
     * @param string $login
     */
    public function __construct($login)
    {
        $this->login = $login;
        $cnx = \jDb::getConnection('jacl2_profile');
        $rs = $cnx->query('SELECT g.id_aclgrp, g.name, g.grouptype FROM jacl2_user_group ug'
            .' INNER JOIN jacl2_group g ON g.id_aclgrp = ug.id_aclgrp'
            .' WHERE ug.login = '.$cnx->quote($login).' ORDER BY g.name');
        foreach ($rs as $rec) {
            if ((int) $rec->grouptype === 2) {
                $this->privateGroup = $rec->id_aclgrp;
            } else {
                $this->groups[$rec->id_aclgrp] = $rec->name;
            }
        }
    }

    /**
     * @return bool false if the user is not registered in the rights system
     */
    public function exists()
    {
        return $this->privateGroup !== null;
    }

    /**
     * Keys and titles of all the projects of a repository, whatever the
     * rights of the administrator who looks at the page.
     *
     * @param \Lizmap\Project\Repository $repository
     *
     * @return array key => title
     */
    public static function projects($repository)
    {
        $projects = array();
        $dir = $repository->getPath();
        $files = is_dir($dir) ? (scandir($dir) ?: array()) : array();
        $version = \jApp::config()->minimumRequiredVersion['lizmapWebClientTargetVersion'];
        foreach ($files as $file) {
            if (substr($file, -4) !== '.qgs' || !in_array($file.'.cfg', $files)) {
                continue;
            }
            $key = substr($file, 0, -4);
            $title = $key;

            try {
                $data = new ProjectMainData($repository->getKey(), $key, $dir.$file, $version, \lizmap::getAppContext());
                $title = $data->getTitle() ?: $key;
            } catch (\Exception $e) {
                // Title not readable: the key is shown.
            }
            $projects[$key] = $title;
        }
        asort($projects, SORT_NATURAL | SORT_FLAG_CASE);

        return $projects;
    }

    /**
     * Groups of the user (not his private group) which have the right
     * $right on the resource $resource.
     *
     * @param string $resource '-' for the general right
     * @param string $right
     *
     * @return string[] names of the groups
     */
    public function groupsWithRight($resource, $right = self::RIGHT)
    {
        if (!$this->groups) {
            return array();
        }
        $cnx = \jDb::getConnection('jacl2_profile');
        $ids = implode(',', array_map(array($cnx, 'quote'), array_keys($this->groups)));
        $rs = $cnx->query('SELECT id_aclgrp FROM jacl2_rights'
            .' WHERE id_aclsbj = '.$cnx->quote($right)
            .' AND id_aclres = '.$cnx->quote($resource)
            .' AND canceled = 0 AND id_aclgrp IN ('.$ids.')');
        $names = array();
        foreach ($rs as $rec) {
            $names[] = $this->groups[$rec->id_aclgrp];
        }
        sort($names);

        return $names;
    }

    /**
     * Editable layers of a project that the user cannot edit because the
     * groups allowed for them in the Lizmap plugin do not include any of
     * his groups (administrators are never blocked, see
     * Project::checkEditionLayerAcl()).
     *
     * @param \Lizmap\Project\Repository $repository
     * @param string                     $project    key of the project
     *
     * @return array[] title of the layer and names of its allowed groups
     */
    public function blockedLayers($repository, $project)
    {
        if (\jAcl2::checkByUser($this->login, 'lizmap.admin.repositories.delete')) {
            return array();
        }
        $cfgPath = $repository->getPath().$project.'.qgs.cfg';
        $cfg = is_readable($cfgPath) ? json_decode((string) file_get_contents($cfgPath), true) : null;
        if (!is_array($cfg) || empty($cfg['editionLayers']) || !is_array($cfg['editionLayers'])) {
            return array();
        }
        $userGroups = array_keys($this->groups);
        if ($this->privateGroup) {
            $userGroups[] = $this->privateGroup;
        }
        $blocked = array();
        foreach ($cfg['editionLayers'] as $name => $layer) {
            $acl = is_array($layer) && isset($layer['acl']) ? trim((string) $layer['acl']) : '';
            if ($acl === '') {
                continue;
            }
            $allowed = array_values(array_filter(preg_split('/\s*,\s*/', $acl)));
            if (array_intersect($allowed, $userGroups)) {
                continue;
            }
            $title = $cfg['layers'][$name]['title'] ?? '';
            $blocked[] = array(
                'layer' => $title !== '' ? $title : $name,
                'groups' => implode(', ', array_map(array($this, 'groupLabel'), $allowed)),
            );
        }

        return $blocked;
    }

    /**
     * @param string $id identifier of a group, as written in the plugin
     *
     * @return string the identifier, with the name of the group, or
     *                marked as a group that does not exist
     */
    protected function groupLabel($id)
    {
        if ($this->allGroups === null) {
            $this->allGroups = array();
            $cnx = \jDb::getConnection('jacl2_profile');
            foreach ($cnx->query('SELECT id_aclgrp, name FROM jacl2_group') as $rec) {
                $this->allGroups[$rec->id_aclgrp] = $rec->name;
            }
        }
        if (!isset($this->allGroups[$id])) {
            // Typing error in the plugin, or group deleted.
            return \jLocale::get('admin~editionrights.group.unknown', array($id));
        }

        return $this->allGroups[$id] === $id ? $id : $id.' ('.$this->allGroups[$id].')';
    }

    /**
     * Resources of the right given to the private group of the user, in a
     * repository.
     *
     * @param string $repository
     *
     * @return array{mode: string, projects: string[]} mode none, all or
     *                                                  projects, and the
     *                                                  chosen projects
     */
    public function userSetting($repository)
    {
        $setting = array('mode' => 'none', 'projects' => array());
        if (!$this->privateGroup) {
            return $setting;
        }
        $prefix = $repository.'~';
        foreach ($this->privateResources($repository) as $resource) {
            if ($resource === $repository) {
                $setting['mode'] = 'all';
            } elseif (strpos($resource, $prefix) === 0) {
                $setting['projects'][] = substr($resource, strlen($prefix));
            }
        }
        if ($setting['mode'] === 'none' && $setting['projects']) {
            $setting['mode'] = 'projects';
        }

        return $setting;
    }

    /**
     * @param string $repository
     *
     * @return string[] resources of the right of the private group, in the
     *                  repository (the repository and its projects)
     */
    protected function privateResources($repository)
    {
        $cnx = \jDb::getConnection('jacl2_profile');
        $like = str_replace(array('\\', '%', '_'), array('\\\\', '\\%', '\\_'), $repository).'~%';
        $rs = $cnx->query('SELECT id_aclres FROM jacl2_rights'
            .' WHERE id_aclsbj = '.$cnx->quote(self::RIGHT)
            .' AND id_aclgrp = '.$cnx->quote($this->privateGroup)
            .' AND canceled = 0'
            .' AND (id_aclres = '.$cnx->quote($repository).' OR id_aclres LIKE '.$cnx->quote($like).')');
        $resources = array();
        foreach ($rs as $rec) {
            $resources[] = $rec->id_aclres;
        }

        return $resources;
    }

    /**
     * Gives or removes the right in a repository.
     *
     * @param string   $repository
     * @param string   $mode        none, all or projects
     * @param string[] $projects    chosen projects (mode projects)
     * @param string[] $allProjects keys of the projects of the repository
     *
     * @return string[] projects whose resource is too long to be stored
     */
    public function save($repository, $mode, $projects, $allProjects)
    {
        $wanted = array();
        $tooLong = array();
        if ($mode === 'all') {
            $wanted[] = $repository;
        } elseif ($mode === 'projects') {
            foreach (array_intersect($projects, $allProjects) as $project) {
                $resource = Project::editionResource($repository, $project);
                if (strlen($resource) > self::RESOURCE_MAX_LENGTH) {
                    $tooLong[] = $project;
                } else {
                    $wanted[] = $resource;
                }
            }
        }

        $current = $this->privateResources($repository);
        foreach (array_diff($current, $wanted) as $resource) {
            \jAcl2DbManager::removeRight($this->privateGroup, self::RIGHT, $resource);
        }
        foreach (array_diff($wanted, $current) as $resource) {
            \jAcl2DbManager::addRight($this->privateGroup, self::RIGHT, $resource);
        }

        return $tooLong;
    }
}
