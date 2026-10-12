<?php

use Lizmap\Project\Download\Notifier;
use Lizmap\Project\Download\ProjectPackage;
use Lizmap\Project\Download\ZipStore;
use Lizmap\Project\UnknownLizmapProjectException;

/**
 * Download of a QGIS project, for the users who have the right "Download
 * the QGIS project" (lizmap.tools.project.download) on its repository.
 *
 * The zip holds the whole project (folder of the project, files it uses
 * elsewhere, README); see Lizmap\Project\Download\ProjectPackage. It is
 * never built during a web request (minutes for large rasters, PHP
 * processes busy, maps blocked):
 * - index: if the zip of the project is up to date, it is sent at once;
 *   otherwise the request is queued, the user is told that they will
 *   receive an e-mail, and the command project:zip:build (cron) builds the
 *   zip and sends a download link, valid ZipStore::LINK_DAYS days;
 * - file: download link of the e-mail; the user must be logged in, be the
 *   one who asked, and still have the right.
 * The administrator receives an e-mail for every request.
 *
 * The zip is sent by nginx (X-Accel-Redirect to an internal location),
 * otherwise by PHP. A project whose data sources contain a password is
 * never sent.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class projectDownloadCtrl extends jController
{
    /**
     * @return jResponse
     */
    public function index()
    {
        $repository = (string) $this->param('repository');
        $projectKey = (string) $this->param('project');

        $project = $this->project($repository, $projectKey);
        if (!$project) {
            return $this->error(404, 'error.project');
        }
        if (!jAcl2::check('lizmap.tools.project.download', $repository)) {
            return $this->error(403, 'error.right');
        }
        if (!class_exists('ZipArchive')) {
            return $this->error(503, 'error.zip');
        }
        $store = new ZipStore();
        if (!$store->isUsable()) {
            jLog::log($store->getDir() === ''
                ? 'Project download: no root folder of the repositories is set, so no folder for the downloads'
                : 'Project download: the folder '.$store->getDir().' does not exist or cannot be written', 'lizmapadmin');

            return $this->error(503, 'error.store');
        }

        $qgsPath = $project->getQgisPath();
        $qgs = ($qgsPath && is_readable($qgsPath)) ? file_get_contents($qgsPath) : false;
        if ($qgs === false) {
            return $this->error(404, 'error.project');
        }
        if (ProjectPackage::hasPassword($qgs)) {
            jLog::log('Download of the project '.$repository.'~'.$projectKey.' refused: a data source contains a password', 'lizmapadmin');

            return $this->error(409, 'error.password');
        }

        // Fingerprint of the project now: only file names, sizes and dates
        // are read, nothing is zipped here.
        try {
            $package = new ProjectPackage($qgsPath, $qgs);
            $package->collect($projectKey);
            $fingerprint = $package->fingerprint();
        } catch (Exception $e) {
            jLog::log('Project download: '.$repository.'~'.$projectKey.' cannot be read: '.$e->getMessage(), 'lizmapadmin');

            return $this->error(500, 'error.package');
        }

        $title = $project->getTitle() ?: $projectKey;
        $user = jAuth::getUserSession();
        $login = $user ? $user->login : 'anonymous';
        $email = $user ? $user->email : '';
        $notifier = new Notifier();

        if ($store->isReady($repository, $projectKey, $fingerprint)) {
            jLog::log('Project '.$repository.'~'.$projectKey.' downloaded by '.$login, 'lizmapadmin');
            $notifier->sendRequestToAdmin($repository, $projectKey, $title, $login, $email, true);

            return $this->send($store, $repository, $projectKey);
        }

        // The zip must be prepared: the link is sent by e-mail, so the user
        // must be logged in.
        if (!$user) {
            return $this->loginRedirect(jUrl::getFull('view~projectDownload:index', array('repository' => $repository, 'project' => $projectKey)));
        }

        $added = $store->enqueue($repository, $projectKey, array(
            'login' => $login,
            'email' => $email,
            'lang' => !empty($user->lang) ? $user->lang : jApp::config()->locale,
            'url' => jUrl::getFull('view~projectDownload:file'),
        ));
        if ($added) {
            jLog::log('Project '.$repository.'~'.$projectKey.' requested by '.$login.' (zip being prepared)', 'lizmapadmin');
            $notifier->sendRequestToAdmin($repository, $projectKey, $title, $login, $email, false);
        }
        jMessage::add(jLocale::get('view~projectdownload.'.($added ? 'queued.message' : 'queued.again'), array($title)), 'info');

        return $this->back($repository);
    }

    /**
     * Download link sent by e-mail.
     *
     * @return jResponse
     */
    public function file()
    {
        $store = new ZipStore();
        $token = (string) $this->param('token');
        $link = $store->token($token);
        if (!$link) {
            jMessage::add(jLocale::get('view~projectdownload.error.link'), 'error');

            return $this->back('');
        }
        if (!jAuth::isConnected()) {
            return $this->loginRedirect(jUrl::getFull('view~projectDownload:file', array('token' => $token)));
        }
        $user = jAuth::getUserSession();
        $repository = $link['repository'];
        $projectKey = $link['project'];
        if ($user->login !== $link['login']
            || !jAcl2::check('lizmap.tools.project.download', $repository)
            || !$this->project($repository, $projectKey)) {
            jMessage::add(jLocale::get('view~projectdownload.error.link'), 'error');

            return $this->back('');
        }
        if (!$store->manifest($repository, $projectKey)) {
            jMessage::add(jLocale::get('view~projectdownload.error.gone'), 'error');

            return $this->back($repository);
        }
        jLog::log('Project '.$repository.'~'.$projectKey.' downloaded by '.$user->login.' (link)', 'lizmapadmin');

        return $this->send($store, $repository, $projectKey);
    }

    /**
     * State of the download of projects, for the download buttons (home
     * page, information of the project on the map): queued, building (with
     * its progress), ready (size and date of the zip) or none.
     *
     * @urlparam string $items keys "repository~project", separated by commas
     *
     * @return jResponseJson
     */
    public function status()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $rep->data = array();
        $store = new ZipStore();
        if (!$store->isUsable()) {
            return $rep;
        }
        $locale = jApp::config()->locale;
        $notifier = new Notifier();
        $items = array_slice(array_unique(explode(',', (string) $this->param('items'))), 0, 100);
        foreach ($items as $item) {
            $parts = explode('~', $item, 2);
            if (count($parts) !== 2
                || !jAcl2::check('lizmap.tools.project.download', $parts[0])
                || !$this->project($parts[0], $parts[1])) {
                continue;
            }
            $status = $store->status($parts[0], $parts[1]);
            switch ($status['state']) {
                case 'queued':
                    $status['label'] = jLocale::get('view~projectdownload.status.queued');
                    $status['title'] = jLocale::get('view~projectdownload.status.queued.title');

                    break;

                case 'building':
                    $percent = (int) floor($status['progress'] * 100);
                    $status['label'] = $percent.' %';
                    $status['title'] = jLocale::get('view~projectdownload.status.building.title', array($percent));

                    break;

                case 'ready':
                    $status['label'] = '';
                    $status['title'] = jLocale::get('view~projectdownload.status.ready.title', array(
                        $notifier->size($status['size'], $locale),
                        date('Y-m-d H:i', (int) $status['built']),
                    ));

                    break;

                default:
                    $status['label'] = '';
                    $status['title'] = jLocale::get('view~projectdownload.button.title');
            }
            $rep->data[$item] = $status;
        }

        return $rep;
    }

    /**
     * @param string $repository
     * @param string $projectKey
     *
     * @return null|object the project, if the user may see it
     */
    protected function project($repository, $projectKey)
    {
        if ($repository === '' || $projectKey === '') {
            return null;
        }

        try {
            $project = lizmap::getProject($repository.'~'.$projectKey);
        } catch (UnknownLizmapProjectException $e) {
            return null;
        }

        return ($project && $project->checkAcl()) ? $project : null;
    }

    /**
     * Sends the zip: by nginx when the site is served by nginx (internal
     * location ZipStore::ACCEL_LOCATION), by PHP otherwise.
     *
     * @param ZipStore $store
     * @param string   $repository
     * @param string   $projectKey
     *
     * @return jResponseBinary
     */
    protected function send($store, $repository, $projectKey)
    {
        $store->markDownloaded($repository, $projectKey);

        /** @var jResponseBinary $rep */
        $rep = $this->getResponse('binary');
        $rep->doDownload = true;
        $rep->outputFileName = $projectKey.'.zip';
        $rep->mimeType = 'application/zip';
        if (stripos($_SERVER['SERVER_SOFTWARE'] ?? '', 'nginx') !== false) {
            $rep->content = '';
            $rep->addHttpHeader('X-Accel-Redirect', $store->accelUri($repository, $projectKey));
        } else {
            $rep->fileName = $store->zipPath($repository, $projectKey);
        }

        return $rep;
    }

    /**
     * Back to the home page (projects of the repository), where the message
     * is shown. From the map, the button opens a new tab: the map stays.
     *
     * @param string $repository
     *
     * @return jResponseRedirect
     */
    protected function back($repository)
    {
        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = 'view~default:index';
        if ($repository !== '') {
            $rep->params = array('repository' => $repository);
        }

        return $rep;
    }

    /**
     * @param string $returnUrl
     *
     * @return jResponseRedirect
     */
    protected function loginRedirect($returnUrl)
    {
        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = 'jcommunity~login:index';
        $rep->params = array('auth_url_return' => $returnUrl);

        return $rep;
    }

    /**
     * @param int    $status  HTTP status
     * @param string $message key of the message, in view~projectdownload
     *
     * @return jResponseText
     */
    protected function error($status, $message)
    {
        /** @var jResponseText $rep */
        $rep = $this->getResponse('text');
        $rep->setHttpStatus($status, 'Project download');
        $rep->content = jLocale::get('view~projectdownload.'.$message);

        return $rep;
    }
}
