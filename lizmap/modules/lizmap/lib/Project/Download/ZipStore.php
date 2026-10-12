<?php

namespace Lizmap\Project\Download;

/**
 * Storage of the zips of the QGIS projects prepared for download, and of
 * the requests and download links around them, in one folder outside the
 * web site: "project-zips" next to the root folder of the repositories
 * (defaultDir(): /srv/webgis-projects/ gives /srv/project-zips/), shown in
 * the administration and not editable; none without root folder, then
 * projects cannot be downloaded. It must exist and be writable by
 * the user of the web server (www-data), which also runs the command
 * project:zip:build (cron).
 *
 *     /srv/project-zips/
 *       projects/<repository>/<project>.zip    zip of the project
 *       projects/<repository>/<project>.json   manifest: fingerprint, size, dates
 *       queue/<repository>~<project>.json   requests waiting for the zip
 *       tokens/<sha256 of the token>.json   download links sent by e-mail
 *       .lock                         one builder at a time
 *
 * A zip is up to date when the fingerprint of its manifest is the one of
 * the project now (ProjectPackage::fingerprint()). It is written in a
 * temporary file of the same folder, then renamed: a half-built zip is
 * never sent. A zip not downloaded for KEEP_DAYS days is deleted, and a
 * download link is valid LINK_DAYS days.
 *
 * Files are sent by nginx (header X-Accel-Redirect to the internal
 * location ACCEL_LOCATION, aliased to the folder in the nginx configuration):
 * PHP only checks the rights, no PHP process is busy during the download.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class ZipStore
{
    /** Name of the folder of the zips, next to the root of the repositories. */
    public const FOLDER_NAME = 'project-zips';

    /** Internal location of nginx aliased to the folder of the zips. */
    public const ACCEL_LOCATION = '/lizmap-project-zips/';

    /** Validity of a download link, in days. */
    public const LINK_DAYS = 7;

    /** Zips not downloaded for this number of days are deleted. */
    public const KEEP_DAYS = 15;

    /** @var string */
    protected $dir;

    /**
     * @param null|string $dir folder of the zips (defaultDir() by default;
     *                         other folders for the tests)
     */
    public function __construct($dir = null)
    {
        $this->dir = rtrim($dir ?? self::defaultDir(), '/');
    }

    /**
     * Folder of the zips: FOLDER_NAME in the parent folder of the root folder
     * of the repositories (rootRepositories of the Lizmap configuration),
     * e.g. /srv/webgis-projects/ gives /srv/project-zips. Empty when no root
     * folder is set: no project download then (isUsable() is false).
     *
     * @param null|string $rootRepositories root folder of the repositories
     *                                      (read in the configuration if null)
     *
     * @return string
     */
    public static function defaultDir($rootRepositories = null)
    {
        if ($rootRepositories === null) {
            $rootRepositories = (string) \lizmap::getServices()->getRootRepositories();
        }
        $root = rtrim(str_replace('\\', '/', (string) $rootRepositories), '/');
        if ($root === '') {
            return '';
        }
        $parent = rtrim(dirname($root), '/');

        return $parent.'/'.self::FOLDER_NAME;
    }

    /**
     * The folder of the zips of this site exists and can be written: the
     * download buttons are shown only then (an error never reaches the
     * template).
     *
     * @return bool
     */
    public static function folderReady()
    {
        try {
            return (new self())->isUsable();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * nginx configuration sending the zips (internal location).
     *
     * @return string
     */
    public function nginxLocation()
    {
        return 'location ^~ '.self::ACCEL_LOCATION." {\n    internal;\n    alias ".$this->dir."/;\n}";
    }

    /**
     * @return string
     */
    public function getDir()
    {
        return $this->dir;
    }

    /**
     * The folder exists and can be written.
     *
     * @return bool
     */
    public function isUsable()
    {
        return $this->dir !== '' && is_dir($this->dir) && is_writable($this->dir);
    }

    /**
     * Name usable as a file name (repository and project keys).
     *
     * @param string $key
     *
     * @return string
     */
    protected static function safe($key)
    {
        $key = (string) $key;
        $safe = preg_replace('/[^A-Za-z0-9_.\-]/', '_', $key);
        if ($safe === $key && $safe !== '' && $safe[0] !== '.') {
            return $safe;
        }

        // "my project" and "my_project" must not share a zip.
        return ltrim($safe, '.').'-'.substr(sha1($key), 0, 8);
    }

    /**
     * @param string $repository
     * @param string $project
     *
     * @return string path of the zip of a project
     */
    public function zipPath($repository, $project)
    {
        return $this->dir.'/projects/'.self::safe($repository).'/'.self::safe($project).'.zip';
    }

    /**
     * @param string $repository
     * @param string $project
     *
     * @return string path of the manifest of a project
     */
    public function manifestPath($repository, $project)
    {
        return $this->dir.'/projects/'.self::safe($repository).'/'.self::safe($project).'.json';
    }

    /**
     * URI for nginx (X-Accel-Redirect) of the zip of a project.
     *
     * @param string $repository
     * @param string $project
     *
     * @return string
     */
    public function accelUri($repository, $project)
    {
        return self::ACCEL_LOCATION.'projects/'.rawurlencode(self::safe($repository)).'/'.rawurlencode(self::safe($project)).'.zip';
    }

    /**
     * @param string $repository
     * @param string $project
     *
     * @return null|array the manifest, null if there is no zip
     */
    public function manifest($repository, $project)
    {
        if (!is_file($this->zipPath($repository, $project))) {
            return null;
        }
        $data = self::readJson($this->manifestPath($repository, $project));

        return is_array($data) ? $data : null;
    }

    /**
     * The zip of the project exists and has this fingerprint.
     *
     * @param string $repository
     * @param string $project
     * @param string $fingerprint
     *
     * @return bool
     */
    public function isReady($repository, $project, $fingerprint)
    {
        $manifest = $this->manifest($repository, $project);

        return $manifest && ($manifest['fingerprint'] ?? '') === $fingerprint;
    }

    /**
     * Records a download of the zip (it is then kept KEEP_DAYS more days).
     *
     * @param string $repository
     * @param string $project
     */
    public function markDownloaded($repository, $project)
    {
        $this->updateJson($this->manifestPath($repository, $project), function ($data) {
            if (!is_array($data)) {
                return null;
            }
            $data['lastDownload'] = time();
            $data['downloads'] = ($data['downloads'] ?? 0) + 1;

            return $data;
        });
    }

    // ---------- requests ----------

    /**
     * @param string $repository
     * @param string $project
     *
     * @return string path of the queue entry of a project
     */
    protected function queuePath($repository, $project)
    {
        return $this->dir.'/queue/'.self::safe($repository).'~'.self::safe($project).'.json';
    }

    /**
     * Adds a request for the zip of a project. Several requests for the same
     * project make one entry; a user asking twice is counted once.
     *
     * @param string $repository
     * @param string $project
     * @param array  $request    login, email, lang, url (address of the
     *                           download page, without the token)
     *
     * @return bool false when the user had already asked
     */
    public function enqueue($repository, $project, $request)
    {
        $added = false;
        $this->ensureDir($this->dir.'/queue');
        $this->updateJson($this->queuePath($repository, $project), function ($data) use ($repository, $project, $request, &$added) {
            if (!is_array($data)) {
                $data = array('repository' => $repository, 'project' => $project, 'created' => time(), 'requests' => array());
            }
            foreach ($data['requests'] as $existing) {
                if ($existing['login'] === $request['login']) {
                    return $data;
                }
            }
            $request['date'] = time();
            $data['requests'][] = $request;
            $added = true;

            return $data;
        });

        return $added;
    }

    /**
     * Projects waiting for their zip, oldest first.
     *
     * @return array[] queue entries
     */
    public function queue()
    {
        $entries = array();
        foreach (glob($this->dir.'/queue/*.json') ?: array() as $path) {
            $data = self::readJson($path);
            if (is_array($data) && !empty($data['requests'])) {
                $entries[] = $data;
            }
        }
        usort($entries, function ($a, $b) {
            return ($a['created'] ?? 0) <=> ($b['created'] ?? 0);
        });

        return $entries;
    }

    /**
     * Removes handled requests from the queue (requests made meanwhile stay).
     *
     * @param string   $repository
     * @param string   $project
     * @param string[] $logins     users whose request has been handled
     */
    public function dequeue($repository, $project, $logins)
    {
        $path = $this->queuePath($repository, $project);
        $this->updateJson($path, function ($data) use ($logins) {
            if (!is_array($data)) {
                return null;
            }
            $data['requests'] = array_values(array_filter($data['requests'], function ($request) use ($logins) {
                return !in_array($request['login'], $logins, true);
            }));

            return count($data['requests']) ? $data : null;
        });
    }

    /**
     * The user is waiting for the zip of the project.
     *
     * @param string $repository
     * @param string $project
     * @param string $login
     *
     * @return bool
     */
    public function isQueued($repository, $project, $login)
    {
        $data = self::readJson($this->queuePath($repository, $project));
        foreach (is_array($data) ? $data['requests'] : array() as $request) {
            if ($request['login'] === $login) {
                return true;
            }
        }

        return false;
    }

    /**
     * Records the progress of the preparation of the zip of a project in its
     * queue entry (shown on the download buttons), or removes it (null).
     *
     * @param string     $repository
     * @param string     $project
     * @param null|float $ratio      0 to 1
     */
    public function setProgress($repository, $project, $ratio)
    {
        $this->updateJson($this->queuePath($repository, $project), function ($data) use ($ratio) {
            if (!is_array($data)) {
                return null;
            }
            if ($ratio === null) {
                unset($data['progress']);
            } else {
                $data['progress'] = round(max(0, min(1, $ratio)), 3);
            }

            return $data;
        });
    }

    /**
     * Removes the progress left in the queue by a builder that stopped
     * (called by the builder while it holds the lock).
     */
    public function clearProgress()
    {
        foreach ($this->queue() as $entry) {
            if (isset($entry['progress'])) {
                $this->setProgress($entry['repository'], $entry['project'], null);
            }
        }
    }

    /**
     * State of the download of a project, for the download buttons.
     *
     * @param string $repository
     * @param string $project
     *
     * @return array state (none, queued, building or ready), progress (0 to
     *               1, building), size and built (ready)
     */
    public function status($repository, $project)
    {
        $entry = self::readJson($this->queuePath($repository, $project));
        if (is_array($entry) && !empty($entry['requests'])) {
            if (isset($entry['progress'])) {
                return array('state' => 'building', 'progress' => (float) $entry['progress']);
            }

            return array('state' => 'queued');
        }
        $manifest = $this->manifest($repository, $project);
        if ($manifest) {
            return array('state' => 'ready', 'size' => $manifest['size'] ?? 0, 'built' => $manifest['built'] ?? 0);
        }

        return array('state' => 'none');
    }

    // ---------- download links ----------

    /**
     * New download link for a user.
     *
     * @param string $repository
     * @param string $project
     * @param string $login
     *
     * @return string the token (to put in the link)
     */
    public function createToken($repository, $project, $login)
    {
        $this->ensureDir($this->dir.'/tokens');
        $token = bin2hex(random_bytes(24));
        self::writeJson($this->tokenPath($token), array(
            'repository' => $repository,
            'project' => $project,
            'login' => $login,
            'expires' => time() + self::LINK_DAYS * 86400,
        ));

        return $token;
    }

    /**
     * @param string $token
     *
     * @return null|array repository, project, login, expires; null if the
     *                    link is unknown or expired
     */
    public function token($token)
    {
        if (!preg_match('/^[0-9a-f]{48}$/', (string) $token)) {
            return null;
        }
        $data = self::readJson($this->tokenPath($token));
        if (!is_array($data) || ($data['expires'] ?? 0) < time()) {
            return null;
        }

        return $data;
    }

    /**
     * @param string $token
     *
     * @return string
     */
    protected function tokenPath($token)
    {
        // Only the hash of the token is stored: the folder does not give
        // the links.
        return $this->dir.'/tokens/'.hash('sha256', $token).'.json';
    }

    // ---------- building ----------

    /**
     * Lock so that only one builder runs at a time.
     *
     * @return null|resource the lock (keep it open), null if another
     *                       builder runs
     */
    public function lock()
    {
        $handle = @fopen($this->dir.'/.lock', 'c');
        if (!$handle) {
            return null;
        }
        if (!flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return null;
        }

        return $handle;
    }

    /**
     * Builds the zip of a project in a temporary file, then puts it in place
     * with its manifest.
     *
     * @param string         $repository
     * @param string         $project
     * @param ProjectPackage $package    collected package
     * @param string         $readme     README of the zip
     * @param string         $readmeName name of the README file
     *
     * @param null|callable $progress   progress of the writing of the zip, from 0 to 1
     *
     * @return array the manifest
     *
     * @throws \Exception
     */
    public function build($repository, $project, $package, $readme, $readmeName, $progress = null)
    {
        $zipPath = $this->zipPath($repository, $project);
        $this->ensureDir(dirname($zipPath));

        $needed = $package->totalSize();
        $free = @disk_free_space(dirname($zipPath));
        if ($free !== false && $free < $needed * 1.05) {
            throw new \Exception(sprintf(
                'Not enough disk space in %s: %d MB needed, %d MB free',
                dirname($zipPath),
                ceil($needed / 1048576),
                floor($free / 1048576)
            ));
        }

        $tmpPath = dirname($zipPath).'/.'.basename($zipPath).'.'.getmypid().'.tmp';
        @unlink($tmpPath);
        if (!$package->buildZip($tmpPath, $project, $readme, $readmeName, $progress)) {
            @unlink($tmpPath);

            throw new \Exception('The zip could not be written in '.dirname($zipPath));
        }
        if (!@rename($tmpPath, $zipPath)) {
            @unlink($tmpPath);

            throw new \Exception('The zip could not be moved to '.$zipPath);
        }
        $manifest = array(
            'repository' => $repository,
            'project' => $project,
            'fingerprint' => $package->fingerprint(),
            'built' => time(),
            'size' => filesize($zipPath),
            'files' => count($package->files) + 1,
            'lastDownload' => null,
            'downloads' => 0,
        );
        self::writeJson($this->manifestPath($repository, $project), $manifest);

        return $manifest;
    }

    /**
     * Deletes the zips not downloaded for KEEP_DAYS days (or never
     * downloaded and built more than KEEP_DAYS days ago), the expired links
     * and the temporary files left by an interrupted build.
     *
     * @return string[] deleted zips
     */
    public function cleanup()
    {
        $deleted = array();
        $limit = time() - self::KEEP_DAYS * 86400;
        foreach (glob($this->dir.'/projects/*/*.json') ?: array() as $manifestPath) {
            $data = self::readJson($manifestPath);
            $last = 0;
            if (is_array($data)) {
                $last = !empty($data['lastDownload']) ? $data['lastDownload'] : ($data['built'] ?? 0);
            }
            if ($last < $limit) {
                $zip = substr($manifestPath, 0, -5).'.zip';
                @unlink($zip);
                @unlink($manifestPath);
                $deleted[] = $zip;
            }
        }
        foreach (glob($this->dir.'/tokens/*.json') ?: array() as $tokenPath) {
            $data = self::readJson($tokenPath);
            if (!is_array($data) || ($data['expires'] ?? 0) < time()) {
                @unlink($tokenPath);
            }
        }
        // Files left by an interrupted build or write.
        $old = time() - 86400;
        foreach (array_merge(glob($this->dir.'/projects/*/.*.tmp') ?: array(), glob($this->dir.'/{projects/*,queue,tokens}/*.part', GLOB_BRACE) ?: array()) as $tmp) {
            if (@filemtime($tmp) < $old) {
                @unlink($tmp);
            }
        }
        // Lock files of JSON files that no longer exist, when nobody holds them.
        foreach (glob($this->dir.'/{projects/*,queue}/*.json.lock', GLOB_BRACE) ?: array() as $lockPath) {
            if (is_file(substr($lockPath, 0, -5)) || @filemtime($lockPath) >= $old) {
                continue;
            }
            $lock = @fopen($lockPath, 'c');
            if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
                if (!is_file(substr($lockPath, 0, -5))) {
                    @unlink($lockPath);
                }
                flock($lock, LOCK_UN);
            }
            if ($lock) {
                fclose($lock);
            }
        }

        return $deleted;
    }

    // ---------- files ----------

    /**
     * @param string $dir
     */
    protected function ensureDir($dir)
    {
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \Exception('The folder '.$dir.' cannot be created');
        }
    }

    /**
     * @param string $path
     *
     * @return mixed
     */
    protected static function readJson($path)
    {
        if (!is_file($path)) {
            return null;
        }
        $content = @file_get_contents($path);

        return $content === false ? null : json_decode($content, true);
    }

    /**
     * @param string $path
     * @param mixed  $data
     */
    protected static function writeJson($path, $data)
    {
        $tmp = $path.'.'.getmypid().'.part';
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        rename($tmp, $path);
    }

    /**
     * Reads, changes and writes a JSON file under an exclusive lock (the
     * web server and the builder change the same files).
     *
     * @param string   $path
     * @param callable $change receives the data (null if none), returns the
     *                         new data, or null to delete the file
     */
    protected function updateJson($path, $change)
    {
        $this->ensureDir(dirname($path));
        $lock = fopen($path.'.lock', 'c');
        if (!$lock) {
            throw new \Exception('The file '.$path.'.lock cannot be opened');
        }
        flock($lock, LOCK_EX);

        try {
            $data = $change(self::readJson($path));
            if ($data === null) {
                @unlink($path);
            } else {
                self::writeJson($path, $data);
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
            if (!is_file($path)) {
                @unlink($path.'.lock');
            }
        }
    }
}
