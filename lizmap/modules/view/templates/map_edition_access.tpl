{* Content of the "Edition" entry of the map when the project has editable
   layers that the current user cannot edit (Project::getDefaultDockable()):
   the list of these layers, and a request for access sent to the
   administrators by the <lizmap-edition-access> component
   (assets/src/components/EditionAccess.js, view~editionAccess:request).

   @copyright 2026 S.Poudroux / Kheper 3D
   @license MPL-2.0 *}
<div class="edition-access">
  <h3><span class="title"><span class="text">{@view~editionaccess.dock.title@}</span></span></h3>
  <div class="menu-content">
    <lizmap-edition-access data-repository="{$repository|eschtml}" data-project="{$project|eschtml}"
      data-url="{jurl 'view~editionAccess:request'}"
      data-sending="{@view~editionaccess.sending@}" data-network-error="{@view~editionaccess.error.network@}"
      data-notice-link="{@view~editionaccess.notice.link@}">
      <p>{@view~editionaccess.intro@}</p>
      {if count($layers)}
      <ul class="edition-access-layers">
        {foreach $layers as $title}<li>{$title|eschtml}</li>{/foreach}
      </ul>
      {/if}
      {if $isConnected}
      <p>{@view~editionaccess.noright@}</p>
      <form class="edition-access-form">
        <label for="edition-access-message">{@view~editionaccess.message.label@}</label>
        <textarea id="edition-access-message" name="message" rows="3" maxlength="1000"
          placeholder="{@view~editionaccess.message.placeholder@}"></textarea>
        <button type="submit" class="btn btn-primary edition-access-send">{@view~editionaccess.send@}</button>
      </form>
      <p class="edition-access-result" aria-live="polite"></p>
      {else}
      <p>{@view~editionaccess.login.required@}</p>
      <p class="edition-access-login">
        <a class="btn btn-primary" href="{jurl 'jcommunity~login:index', array('auth_url_return'=>$authUrlReturn)}">{@view~editionaccess.login@}</a>
        {if $allowUserAccountRequests}
        <a class="btn" href="{jurl 'jcommunity~registration:index'}">{@view~editionaccess.register@}</a>
        {/if}
      </p>
      {/if}
      <p class="edition-access-notice" hidden>{@view~editionaccess.notice@}</p>
    </lizmap-edition-access>
  </div>
</div>
