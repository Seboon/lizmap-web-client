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
    }

    public function onjcommunity_registration_after_save($event)
    {
        $services = lizmap::getServices();
        $websiteUri = \jApp::coord()->request->getServerURI();
        $basePath = \jApp::urlBasePath();
        $websiteFullUri = $websiteUri . ($basePath == '/' ? '' : $basePath);        
        $appName = $services->appName;
        $services->sendNotificationEmail(
            jLocale::get('admin~user.email.admin.subject',array($appName)),
            jLocale::get(
                'admin~user.email.admin.body',
                array($websiteFullUri,$event->user->login, $event->user->email)
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
        $services->sendNotificationEmail(
            jLocale::get('admin~user.email.admin.link.confirm.subject',array($appName)),
            jLocale::get(
                'admin~user.email.admin.link.confirm.body',
                array($event->user->login,$websiteFullUri)
            )
        );
    }
}
