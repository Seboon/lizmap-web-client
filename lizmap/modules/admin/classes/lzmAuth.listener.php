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

        // Local addition (Seb's fork): store the language of the person
        // registering, as detected for THEIR OWN request (autolocale plugin:
        // "lang" URL parameter, otherwise browser language). This does not
        // affect the confirmation e-mail sent to the registrant (already
        // correct, see jcommunity), but keeps a record of their language for
        // future use (e.g. display in the admin panel).
        $event->user->lang = jApp::config()->locale;
    }

    /**
     * Locale to use for the emails sent to the site administrator
     * (registration request / registration confirmed).
     *
     * These emails must always be sent in the administrator's own
     * language, never in the language of the visitor who is
     * registering (which is what jLocale::get() would otherwise use,
     * since it defaults to the locale resolved for the current
     * request -- i.e. the visitor's browser/session language when
     * the autolocale plugin is enabled).
     *
     * The locale is read from the "Language of notification e-mails"
     * field of the Services configuration (Administration > Lizmap
     * configuration > Services > E-mails), i.e.
     * lizmapServices::$adminNotificationLocale. If that field is left
     * empty, it falls back to the application's configured default
     * locale (jApp::config()->locale).
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
