<?php

use Lizmap\Project\UnknownLizmapProjectException;

/**
 * Download of a QGIS project, for the users who have the right "Download
 * the QGIS project" (lizmap.tools.project.download) on its repository.
 *
 * The project (.qgs) and its Lizmap configuration (.qgs.cfg) are sent in a
 * zip file, or the .qgs alone when the zip extension of PHP is missing.
 * A project whose data sources contain a password is never sent.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class projectDownloadCtrl extends jController
{
    /**
     * @return jResponseBinary|jResponseText
     */
    public function index()
    {
        $repository = (string) $this->param('repository');
        $projectKey = (string) $this->param('project');

        $project = null;
        if ($repository !== '' && $projectKey !== '') {
            try {
                $project = lizmap::getProject($repository.'~'.$projectKey);
            } catch (UnknownLizmapProjectException $e) {
                $project = null;
            }
        }
        if (!$project || !$project->checkAcl()) {
            return $this->error(404, 'error.project');
        }

        if (!jAcl2::check('lizmap.tools.project.download', $repository)) {
            return $this->error(403, 'error.right');
        }

        $qgsPath = $project->getQgisPath();
        if (!$qgsPath || !is_file($qgsPath) || !is_readable($qgsPath)) {
            return $this->error(404, 'error.project');
        }

        if (self::hasPassword(file_get_contents($qgsPath))) {
            jLog::log(
                'Download of the project '.$repository.'~'.$projectKey.' refused: a data source contains a password',
                'lizmapadmin'
            );

            return $this->error(409, 'error.password');
        }

        $user = jAuth::getUserSession();
        jLog::log(
            'Project '.$repository.'~'.$projectKey.' downloaded by '.($user ? $user->login : 'anonymous'),
            'lizmapadmin'
        );

        /** @var jResponseBinary $rep */
        $rep = $this->getResponse('binary');
        $rep->doDownload = true;

        $zipPath = $this->buildZip($qgsPath, $projectKey);
        if ($zipPath) {
            $rep->fileName = $zipPath;
            $rep->deleteFileAfterSending = true;
            $rep->outputFileName = $projectKey.'.zip';
            $rep->mimeType = 'application/zip';
        } else {
            $rep->fileName = $qgsPath;
            $rep->outputFileName = $projectKey.'.qgs';
            $rep->mimeType = 'application/xml';
        }

        return $rep;
    }

    /**
     * Indicates if a data source of the project contains a password (in a
     * connection string, or in an XML option named "password"). Connections
     * through a PostgreSQL service or a QGIS authentication configuration
     * (authcfg) have none.
     *
     * @param string $qgs content of the .qgs file
     *
     * @return bool
     */
    public static function hasPassword($qgs)
    {
        $patterns = array(
            // In a connection string: password='…', password="…", or
            // password=… (also XML-escaped: &apos;…&apos;, &quot;…&quot;).
            "/\\bpassword\\s*=\\s*(?:'[^']+'|\"[^\"]+\"|&apos;(?:(?!&apos;).)+&apos;|&quot;(?:(?!&quot;).)+&quot;|[^\\s'\"&<]+)/i",
            // In an XML option: <Option name="password" value="…"/>.
            '/name="password"[^>]*\svalue="[^"]+"/i',
        );
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $qgs)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Zip of the project and of its Lizmap configuration, in a temporary
     * file deleted after sending.
     *
     * @param string $qgsPath
     * @param string $projectKey
     *
     * @return null|string path of the zip, null when it cannot be built
     */
    protected function buildZip($qgsPath, $projectKey)
    {
        if (!class_exists('ZipArchive')) {
            return null;
        }
        $zipPath = tempnam(jApp::tempPath(), 'lizmap-project-');
        if (!$zipPath) {
            return null;
        }
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::OVERWRITE) !== true) {
            @unlink($zipPath);

            return null;
        }
        $zip->addFile($qgsPath, $projectKey.'.qgs');
        if (is_file($qgsPath.'.cfg')) {
            $zip->addFile($qgsPath.'.cfg', $projectKey.'.qgs.cfg');
        }
        if (!$zip->close()) {
            @unlink($zipPath);

            return null;
        }

        return $zipPath;
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
