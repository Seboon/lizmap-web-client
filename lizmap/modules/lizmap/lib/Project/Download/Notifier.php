<?php

namespace Lizmap\Project\Download;

/**
 * E-mails of the download of a project prepared in the background:
 * - to the user: link to download the zip, or failure;
 * - to the administrator (address of the "Notifications" setting): every
 *   download request, and every failure.
 *
 * The user receives them in their language (column lang of jlx_user, kept
 * with the request), the administrator in the language of the notification
 * e-mails (adminNotificationLocale), else the default one.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class Notifier
{
    /** @var \lizmapServices */
    protected $services;

    public function __construct()
    {
        $this->services = \lizmap::getServices();
    }

    /**
     * Locale of the e-mails to the administrator.
     *
     * @return string
     */
    public function adminLocale()
    {
        if (!empty($this->services->adminNotificationLocale)) {
            return $this->services->adminNotificationLocale;
        }

        return \jApp::config()->locale;
    }

    /**
     * @param string $key
     * @param array  $args
     * @param string $locale
     *
     * @return string
     */
    protected function tr($key, $args, $locale)
    {
        return \jLocale::get('view~projectdownload.'.$key, $args, $locale ?: null);
    }

    /**
     * Size for people (in the units of the locale).
     *
     * @param int    $bytes
     * @param string $locale
     *
     * @return string
     */
    public function size($bytes, $locale)
    {
        $units = explode(',', $this->tr('size.units', array(), $locale));
        $value = (float) $bytes;
        $unit = 0;
        while ($value >= 1024 && $unit < count($units) - 1) {
            $value /= 1024;
            ++$unit;
        }
        $number = $unit === 0 ? (string) (int) $value : number_format($value, 1, substr($locale, 0, 2) === 'en' ? '.' : ',', '');

        return $number.' '.$units[$unit];
    }

    /**
     * Download link to the user.
     *
     * @param array  $request  the request (login, email, lang, url)
     * @param string $title    title of the project
     * @param string $token    token of the link
     * @param array  $manifest manifest of the zip
     *
     * @return bool sent
     */
    public function sendReady($request, $title, $token, $manifest)
    {
        $locale = $request['lang'] ?? '';
        $url = $request['url'].(strpos($request['url'], '?') === false ? '?' : '&').'token='.$token;
        $body = implode("\n\n", array(
            $this->tr('mail.greeting', array(), $locale),
            $this->tr('mail.ready.text', array($title, $this->size($manifest['size'] ?? 0, $locale)), $locale),
            $this->tr('mail.ready.link', array(ZipStore::LINK_DAYS), $locale)."\n".$url,
            '-- '."\n".$this->services->appName,
        ));

        return $this->send(
            $request['email'] ?? '',
            $this->tr('mail.ready.subject', array($this->services->appName, $title), $locale),
            $body
        );
    }

    /**
     * Failure to the user.
     *
     * @param array  $request
     * @param string $title
     *
     * @return bool sent
     */
    public function sendFailedToUser($request, $title)
    {
        $locale = $request['lang'] ?? '';
        $body = implode("\n\n", array(
            $this->tr('mail.greeting', array(), $locale),
            $this->tr('mail.failed.text', array($title), $locale),
            '-- '."\n".$this->services->appName,
        ));

        return $this->send(
            $request['email'] ?? '',
            $this->tr('mail.failed.subject', array($this->services->appName, $title), $locale),
            $body
        );
    }

    /**
     * Download request, to the administrator.
     *
     * @param string $repository
     * @param string $project
     * @param string $title
     * @param string $login
     * @param string $email
     * @param bool   $ready      the zip was up to date (downloaded at once)
     *
     * @return bool sent
     */
    public function sendRequestToAdmin($repository, $project, $title, $login, $email, $ready)
    {
        $locale = $this->adminLocale();

        return $this->services->sendNotificationEmail(
            $this->tr('mail.admin.request.subject', array($this->services->appName, $title), $locale),
            implode("\n\n", array(
                $this->tr('mail.admin.request.text', array($login, $email, $title, $repository.'/'.$project), $locale),
                $this->tr($ready ? 'mail.admin.request.ready' : 'mail.admin.request.queued', array(), $locale),
            ))
        );
    }

    /**
     * Failure, to the administrator.
     *
     * @param string $repository
     * @param string $project
     * @param string $title
     * @param string $error
     *
     * @return bool sent
     */
    public function sendFailedToAdmin($repository, $project, $title, $error)
    {
        $locale = $this->adminLocale();

        return $this->services->sendNotificationEmail(
            $this->tr('mail.admin.failed.subject', array($this->services->appName, $title), $locale),
            $this->tr('mail.admin.failed.text', array($title, $repository.'/'.$project, $error), $locale)
        );
    }

    /**
     * @param string $to
     * @param string $subject
     * @param string $body
     *
     * @return bool
     */
    protected function send($to, $subject, $body)
    {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            \jLog::log('Project download: no valid e-mail address for the user ('.$to.')', 'lizmapadmin');

            return false;
        }
        if (!filter_var($this->services->adminSenderEmail, FILTER_VALIDATE_EMAIL)) {
            \jLog::log('Project download: no sender e-mail configured, the e-mail to '.$to.' cannot be sent', 'lizmapadmin');

            return false;
        }
        $mail = new \jMailer();
        $mail->Subject = $subject;
        $mail->Body = $body;
        $mail->AddAddress($to);

        try {
            $mail->Send();

            return true;
        } catch (\Exception $e) {
            \jLog::log('Project download: e-mail to '.$to.' not sent: '.$e->getMessage(), 'lizmapadmin');

            return false;
        }
    }
}
