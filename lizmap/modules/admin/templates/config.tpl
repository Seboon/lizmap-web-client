{jmessage_bootstrap}

  <h1>{@admin~admin.configuration.h1@}</h1>


  <div>
    <h2>{@admin~admin.generic.h2@}</h2>
    <dl>
      <dt>{@admin~admin.generic.version.number.label@}</dt><dd>{$version}</dd>
    </dl>
  </div>

  {ifacl2 'lizmap.admin.services.view'}
  <!--Services-->
  {formdata $servicesForm ,'htmlbootstrap', array()}
        <div>
            <h2>{@admin~admin.configuration.services.section.interface.label@}</h2>
            <table class="table services-table">
                {formcontrols array('appName', 'onlyMaps', 'projectSwitcher', 'googleTag')}
                    <tr>
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                    </tr>
                {/formcontrols}
            </table>
        </div>

        <div>
            <h2>{@admin~admin.configuration.services.section.emails.label@}</h2>
            <table class="table services-table">
                {formcontrols array( 'adminSenderEmail', 'adminSenderName', 'allowUserAccountRequests', 'adminContactEmail', 'adminNotificationLocale')}
                    <tr>
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                    </tr>
                {/formcontrols}
            </table>
        </div>

        <div>
            <h2>{@admin~admin.configuration.services.section.projects.label@}</h2>
            <table class="table services-table">
                {formcontrols array('defaultRepository', 'defaultProject', 'rootRepositories')}
                    <tr>
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                    </tr>
                {/formcontrols}
                {if $showSystem}
                    <tr class="project-zips-dir">
                        <th><label class="control-label">{@admin~admin.form.admin_services.projectZipsDir.label@}</label></th>
                        <td>{if !$projectZips['fromRoot']}<small>{@admin~admin.form.admin_services.projectZipsDir.fallback@}</small>{else}<code>{$projectZips['dir']|eschtml}</code>
                            <br/><small>{@admin~admin.form.admin_services.projectZipsDir.help@}</small>
                            {if $projectZips['writable']}
                            <br/><span class="text-success">{@admin~admin.form.admin_services.projectZipsDir.ok@}</span>
                            {else}
                            <br/><span class="text-warning">{if $projectZips['exists']}{@admin~admin.form.admin_services.projectZipsDir.notWritable@}{else}{@admin~admin.form.admin_services.projectZipsDir.missing@}{/if}</span>
                            <pre>{if $projectZips['exists']}{$projectZips['fixCommand']|eschtml}{else}{$projectZips['command']|eschtml}{/if}</pre>
                            {/if}
                            <details><summary>{@admin~admin.form.admin_services.projectZipsDir.nginx@}</summary><pre>{$projectZips['nginx']|eschtml}</pre></details>
                        {/if}
                        </td>
                    </tr>
                {/if}
            </table>
        </div>

      <div>
          <h2>{@admin~admin.configuration.services.section.features.label@}</h2>
          <table class="table services-table">
              {formcontrols array('uploadedImageMaxWidthHeight')}
                  <tr>
                      <th>{ctrl_label}</th><td>{ctrl_value}</td>
                  </tr>
              {/formcontrols}
          </table>
      </div>



        {if $showSystem}
        <div>
            <h2>{@admin~admin.configuration.services.section.cache.label@}</h2>
            <table class="table services-table">
                {formcontrols array('cacheStorageType', 'cacheRootDirectory', 'cacheRedisHost', 'cacheRedisPort', 'cacheRedisDb', 'cacheRedisKeyPrefix', 'cacheExpiration')}
                    <tr>
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                    </tr>
                {/formcontrols}
            </table>
        </div>

        <div>
            <h2>{@admin~admin.configuration.services.section.qgis.label@}</h2>
            <table class="table services-table">
                {formcontrols array('wmsServerURL', 'wmsPublicUrlList', 'relativeWMSPath', 'wmsMaxWidth', 'wmsMaxHeight', 'lizmapPluginAPIURL')}
                    <tr>
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                    </tr>
                {/formcontrols}
            </table>
        </div>


        <div>
            <h2>{@admin~admin.configuration.services.section.system.label@}</h2>
            <table class="table services-table">
                {formcontrols array('debugMode', 'requestProxyEnabled')}
                    <tr>
                        {ifctrl 'requestProxyEnabled'}
                            {ifctrl_value '0'}
                                <th>{ctrl_label}</th><td>{ctrl_value}</td>
                            {else}
                                <td colspan="2">
                                    {ctrl_value}
                                </td>
                            {/ifctrl_value}
                        {else}
                        <th>{ctrl_label}</th><td>{ctrl_value}</td>
                        {/ifctrl}
                    </tr>
                {/formcontrols}
            </table>
        </div>
        {/if}
      {* be sure all remaining controls not in the previous loops are displayed here *}
        <table class="table services-table">
            {formcontrols}
                <tr>
                    <th>{ctrl_label}</th><td>{ctrl_value}</td>
                </tr>
            {/formcontrols}
        </table>

    {/formdata}
    <!-- Modify -->
    {ifacl2 'lizmap.admin.services.update'}
    <div class="form-actions">
    <a class="btn" href="{jurl 'admin~config:modifyServices'}">
      {@admin~admin.configuration.button.modify.service.label@}
    </a>
    </div>
    {/ifacl2}
  {/ifacl2}
