<?php

namespace Lizmap\Commands;

use Jelix\FakeServerConf\ApacheMod;
use Jelix\Scripts\ModuleCommandAbstract;
use Lizmap\Project\Download\Builder;
use Lizmap\Project\Download\Notifier;
use Lizmap\Project\Download\ZipStore;
use Symfony\Component\Console\Helper\ProgressBar;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Builds the zips of the projects asked for download, and sends the
 * download links by e-mail (see Lizmap\Project\Download\Builder).
 *
 * To run every minute by cron, as the user of the web server, at low
 * priority, e.g. in /etc/cron.d/lizmap-project-zips:
 *
 *     * * * * * www-data nice -n 19 ionice -c3 php /var/www/lizmap/lizmap/console.php project:zip:build --quiet
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class ProjectZipBuild extends ModuleCommandAbstract
{
    protected function configure()
    {
        $this
            ->setName('project:zip:build')
            ->setDescription('Build the zips of the projects asked for download and send the download links')
            ->setHelp('Run every minute by cron, as the user of the web server (www-data). The zips are stored in the folder "'.ZipStore::FOLDER_NAME.'" next to the root folder of the repositories (shown in the administration, Lizmap configuration, Projects).')
        ;
    }

    /**
     * @param int|float $bytes
     *
     * @return string
     */
    protected static function size($bytes)
    {
        $units = array('B', 'KB', 'MB', 'GB', 'TB');
        $unit = 0;
        while ($bytes >= 1024 && $unit < count($units) - 1) {
            $bytes /= 1024;
            ++$unit;
        }

        return ($unit ? number_format($bytes, 1) : (string) (int) $bytes).' '.$units[$unit];
    }

    protected function execute(InputInterface $input, OutputInterface $output)
    {
        $req = new \jClassicRequest();
        $fakeServer = new ApacheMod(\jApp::wwwPath(), '/index.php');
        $fakeServer->setHttpRequest($req->getServerURI());

        $store = new ZipStore();
        if ($store->getDir() === '') {
            $output->writeln('<error>No root folder of the repositories is set (Lizmap configuration, Projects): no project download.</error>');

            return 1;
        }
        if (!$store->isUsable()) {
            $output->writeln('<error>The folder '.$store->getDir().' does not exist or cannot be written by this user.</error>');

            return 1;
        }

        // Progress bar of each zip, when the command is run by hand (not
        // with --quiet, as by cron).
        $bar = null;
        $progress = function ($event, ...$data) use ($output, &$bar) {
            if ($output->isQuiet()) {
                return;
            }
            if ($event === 'start') {
                list($name, $files, $bytes) = $data;
                $bar = new ProgressBar($output, 100);
                $bar->setFormat(' %message% [%bar%] %percent:3s%% %elapsed:6s%');
                $bar->setMessage($name.', '.$files.' files, '.self::size($bytes));
                $bar->start();
            } elseif ($event === 'advance' && $bar) {
                $bar->setProgress((int) floor($data[0] * 100));
            } elseif ($event === 'end' && $bar) {
                $bar->finish();
                $output->writeln('');
                $bar = null;
            }
        };

        $builder = new Builder($store, new Notifier(), function ($line) use ($output) {
            $output->writeln($line);
        }, $progress);
        $count = $builder->run();
        if ($count > 0) {
            $output->writeln($count.' project(s) handled.');
        }

        return 0;
    }
}
