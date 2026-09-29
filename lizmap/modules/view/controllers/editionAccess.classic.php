<?php

use Lizmap\Project\Project;
use Lizmap\Project\UnknownLizmapProjectException;

/**
 * Requests for access to the editable layers of a project.
 *
 * The "Edition" entry of the map (template map_edition_access, shown when
 * the project has editable layers that the current user cannot edit) sends
 * the request of the user to the administrators by email.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class editionAccessCtrl extends jController
{
    /** Minimum delay, in seconds, between two requests of a user for the same project. */
    public const REQUEST_DELAY = 86400;

    /** Maximum length of the message of the user. */
    public const MESSAGE_MAX_LENGTH = 1000;

    /**
     * Sends the request of the current user to the administrators.
     *
     * POST only, with the X-Requested-With header set by the
     * <lizmap-edition-access> component: a form posted from another site
     * cannot set it.
     *
     * @return jResponseJson {status: 'sent'|'error', message: string}
     */
    public function request()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');

        if ($_SERVER['REQUEST_METHOD'] !== 'POST'
            || ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
            return $this->error($rep, 400, 'error.request');
        }

        if (!jAuth::isConnected()) {
            return $this->error($rep, 401, 'login.required');
        }

        $repository = (string) $this->param('repository');
        $projectKey = (string) $this->param('project');

        $project = null;
        if ($repository !== '' && $projectKey !== ''
            && jAcl2::check('lizmap.repositories.view', $repository)) {
            try {
                $project = lizmap::getProject($repository.'~'.$projectKey);
            } catch (UnknownLizmapProjectException $e) {
                $project = null;
            }
        }
        if (!$project || !$project->hasEditionLayersInConfig()) {
            return $this->error($rep, 404, 'error.project');
        }

        if ($project->hasEditionLayersForCurrentUser()) {
            return $this->error($rep, 409, 'error.already');
        }

        $user = jAuth::getUserSession();

        // One request per user and project within REQUEST_DELAY.
        $cacheKey = 'editionaccess_'.sha1($user->login.'|'.$repository.'~'.$projectKey);
        if ($this->getCache($cacheKey)) {
            return $this->error($rep, 429, 'error.already.sent');
        }

        $message = trim((string) $this->param('message', ''));
        if (mb_strlen($message) > self::MESSAGE_MAX_LENGTH) {
            $message = mb_substr($message, 0, self::MESSAGE_MAX_LENGTH);
        }

        $services = lizmap::getServices();
        $sent = $services->sendNotificationEmail(
            $this->emailSubject($services, $project),
            $this->emailBody($services, $project, $user, $message),
            isset($user->email) ? $user->email : null
        );
        if (!$sent) {
            return $this->error($rep, 500, 'error.mail');
        }

        $this->setCache($cacheKey, time());
        jLog::log(
            'Edition access requested by '.$user->login.' for the project '.$repository.'~'.$projectKey,
            'lizmapadmin'
        );

        $rep->data = array(
            'status' => 'sent',
            'message' => jLocale::get('view~editionaccess.sent'),
        );

        return $rep;
    }

    /**
     * Locale of the emails sent to the administrator: the "Language of
     * notification e-mails" setting, else the default locale.
     *
     * @param lizmapServices $services
     *
     * @return string
     */
    protected function adminLocale($services)
    {
        if (!empty($services->adminNotificationLocale)) {
            return $services->adminNotificationLocale;
        }

        return jApp::config()->locale;
    }

    /**
     * @param lizmapServices $services
     * @param Project        $project
     *
     * @return string
     */
    protected function emailSubject($services, $project)
    {
        return jLocale::get(
            'view~editionaccess.email.subject',
            array($services->appName, $project->getTitle()),
            $this->adminLocale($services)
        );
    }

    /**
     * @param lizmapServices $services
     * @param Project        $project
     * @param object         $user     user of the session
     * @param string         $message  message of the user
     *
     * @return string
     */
    protected function emailBody($services, $project, $user, $message)
    {
        $locale = $this->adminLocale($services);
        $get = function ($key, $args = array()) use ($locale) {
            return jLocale::get('view~editionaccess.email.'.$key, $args, $locale);
        };
        $field = function ($name) use ($user) {
            return isset($user->{$name}) ? trim((string) $user->{$name}) : '';
        };

        $repository = $project->getRepository();
        $fullName = trim($field('firstname').' '.$field('lastname'));

        $lines = array(
            $get('intro', array($user->login, $project->getTitle(), $repository->getLabel())),
            '',
            $get('user', array($user->login)),
        );
        if ($fullName !== '') {
            $lines[] = $get('name', array($fullName));
        }
        if ($field('email') !== '') {
            $lines[] = $get('email', array($field('email')));
        }
        if ($field('organization') !== '') {
            $lines[] = $get('organization', array($field('organization')));
        }
        $lines[] = $get('layers', array(implode(', ', $project->getEditionLayerTitles())));
        $lines[] = '';
        $lines[] = $get('message');
        $lines[] = $message !== '' ? $message : '-';
        $lines[] = '';
        $lines[] = $get('map', array(jUrl::getFull('view~map:index', array(
            'repository' => $repository->getKey(),
            'project' => $project->getKey(),
        ))));
        $lines[] = $get('admin.user', array(jUrl::getFull('jauthdb_admin~default:view', array(
            'j_user_login' => $user->login,
        ))));
        $lines[] = $get('admin.rights', array(
            jLocale::get('admin~jacl2.lizmap.tools.edition.use', null, $locale),
            jUrl::getFull('admin~maps:modifySection', array('repository' => $repository->getKey())),
        ));
        $lines[] = '';
        $lines[] = $get('admin.hint');

        return implode("\n", $lines);
    }

    /**
     * @param jResponseJson $rep
     * @param int           $status  HTTP status
     * @param string        $message key of the message, in view~editionaccess
     *
     * @return jResponseJson
     */
    protected function error($rep, $status, $message)
    {
        $rep->setHttpStatus($status, 'Edition access request');
        $rep->data = array(
            'status' => 'error',
            'message' => jLocale::get('view~editionaccess.'.$message),
        );

        return $rep;
    }

    protected function getCache($key)
    {
        try {
            return jCache::get($key);
        } catch (Exception $e) {
            return null;
        }
    }

    protected function setCache($key, $value)
    {
        try {
            jCache::set($key, $value, self::REQUEST_DELAY);
        } catch (Exception $e) {
            jLog::logEx($e, 'error');
        }
    }
}
