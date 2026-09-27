{* Confirmation page shown in the users administration (jauthdb_admin)
   after an account has been validated by the administrator.

   @copyright 2026 S.Poudroux / Kheper 3D
   @license MPL-2.0 *}
<!-- validate_user.tpl -->
<div class="jcommunity-box jcommunity-account">
    <h1>{$validationTitle}</h1>
    <p>{@jcommunity~account.validation.message@}</p>
    <p><a href="{jurl 'jauthdb_admin~default:view', array('j_user_login'=>$user->login)}" class="crud-link btn">{@jcommunity~account.validation.back.to.profile@}</a></p>
</div>