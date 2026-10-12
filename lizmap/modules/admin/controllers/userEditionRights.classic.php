<?php

use LizmapAdmin\UserEditionRights;

/**
 * Saves the section "Edition per repository and project" of the rights
 * page of a user (zone admin~user_edition_rights).
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class userEditionRightsCtrl extends jController
{
    public $pluginParams = array(
        '*' => array('jacl2.rights.and' => array('acl.user.view', 'acl.user.modify')),
    );

    /**
     * @return jResponseRedirect
     */
    public function save()
    {
        $login = (string) $this->param('user');

        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = 'jacl2db_admin~users:rights';
        $rep->params = array('user' => $login);

        $token = (string) $this->param('token');
        if (!$this->request->isPostMethod()
            || empty($_SESSION['LIZMAP_USER_EDITION_RIGHTS_TOKEN'])
            || !hash_equals($_SESSION['LIZMAP_USER_EDITION_RIGHTS_TOKEN'], $token)) {
            jMessage::add(jLocale::get('admin~editionrights.error.token'), 'error');

            return $rep;
        }

        $rights = new UserEditionRights($login);
        if ($login === '' || !$rights->exists()) {
            jMessage::add(jLocale::get('admin~editionrights.error.user'), 'error');
            $rep->action = 'jacl2db_admin~users:index';
            $rep->params = array();

            return $rep;
        }

        $modes = $this->param('mode', array());
        $projects = $this->param('projects', array());
        $modes = is_array($modes) ? $modes : array();
        $projects = is_array($projects) ? $projects : array();

        $tooLong = array();
        foreach (lizmap::getRepositoryList() as $key) {
            if (!isset($modes[$key])) {
                // Repository added after the page was shown: unchanged.
                continue;
            }
            $repository = lizmap::getRepository($key);
            if (!$repository) {
                continue;
            }
            $mode = in_array($modes[$key], array('none', 'all', 'projects'), true) ? $modes[$key] : 'none';
            $chosen = isset($projects[$key]) && is_array($projects[$key]) ? array_map('strval', $projects[$key]) : array();
            if ($mode === 'projects' && !$chosen) {
                $mode = 'none';
            }
            $allProjects = array_keys(UserEditionRights::projects($repository));
            foreach ($rights->save($key, $mode, $chosen, $allProjects) as $project) {
                $tooLong[] = $key.'~'.$project;
            }
        }

        foreach ($tooLong as $resource) {
            jMessage::add(jLocale::get('admin~editionrights.error.resource', array($resource)), 'error');
        }
        jLog::log('Edition rights per repository and project of '.$login.' changed by '.jAuth::getUserSession()->login, 'lizmapadmin');
        jMessage::add(jLocale::get('admin~editionrights.message.saved', array($login)), 'info');

        return $rep;
    }
}
