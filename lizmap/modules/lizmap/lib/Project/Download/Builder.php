<?php

namespace Lizmap\Project\Download;

/**
 * Builds the zips of the projects waiting in the queue of the ZipStore,
 * one at a time, and sends the download links (command project:zip:build,
 * run every minute by cron, at low priority: nice, ionice).
 *
 * For each project waiting: the zip is built if it is missing or not up to
 * date, then every user who asked receives a link by e-mail. On failure
 * (project removed, password in a data source, not enough disk space…),
 * the users and the administrator are told, and the requests are removed.
 * Requests made while a zip is built stay in the queue for the next run.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class Builder
{
    /** @var ZipStore */
    protected $store;

    /** @var Notifier */
    protected $notifier;

    /** @var callable */
    protected $log;

    /** @var null|callable */
    protected $progress;

    /**
     * @param ZipStore $store
     * @param Notifier $notifier
     * @param callable      $log      receives a line of text
     * @param null|callable $progress receives the progress of each zip:
     *                                ('start', name, files, bytes),
     *                                ('advance', ratio from 0 to 1), ('end')
     */
    public function __construct($store, $notifier, $log, $progress = null)
    {
        $this->store = $store;
        $this->notifier = $notifier;
        $this->log = $log;
        $this->progress = $progress;
    }

    /**
     * Cleans the store, then handles the queue.
     *
     * @return int number of projects handled, -1 if another builder runs
     */
    public function run()
    {
        $lock = $this->store->lock();
        if (!$lock) {
            ($this->log)('Another builder is running.');

            return -1;
        }

        try {
            // A builder stopped while building leaves its progress.
            $this->store->clearProgress();
            foreach ($this->store->cleanup() as $deleted) {
                ($this->log)('Deleted (not downloaded for '.ZipStore::KEEP_DAYS.' days): '.$deleted);
            }
            $count = 0;
            foreach ($this->store->queue() as $entry) {
                $this->handle($entry);
                ++$count;
            }

            return $count;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /**
     * @param array $entry queue entry of a project
     */
    protected function handle($entry)
    {
        $repository = $entry['repository'];
        $projectKey = $entry['project'];
        $requests = $entry['requests'];
        $logins = array_map(function ($request) {
            return $request['login'];
        }, $requests);
        $title = $projectKey;

        try {
            $project = \lizmap::getProject($repository.'~'.$projectKey);
            if (!$project) {
                throw new \Exception('The project does not exist any more');
            }
            $title = $project->getTitle() ?: $projectKey;
            $qgsPath = $project->getQgisPath();
            if (!$qgsPath || !is_readable($qgsPath)) {
                throw new \Exception('The project file cannot be read');
            }
            $qgs = file_get_contents($qgsPath);
            if (ProjectPackage::hasPassword($qgs)) {
                throw new \Exception('A data source of the project contains a password');
            }
            if (!class_exists('ZipArchive')) {
                throw new \Exception('The zip extension of PHP is missing (package php-zip)');
            }

            $package = new ProjectPackage($qgsPath, $qgs);
            $package->collect($projectKey);
            $fingerprint = $package->fingerprint();

            $manifest = $this->store->manifest($repository, $projectKey);
            if (!$manifest || ($manifest['fingerprint'] ?? '') !== $fingerprint) {
                $start = microtime(true);
                ($this->log)('Building '.$repository.'~'.$projectKey.' ('.count($package->files).' files, '.round($package->totalSize() / 1048576).' MB)');
                $this->notifyProgress('start', $repository.'~'.$projectKey, count($package->files) + 1, $package->totalSize());
                $this->store->setProgress($repository, $projectKey, 0);

                try {
                    $manifest = $this->store->build(
                        $repository,
                        $projectKey,
                        $package,
                        $this->readme($package, $title, $projectKey),
                        \jLocale::get('view~projectdownload.readme.file'),
                        $this->progressCallback($repository, $projectKey)
                    );
                } finally {
                    $this->notifyProgress('end');
                }
                ($this->log)('Built in '.round(microtime(true) - $start).' s: '.round($manifest['size'] / 1048576).' MB');
            }

            foreach ($requests as $request) {
                $token = $this->store->createToken($repository, $projectKey, $request['login']);
                $sent = $this->notifier->sendReady($request, $title, $token, $manifest);
                ($this->log)('Link '.($sent ? 'sent' : 'NOT sent').' to '.$request['login']);
            }
        } catch (\Exception $e) {
            ($this->log)('Failed '.$repository.'~'.$projectKey.': '.$e->getMessage());
            \jLog::log('Project download: zip of '.$repository.'~'.$projectKey.' failed: '.$e->getMessage(), 'lizmapadmin');
            $this->notifier->sendFailedToAdmin($repository, $projectKey, $title, $e->getMessage());
            foreach ($requests as $request) {
                $this->notifier->sendFailedToUser($request, $title);
            }
        }

        $this->store->dequeue($repository, $projectKey, $logins);
    }

    /**
     * @param mixed ...$args event and its data, see the constructor
     */
    protected function notifyProgress(...$args)
    {
        if ($this->progress) {
            ($this->progress)(...$args);
        }
    }

    /**
     * Progress of the writing of a zip: given to the progress callable of
     * the command, and written in the queue for the download buttons, at
     * most once a second.
     *
     * @param string $repository
     * @param string $projectKey
     *
     * @return callable receives a ratio from 0 to 1
     */
    protected function progressCallback($repository, $projectKey)
    {
        $lastWrite = 0;
        $lastPercent = -1;

        return function ($ratio) use ($repository, $projectKey, &$lastWrite, &$lastPercent) {
            $this->notifyProgress('advance', $ratio);
            $percent = (int) floor($ratio * 100);
            if ($percent !== $lastPercent && (microtime(true) - $lastWrite >= 1 || $percent >= 100)) {
                $lastPercent = $percent;
                $lastWrite = microtime(true);
                $this->store->setProgress($repository, $projectKey, $ratio);
            }
        };
    }

    /**
     * README of the zip: what it contains, the files moved to external/,
     * the layers not included and the files not found.
     *
     * @param ProjectPackage $package
     * @param string         $title
     * @param string         $projectKey
     *
     * @return string
     */
    protected function readme($package, $title, $projectKey)
    {
        $get = function ($key, $args = array()) {
            return \jLocale::get('view~projectdownload.readme.'.$key, $args);
        };

        $lines = array($get('title', array($title)), '', $get('intro', array($projectKey.'.qgs')), '');
        $lines[] = $get('files', array(count($package->files) + 1));
        $lines[] = '  '.$projectKey.'.qgs';
        foreach (array_keys($package->files) as $name) {
            $lines[] = '  '.$name;
        }
        if ($package->moved) {
            $lines[] = '';
            $lines[] = $get('moved');
            foreach ($package->moved as $reference => $zipPath) {
                $lines[] = '  '.$reference.' -> '.$zipPath;
            }
        }
        if ($package->notIncluded) {
            $lines[] = '';
            $lines[] = $get('notincluded');
            foreach ($package->notIncluded as $name => $provider) {
                $lines[] = '  '.$name.' ('.$provider.')';
            }
        }
        if ($package->missing) {
            $lines[] = '';
            $lines[] = $get('missing');
            foreach ($package->missing as $name => $reference) {
                $lines[] = '  '.$name.' : '.$reference;
            }
        }

        return implode("\r\n", $lines)."\r\n";
    }
}
