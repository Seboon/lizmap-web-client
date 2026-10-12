<?php

use LizmapAdmin\UserEditionRights;

/**
 * Section "Edition per repository and project" of the rights page of a user
 * (template jacl2db_admin~user_rights, overridden in the theme).
 *
 * Parameters: user (login), readonly (no form).
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class user_edition_rightsZone extends jZone
{
    protected $_tplname = 'user_edition_rights';

    protected function _prepareTpl()
    {
        $login = (string) $this->param('user');
        $readonly = (bool) $this->param('readonly', false);
        $rights = new UserEditionRights($login);

        $globalUser = jAcl2::checkByUser($login, UserEditionRights::RIGHT);

        $repositories = array();
        foreach (lizmap::getRepositoryList() as $key) {
            $repository = lizmap::getRepository($key);
            if (!$repository) {
                continue;
            }
            $setting = $rights->userSetting($key);
            $projects = UserEditionRights::projects($repository);
            $groups = $rights->groupsWithRight($key);

            // Layers he will not be able to edit in the projects he may
            // edit, because of the groups allowed in the Lizmap plugin.
            $checked = array();
            if ($globalUser || $groups || $setting['mode'] === 'all') {
                $checked = array_keys($projects);
            } elseif ($setting['mode'] === 'projects') {
                $checked = array_intersect(array_keys($projects), $setting['projects']);
            }
            $blocked = array();
            foreach ($checked as $project) {
                foreach ($rights->blockedLayers($repository, $project) as $layer) {
                    // Escaped here: given to {jlocale} in the template.
                    $blocked[] = array_map('htmlspecialchars', array('project' => $projects[$project]) + $layer);
                }
            }

            $repositories[$key] = array(
                'label' => $repository->getLabel() ?: $key,
                'projects' => $projects,
                'mode' => $setting['mode'],
                'chosen' => array_flip($setting['projects']),
                'groups' => array_map('htmlspecialchars', $groups),
                'canView' => jAcl2::checkByUser($login, 'lizmap.repositories.view', $key),
                'blocked' => $blocked,
            );
        }

        $token = '';
        if (!$readonly) {
            if (empty($_SESSION['LIZMAP_USER_EDITION_RIGHTS_TOKEN'])) {
                $_SESSION['LIZMAP_USER_EDITION_RIGHTS_TOKEN'] = bin2hex(random_bytes(16));
            }
            $token = $_SESSION['LIZMAP_USER_EDITION_RIGHTS_TOKEN'];
        }

        $this->_tpl->assign(array(
            'user' => $login,
            'exists' => $rights->exists(),
            'readonly' => $readonly,
            'token' => $token,
            'repositories' => $repositories,
            'globalGroups' => array_map('htmlspecialchars', $rights->groupsWithRight('-')),
            'globalUser' => $globalUser,
        ));
    }
}
