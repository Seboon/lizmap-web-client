<?php

namespace Lizmap\Project\Download;

/**
 * Package of a QGIS project for its download, in a zip file: the whole
 * folder of the project (data, media, thumbnail, Lizmap configuration…),
 * without the other projects of the folder nor temporary files, and the
 * files the project uses outside its folder (file layers with their
 * companion files, rasters, SVG, images, styles).
 *
 * The files keep their place relative to the project, so that the project
 * opens as is in QGIS Desktop. Files outside the folder of the project go
 * in "external/", and the project copy put in the zip points to them.
 * Database and web layers (PostgreSQL, WMS, WFS…) are not files: they are
 * listed in the README of the zip.
 *
 * The zip is built in the background (see ZipStore and the command
 * project:zip:build), never during a web request: a project with large
 * rasters takes minutes to zip.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class ProjectPackage
{
    /** Folder in the zip of the files outside the folder of the project. */
    public const EXTERNAL_DIR = 'external/';

    /** Providers of layers stored in files. */
    protected const FILE_PROVIDERS = array('ogr', 'gdal', 'delimitedtext', 'spatialite');

    /** Providers without data source to package. */
    protected const IGNORED_PROVIDERS = array('memory', 'virtual', '');

    /** Extensions of files referenced outside the data sources (symbols, images, styles). */
    protected const RESOURCE_EXTENSIONS = array('svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'qml', 'sld', 'qpt');

    /** Files not worth compressing again. */
    protected const STORED_EXTENSIONS = array('jpg', 'jpeg', 'png', 'gif', 'webp', 'jp2', 'ecw', 'sid', 'zip', 'gz', 'mbtiles', 'laz');

    /** @var string real path of the folder of the project, with a trailing slash */
    protected $projectDir;

    /** @var string */
    protected $qgsPath;

    /** @var \DOMDocument */
    protected $dom;

    /** @var array<string, string> path in the zip => real path */
    public $files = array();

    /** @var array<string, string> original reference => path in the zip, for the files moved to external/ */
    public $moved = array();

    /** @var array<string, string> layer name => provider, for the layers not stored in files */
    public $notIncluded = array();

    /** @var array<string, string> layer name => reference not found on the server */
    public $missing = array();

    /**
     * @param string $qgsPath path of the .qgs file
     * @param string $qgs     content of the .qgs file
     */
    public function __construct($qgsPath, $qgs)
    {
        $this->qgsPath = realpath($qgsPath);
        $this->projectDir = rtrim(dirname($this->qgsPath), '/').'/';
        $this->dom = new \DOMDocument();
        $this->dom->preserveWhiteSpace = true;
        if (!@$this->dom->loadXML($qgs, LIBXML_PARSEHUGE)) {
            throw new \Exception('The QGIS project cannot be read');
        }
        // Keep the accents as they are in the copy (not as character references).
        $this->dom->encoding = 'UTF-8';
    }

    /**
     * Collects the files of the project, and points the copy of the
     * project to the ones moved to external/.
     *
     * @param string $projectKey name of the project, without extension
     */
    public function collect($projectKey)
    {
        $xpath = new \DOMXPath($this->dom);

        foreach ($xpath->query('//maplayer') as $layer) {
            $this->collectLayer($xpath, $layer);
        }

        // Symbols, images, styles, layouts: any attribute pointing to such a file.
        foreach ($xpath->query('//@*') as $attr) {
            $value = $attr->value;
            if (!$this->hasResourceExtension($value)) {
                continue;
            }
            $newValue = $this->addReference($value);
            if ($newValue !== null && $newValue !== $value) {
                $attr->value = $newValue;
            }
        }

        $this->collectFolder($projectKey);
    }

    /**
     * Adds the whole folder of the project (data/, media/, thumbnail,
     * Lizmap configuration…), without the other projects of the folder
     * (their .qgs and their own files: configuration, thumbnail), the
     * temporary and backup files, and the hidden files and folders.
     *
     * @param string $projectKey
     */
    protected function collectFolder($projectKey)
    {
        // Other projects of the folder: their .qgs, .qgs.cfg, .qgs.png…
        $otherProjects = array();
        foreach (glob($this->projectDir.'*.{qgs,qgz}', GLOB_BRACE) ?: array() as $path) {
            $name = basename($path);
            if ($name !== $projectKey.'.qgs') {
                $otherProjects[] = $name;
            }
        }

        $directory = new \RecursiveDirectoryIterator($this->projectDir, \FilesystemIterator::SKIP_DOTS);
        // Hidden files and folders (.git, .qgis…) are skipped, folders included.
        $filter = new \RecursiveCallbackFilterIterator($directory, function ($file) {
            return strpos($file->getFilename(), '.') !== 0
                && !in_array($file->getFilename(), array('__pycache__', 'Thumbs.db'));
        });
        foreach (new \RecursiveIteratorIterator($filter) as $file) {
            if (!$file->isFile()) {
                continue;
            }
            $path = $file->getPathname();
            $relative = substr($path, strlen($this->projectDir));
            if (self::isTemporary($relative)) {
                continue;
            }
            if (strpos($relative, '/') === false && self::belongsToOtherProject($relative, $otherProjects)) {
                continue;
            }
            $this->addFile($path);
        }
    }

    /**
     * Temporary, lock and backup files.
     *
     * @param string $name
     *
     * @return bool
     */
    public static function isTemporary($name)
    {
        return (bool) preg_match('/(~|\.bak|\.lock|\.tmp|-wal|-shm|-journal)$/i', $name);
    }

    /**
     * Indicates if a file of the root of the folder is another project or
     * one of its own files (other.qgs, other.qgs.cfg, other.qgs.png…).
     *
     * @param string   $name          name of the file
     * @param string[] $otherProjects names of the other .qgs/.qgz of the folder
     *
     * @return bool
     */
    public static function belongsToOtherProject($name, $otherProjects)
    {
        foreach ($otherProjects as $project) {
            if ($name === $project || strpos($name, $project.'.') === 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param \DOMXPath   $xpath
     * @param \DOMElement $layer
     */
    protected function collectLayer($xpath, $layer)
    {
        $provider = strtolower(trim((string) $xpath->evaluate('string(provider)', $layer)));
        $source = (string) $xpath->evaluate('string(datasource)', $layer);
        $name = trim((string) $xpath->evaluate('string(layername)', $layer));
        if ($name === '') {
            $name = trim((string) $xpath->evaluate('string(id)', $layer));
        }

        if (in_array($provider, self::IGNORED_PROVIDERS)) {
            return;
        }
        if (!in_array($provider, self::FILE_PROVIDERS)) {
            $this->notIncluded[$name] = $provider;

            return;
        }

        $reference = self::fileReference($provider, $source);
        if ($reference === null) {
            $this->notIncluded[$name] = $provider;

            return;
        }

        $newPath = $this->addReference($reference['path']);
        if ($newPath === null) {
            $this->missing[$name] = $reference['path'];

            return;
        }
        if ($newPath === $reference['path']) {
            return;
        }

        // Point the data source of the copy (and the layer tree) to the new place.
        $newToken = $provider === 'delimitedtext'
            ? str_replace(' ', '%20', $newPath)
            : $newPath;
        $newSource = substr_replace($source, $newToken, $reference['offset'], strlen($reference['token']));
        if ($provider === 'delimitedtext') {
            $newSource = preg_replace('#^file:(//)?#', 'file:', $newSource);
        }
        foreach ($xpath->query('datasource', $layer) as $node) {
            $node->nodeValue = '';
            $node->appendChild($this->dom->createTextNode($newSource));
        }
        foreach ($xpath->query('//layer-tree-layer[@source]') as $node) {
            if ($node->getAttribute('source') === $source) {
                $node->setAttribute('source', $newSource);
            }
        }
    }

    /**
     * Part of a data source which is a file path.
     *
     * @param string $provider
     * @param string $source
     *
     * @return null|array{token: string, offset: int, path: string} the
     *                                                              token as written in the source, its offset, and the decoded path
     */
    public static function fileReference($provider, $source)
    {
        switch ($provider) {
            case 'ogr':
            case 'gdal':
                // GPKG:path:table, NETCDF:"path":var…
                if (preg_match('/^[A-Z][A-Z0-9_]*:"([^"]+)"/', $source, $m, PREG_OFFSET_CAPTURE)
                    || preg_match('/^(?:GPKG|NETCDF|HDF5|HDF4_SDS|SQLITE):([^:]+(?::\\\[^:]+)?):/', $source, $m, PREG_OFFSET_CAPTURE)) {
                    return array('token' => $m[1][0], 'offset' => $m[1][1], 'path' => $m[1][0]);
                }
                // Connection strings and URLs (PG:, WFS:, http…) are not files.
                if (preg_match('#^[A-Za-z][A-Za-z0-9_]*:(?!\\\|/[^/])#', $source) || strpos($source, '://') !== false) {
                    return null;
                }
                $token = explode('|', $source)[0];
                // /vsizip/archive.zip/inner.shp: the archive
                if (preg_match('#^/vsi(?:zip|gzip|tar)/(.+?\.(?:zip|gz|tgz|tar))(?:/|$)#i', $token, $m, PREG_OFFSET_CAPTURE)) {
                    return array('token' => $m[1][0], 'offset' => $m[1][1], 'path' => $m[1][0]);
                }

                return $token === '' ? null : array('token' => $token, 'offset' => 0, 'path' => $token);

            case 'delimitedtext':
                if (!preg_match('#^file:(?://)?([^?]+)#', $source, $m, PREG_OFFSET_CAPTURE)) {
                    return null;
                }

                return array('token' => $m[1][0], 'offset' => $m[1][1], 'path' => rawurldecode($m[1][0]));

            case 'spatialite':
                if (!preg_match("/dbname='([^']+)'/", $source, $m, PREG_OFFSET_CAPTURE)) {
                    return null;
                }

                return array('token' => $m[1][0], 'offset' => $m[1][1], 'path' => $m[1][0]);
        }

        return null;
    }

    /**
     * Adds a referenced file (with its companion files) to the package.
     *
     * @param string $reference path as written in the project
     *
     * @return null|string the reference to write in the project copy
     *                     (unchanged when the file keeps its place), or null when the file
     *                     does not exist on the server
     */
    protected function addReference($reference)
    {
        $path = $this->resolve($reference);
        if ($path === null) {
            return null;
        }
        $zipPath = $this->zipPath($path);
        $this->addPath($path, $zipPath);

        if (strpos($zipPath, self::EXTERNAL_DIR) === 0 || $this->isAbsolute($reference)) {
            $this->moved[$reference] = $zipPath;

            return './'.$zipPath;
        }

        return $reference;
    }

    /**
     * Real path of a reference, relative to the folder of the project.
     *
     * @param string $reference
     *
     * @return null|string
     */
    protected function resolve($reference)
    {
        $reference = trim($reference);
        if ($reference === '' || strpos($reference, 'base64:') === 0) {
            return null;
        }
        $candidate = $this->isAbsolute($reference) ? $reference : $this->projectDir.$reference;
        $real = realpath($candidate);
        if ($real === false || $real === $this->qgsPath) {
            return null;
        }

        return $real;
    }

    protected function isAbsolute($reference)
    {
        return strpos($reference, '/') === 0;
    }

    /**
     * Path in the zip of a real path.
     *
     * @param string $path
     *
     * @return string
     */
    protected function zipPath($path)
    {
        if (strpos($path, $this->projectDir) === 0) {
            return substr($path, strlen($this->projectDir));
        }

        return self::EXTERNAL_DIR.ltrim($path, '/');
    }

    /**
     * Adds a file, its companion files (same name, other extensions:
     * .shx, .dbf, .prj, .aux.xml, .ovr, .tfw…), the sources of a VRT, or
     * the content of a folder (FileGDB…).
     *
     * @param string $path
     * @param string $zipPath
     */
    protected function addPath($path, $zipPath)
    {
        if (is_dir($path)) {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $file) {
                if ($file->isFile()) {
                    $this->addFile($file->getPathname());
                }
            }

            return;
        }

        $this->addFile($path, $zipPath);

        $dir = dirname($path).'/';
        $base = basename($path);
        $stem = pathinfo($base, PATHINFO_FILENAME);
        foreach (array_unique(array_merge(glob($dir.$stem.'.*') ?: array(), glob($dir.$base.'.*') ?: array())) as $companion) {
            if (is_file($companion) && !preg_match('/(-wal|-shm|-journal|\.lock|\.qgs|\.qgz|~)$/i', $companion)) {
                $this->addFile($companion);
            }
        }

        if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'vrt') {
            $this->addVrtSources($path);
        }
    }

    /**
     * @param string      $path
     * @param null|string $zipPath
     */
    protected function addFile($path, $zipPath = null)
    {
        $real = realpath($path);
        if ($real === false || !is_file($real) || !is_readable($real) || $real === $this->qgsPath) {
            return;
        }
        $this->files[$zipPath ?? $this->zipPath($real)] = $real;
    }

    /**
     * Sources of a GDAL virtual raster.
     *
     * @param string $vrtPath
     */
    protected function addVrtSources($vrtPath)
    {
        $vrt = @file_get_contents($vrtPath);
        if (!$vrt || !preg_match_all('#<SourceFilename([^>]*)>([^<]+)</SourceFilename>#', $vrt, $m, PREG_SET_ORDER)) {
            return;
        }
        foreach ($m as $source) {
            $file = html_entity_decode(trim($source[2]), ENT_QUOTES | ENT_XML1);
            $relative = strpos($source[1], 'relativeToVRT="1"') !== false;
            $candidate = $relative ? dirname($vrtPath).'/'.$file : $file;
            $real = realpath($candidate);
            if ($real !== false) {
                $this->addPath($real, $this->zipPath($real));
            }
        }
    }

    protected function hasResourceExtension($value)
    {
        if (strlen($value) > 1024 || strpos($value, "\n") !== false) {
            return false;
        }
        $extension = strtolower(pathinfo(parse_url($value, PHP_URL_PATH) ?: $value, PATHINFO_EXTENSION));

        return in_array($extension, self::RESOURCE_EXTENSIONS);
    }

    /**
     * Project copy to put in the zip.
     *
     * @return string
     */
    public function projectXml()
    {
        return $this->dom->saveXML();
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
     * Fingerprint of the content of the package: the project file and every
     * collected file, with their sizes and modification dates. Two
     * fingerprints differ as soon as a file is added, removed or modified.
     *
     * @return string
     */
    public function fingerprint()
    {
        $lines = array($this->fileLine('', $this->qgsPath));
        foreach ($this->files as $name => $path) {
            $lines[] = $this->fileLine($name, $path);
        }
        sort($lines);

        return sha1(implode("\n", $lines));
    }

    /**
     * Total size of the files of the package, in bytes (before compression).
     *
     * @return int
     */
    public function totalSize()
    {
        $size = (int) @filesize($this->qgsPath);
        foreach ($this->files as $path) {
            $size += (int) @filesize($path);
        }

        return $size;
    }

    /**
     * @param string $name
     * @param string $path
     *
     * @return string
     */
    protected function fileLine($name, $path)
    {
        clearstatcache(true, $path);

        return $name.'|'.$path.'|'.((int) @filesize($path)).'|'.((int) @filemtime($path));
    }

    /**
     * Builds the zip.
     *
     * @param string $zipPath    path of the zip to create
     * @param string $projectKey
     * @param string $readme     content of the README file
     * @param string $readmeName name of the README file
     *
     * @param null|callable $progress   receives the progress of the writing, from 0 to 1
     *
     * @return bool
     */
    public function buildZip($zipPath, $projectKey, $readme, $readmeName, $progress = null)
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return false;
        }
        // The files are read and compressed by close(): its progress, from
        // 0 to 1 (libzip 1.3 or later).
        if ($progress && method_exists($zip, 'registerProgressCallback')) {
            $zip->registerProgressCallback(0.01, $progress);
        }
        $zip->addFromString($projectKey.'.qgs', $this->projectXml());
        foreach ($this->files as $name => $path) {
            if ($name === $projectKey.'.qgs') {
                continue;
            }
            $zip->addFile($path, $name);
            if (in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), self::STORED_EXTENSIONS)
                && method_exists($zip, 'setCompressionName')) {
                $zip->setCompressionName($name, \ZipArchive::CM_STORE);
            }
        }
        $zip->addFromString($readmeName, $readme);

        return $zip->close();
    }
}
