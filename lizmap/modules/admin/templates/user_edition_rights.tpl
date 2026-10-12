{meta_html js $j_basepath.'assets/js/admin/user_edition_rights.js', ['defer' => '']}
<div class="user-edition-rights" id="user-edition-rights">
<h2>{@admin~editionrights.section.title@}</h2>
<p>{@admin~editionrights.section.intro@}</p>

{if $globalUser}
<p class="alert alert-warning">{if $globalGroups}{jlocale 'admin~editionrights.global.groups', array(implode(', ', $globalGroups))}{else}{@admin~editionrights.global.user@}{/if}</p>
{/if}

{if !$exists}
<p>{@admin~editionrights.error.user@}</p>
{elseif !$repositories}
<p>{@admin~editionrights.no.repository@}</p>
{else}
{if !$readonly}
<form action="{formurl 'admin~userEditionRights:save'}" method="post">
<div>{formurlparam 'admin~userEditionRights:save'}
<input type="hidden" name="user" value="{$user|eschtml}"/>
<input type="hidden" name="token" value="{$token}"/></div>
{/if}
<table class="records-list table table-condensed">
<thead>
    <tr>
        <th>{@admin~editionrights.col.repository@}</th>
        <th>{@admin~editionrights.col.groups@}</th>
        <th>{@admin~editionrights.col.user@}</th>
    </tr>
</thead>
<tbody>
{foreach $repositories as $key => $repo}
<tr class="{cycle array('odd','even')}">
    <th>{$repo['label']|eschtml} <small>({$key|eschtml})</small>
        {if !$repo['canView']}<br/><small class="text-warning">{@admin~editionrights.no.view@}</small>{/if}
    </th>
    <td>{if $repo['groups']}{jlocale 'admin~editionrights.groups.all', array(implode(', ', $repo['groups']))}{else}—{/if}</td>
    <td>
    {if $readonly}
        {if $repo['mode'] == 'all'}{@admin~editionrights.mode.all@}
        {elseif $repo['mode'] == 'projects'}{@admin~editionrights.mode.projects@} :
            {assign $first = true}{foreach $repo['projects'] as $pkey => $ptitle}{if isset($repo['chosen'][$pkey])}{if !$first}, {/if}{assign $first = false}{$ptitle|eschtml}{/if}{/foreach}
        {else}{@admin~editionrights.mode.none@}{/if}
    {else}
        <select name="mode[{$key|eschtml}]" class="edition-mode" aria-label="{@admin~editionrights.col.user@} : {$repo['label']|eschtml}">
            <option value="none"{if $repo['mode'] == 'none'} selected="selected"{/if}>{@admin~editionrights.mode.none@}</option>
            <option value="all"{if $repo['mode'] == 'all'} selected="selected"{/if}>{@admin~editionrights.mode.all@}</option>
            <option value="projects"{if $repo['mode'] == 'projects'} selected="selected"{/if}{if !$repo['projects']} disabled="disabled"{/if}>{@admin~editionrights.mode.projects@}</option>
        </select>
        <div class="edition-projects"{if $repo['mode'] != 'projects'} hidden{/if}>
        {foreach $repo['projects'] as $pkey => $ptitle}
            <label class="checkbox"><input type="checkbox" name="projects[{$key|eschtml}][]" value="{$pkey|eschtml}"{if isset($repo['chosen'][$pkey])} checked="checked"{/if}/> {$ptitle|eschtml}{if $ptitle != $pkey} <small>({$pkey|eschtml})</small>{/if}</label>
        {/foreach}
        </div>
    {/if}
    {if $repo['groups'] && $repo['mode'] != 'none'}<br/><small class="text-warning">{@admin~editionrights.groups.already@}</small>{/if}
    {if $repo['blocked']}
    <ul class="edition-blocked-layers text-warning">
    {foreach $repo['blocked'] as $b}
        <li><small>{jlocale 'admin~editionrights.layer.blocked', array($b['project'], $b['layer'], $b['groups'])}</small></li>
    {/foreach}
    </ul>
    {/if}
    </td>
</tr>
{/foreach}
</tbody>
</table>
{if !$readonly}
<p><input type="submit" class="btn" value="{@admin~editionrights.save@}"/></p>
</form>
{/if}
{/if}
</div>
