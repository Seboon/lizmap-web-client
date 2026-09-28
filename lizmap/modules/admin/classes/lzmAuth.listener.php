<?php

class lzmAuthListener extends jEventListener
{
    public function onjcommunity_registration_prepare_save($event)
    {
        /** @var jFormsBase $form */
        $form = $event->form;
        $event->user->comment = $form->getData('comment');
        $event->user->firstname = $form->getData('firstname');
        $event->user->lastname = $form->getData('lastname');
        $event->user->organization = $form->getData('organization');

        // Language of the person registering (their own request, resolved
        // by the autolocale plugin), kept for later use.
        $event->user->lang = jApp::config()->locale;
    }

    /**
     * Locale to use for the emails sent to the site administrator
     * (registration request / registration confirmed).
     *
     * Always the administrator's language, never the one of the visitor
     * (the default of jLocale::get()): the "Language of notification
     * e-mails" setting (lizmapServices::$adminNotificationLocale), else the
     * default locale of the application.
     *
     * @param lizmapServices $services
     *
     * @return string a locale code, e.g. "fr_FR"
     */
    protected function getAdminNotificationLocale($services)
    {
        if (!empty($services->adminNotificationLocale)) {
            return $services->adminNotificationLocale;
        }
        return jApp::config()->locale;
    }

    public function onjcommunity_registration_after_save($event)
    {
        $services = lizmap::getServices();
        $websiteUri = \jApp::coord()->request->getServerURI();
        $basePath = \jApp::urlBasePath();
        $websiteFullUri = $websiteUri . ($basePath == '/' ? '' : $basePath);
        $appName = $services->appName;
        $adminLocale = $this->getAdminNotificationLocale($services);
        $services->sendNotificationEmail(
            jLocale::get('admin~user.email.admin.subject', array($appName), $adminLocale),
            jLocale::get(
                'admin~user.email.admin.body',
                array($websiteFullUri, $event->user->login, $event->user->email),
                $adminLocale
            )
        );
    } 

    public function onjcommunity_registration_confirm($event)
    {
        $services = lizmap::getServices();
        $websiteUri = \jServer::getServerURI();
        $basePath = \jApp::urlBasePath();
        $websiteFullUri = $websiteUri . ($basePath == '/' ? '' : $basePath);
        $appName = $services->appName;
        $adminLocale = $this->getAdminNotificationLocale($services);
        $services->sendNotificationEmail(
            jLocale::get('admin~user.email.admin.link.confirm.subject', array($appName), $adminLocale),
            jLocale::get(
                'admin~user.email.admin.link.confirm.body',
                array($event->user->login, $websiteFullUri),
                $adminLocale
            )
        );
    }
}
