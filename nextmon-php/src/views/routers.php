<?php /** Vars: $routers, $current, $forced */ ?>
<?= page_head(t('Routers'), t('Connect one or more MikroTik devices through the RouterOS API.'),
    Auth::can('admin') ? '<button class="btn btn-primary" type="button" data-open="#dlg-router" data-new>' . icon('plus', 16) . e(t('Add router')) . '</button>' : '') ?>

<?php if ($forced) { ?><div class="alert warn" style="margin-bottom:var(--s4)"><?= e(t('NEXTMON_DEMO=1 is set: every router is served by the built-in simulator.')) ?></div><?php } ?>

<section class="card glass">
  <div class="table-wrap">
    <table class="tbl resp">
      <thead><tr><th><?= e(t('Name')) ?></th><th><?= e(t('Session name')) ?></th><th><?= e(t('Host')) ?></th><th><?= e(t('Mode')) ?></th><th><?= e(t('Status')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($routers as $r) { $demo = ($r['type'] ?? '') === 'demo'; ?>
        <tr>
          <td data-label="<?= e(t('Name')) ?>"><b><?= e($r['name']) ?></b></td>
          <td data-label="<?= e(t('Session name')) ?>" class="mono"><?= e($r['session'] ?? $r['id']) ?></td>
          <td data-label="<?= e(t('Host')) ?>" class="mono"><?= !empty($r['shared']) ? e(t('Shared by :n', [':n' => $r['owner_name']])) . ' ' . badge($r['mode'] === 'rw' ? t('Read/write') : t('Read-only'), $r['mode'] === 'rw' ? 'warn' : 'neutral') : ($demo ? '-' : e($r['host'] . ':' . $r['port']) . (!empty($r['ssl']) ? ' (SSL)' : '')) ?></td>
          <td data-label="<?= e(t('Mode')) ?>"><?= $demo ? badge('Demo', 'warn') : badge('RouterOS API', 'info') ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= $r['id'] === $current ? badge(t('Selected'), 'ok') : '<span class="muted">-</span>' ?></td>
          <td class="actions" data-label="">
            <?php if (Auth::can('admin') && empty($r['shared'])) { ?>
            <button class="btn btn-sm" type="button" data-open="#dlg-router" data-edit="<?= jattr(['id' => $r['id'], 'name' => $r['name'], 'session' => $r['session'] ?? '', 'type' => $r['type'] ?? 'real', 'host' => $r['host'] ?? '', 'port' => $r['port'] ?? 8728, 'ssl' => !empty($r['ssl']) ? '1' : '', 'user' => $r['user'] ?? '', 'hotspot_name' => $r['hotspot_name'] ?? '']) ?>"><?= icon('edit', 16) ?><span class="hide-m"><?= e(t('Edit')) ?></span></button>
            <form class="inline-form" method="post" action="<?= e(url('/routers/delete')) ?>" data-confirm="<?= e(t('Delete router :n? Stored credentials are removed.', [':n' => $r['name']])) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($r['id']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form>
            <?php } ?>
          </td>
        </tr>
      <?php } ?>
      </tbody>
    </table>
  </div>
</section>

<section class="card glass" style="margin-top:var(--s4)"><div class="card-b">
  <h2 style="font-size:var(--fs-14);margin-bottom:var(--s2)"><?= e(t('Router setup checklist')) ?></h2>
  <ol class="muted" style="margin:0;padding-left:var(--s5);display:flex;flex-direction:column;gap:var(--s1)">
    <li><?= e(t('Enable the API service: /ip service enable api (port 8728) or api-ssl (8729).')) ?></li>
    <li><?= e(t('Create a dedicated user in a group with api, read, write, policy, test and sniff permissions.')) ?></li>
    <li><?= e(t('Restrict the API service to this server IP: /ip service set api address=x.x.x.x/32.')) ?></li>
    <li><?= e(t('Keep the SNTP client / NTP enabled: voucher expiry depends on accurate router time.')) ?></li>
  </ol>
</div></section>

<?php if (Auth::can('admin')) { ?>
<dialog class="modal" id="dlg-router" aria-labelledby="dlg-router-t">
  <form method="post" action="<?= e(url('/routers/save')) ?>" data-test-url="<?= e(url('/routers/test')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-router-t"><?= e(t('Router')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="r-name"><?= e(t('Name')) ?></label><input class="input" id="r-name" name="name" required maxlength="40"></div>
      <div class="field"><label for="r-session"><?= e(t('Session name')) ?></label><input class="input" id="r-session" name="session" pattern="[A-Za-z0-9_\-]+" placeholder="cafe-a"><p class="help"><?= e(t('Used in the public status URL: /status?session=NAME')) ?></p></div>
      <div class="field full"><label for="r-type"><?= e(t('Mode')) ?></label>
        <select class="select" id="r-type" name="type" data-toggle-real><option value="real"><?= e(t('Real MikroTik (RouterOS API)')) ?></option><option value="demo"><?= e(t('Demo (simulated data)')) ?></option></select></div>
      <div class="field" data-real><label for="r-host"><?= e(t('Host / IP')) ?></label><input class="input" id="r-host" name="host" placeholder="192.168.88.1" inputmode="url" autocapitalize="off"></div>
      <div class="field" data-real><label for="r-port"><?= e(t('API port')) ?></label><input class="input" id="r-port" name="port" type="number" value="8728" min="1" max="65535"></div>
      <div class="field" data-real><label for="r-user"><?= e(t('API username')) ?></label><input class="input" id="r-user" name="user" autocomplete="off" autocapitalize="off"></div>
      <div class="field" data-real><label for="r-pass"><?= e(t('API password')) ?></label><input class="input" id="r-pass" name="pass" type="password" autocomplete="new-password"><p class="help"><?= e(t('Stored encrypted (AES-256-GCM). Leave blank to keep the current one.')) ?></p></div>
      <div class="field full" data-real><label class="switch"><input type="checkbox" name="ssl" value="1"><span class="track"></span><span><?= e(t('Use API-SSL (port 8729)')) ?></span></label></div>
      <div class="field full"><label for="r-hs"><?= e(t('Hotspot name (shown on vouchers)')) ?></label><input class="input" id="r-hs" name="hotspot_name" maxlength="60"></div>
      <div class="full" id="test-out" role="status" aria-live="polite"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-test-conn><?= e(t('Test connection')) ?></button><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
