<?php
/** Vars: $rows $active $profiles $q $prof $status $pg $pages $total $inUse $counts */
$canW = Auth::can('write');
$profNames = array_column($profiles, 'name');
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-network.css')) ?>">
<?= page_head(t('PPPoE'), t('Customer secrets, live sessions and profiles.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-sec" data-new>' . icon('plus', 16) . e(t('Add secret')) . '</button>' : '') ?>

<div class="grid" style="margin-bottom:var(--s4)">
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= icon('users', 16) ?><?= e(t('Secrets')) ?></div><div class="stat-value"><?= (int)$counts['secrets'] ?></div></div></section>
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= icon('activity', 16) ?><?= e(t('Online now')) ?></div><div class="stat-value"><?= (int)$counts['active'] ?></div></div></section>
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= icon('ban', 16) ?><?= e(t('Disabled')) ?></div><div class="stat-value"><?= (int)$counts['disabled'] ?></div></div></section>
</div>

<section class="card glass">
  <div class="tabs" role="tablist" data-hash-tabs>
    <?php foreach (['secrets' => 'Secrets', 'active' => 'Active sessions', 'profiles' => 'Profiles'] as $k => $l) { ?>
    <button type="button" role="tab" id="tab-<?= $k ?>" aria-controls="panel-<?= $k ?>" aria-selected="<?= $k === 'secrets' ? 'true' : 'false' ?>" data-tab="<?= $k ?>"><?= e(t($l)) ?></button>
    <?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-secrets" aria-labelledby="tab-secrets">
    <form class="nm-toolbar" method="get" action="<?= e(url('/pppoe')) ?>">
      <input class="input search" type="search" name="q" value="<?= e($q) ?>" placeholder="<?= e(t('Search name, comment, MAC or IP')) ?>" aria-label="<?= e(t('Search')) ?>">
      <select class="select select-sm" name="profile" style="width:auto" aria-label="<?= e(t('Profile')) ?>" data-autosubmit><option value=""><?= e(t('All profiles')) ?></option><?php foreach ($profNames as $pn) { ?><option<?= sel($pn, $prof) ?>><?= e($pn) ?></option><?php } ?></select>
      <select class="select select-sm" name="status" style="width:auto" aria-label="<?= e(t('Status')) ?>" data-autosubmit><option value=""><?= e(t('Any status')) ?></option><?php foreach (['online' => 'Online', 'offline' => 'Offline', 'disabled' => 'Disabled'] as $k => $l) { ?><option value="<?= $k ?>"<?= sel($k, $status) ?>><?= e(t($l)) ?></option><?php } ?></select>
      <button class="btn btn-sm"><?= icon('search', 16) ?><?= e(t('Search')) ?></button>
    </form>
    <form method="post" action="<?= e(url('/pppoe/secret/action')) ?>" data-bulk>
      <?= csrf_field() ?>
      <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
        <?php if ($canW) { ?>
        <select class="select select-sm" name="profile" style="width:auto" aria-label="<?= e(t('Profile')) ?>"><?php foreach ($profNames as $pn) { ?><option><?= e($pn) ?></option><?php } ?></select>
        <button class="btn btn-sm" name="action" value="setprofile"><?= e(t('Set profile')) ?></button>
        <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
        <button class="btn btn-sm" name="action" value="disable" data-confirm="<?= e(t('Disable the selected secrets? Their live sessions are disconnected.')) ?>"><?= e(t('Disable')) ?></button>
        <button class="btn btn-sm" name="action" value="kick"><?= e(t('Disconnect')) ?></button>
        <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Delete the selected secrets? This cannot be undone.')) ?>"><?= icon('trash', 16) ?><?= e(t('Delete')) ?></button>
        <?php } ?></div>
      <?php if (!$rows) { echo empty_state('users', t('No secrets found')); } else { ?>
      <div class="table-wrap"><table class="tbl resp" id="ppp-tbl">
        <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('Name')) ?></th><th data-sort><?= e(t('Profile')) ?></th><th><?= e(t('Status')) ?></th><th>IP</th><th>MAC</th><th><?= e(t('Comment')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $s) { $off = NetworkController::off($s); ?>
          <tr>
            <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($s['.id']) ?>" aria-label="<?= e($s['name']) ?>"></td>
            <td data-label="<?= e(t('Name')) ?>" class="mono"><?= e($s['name']) ?></td>
            <td data-label="<?= e(t('Profile')) ?>"><?= e($s['profile'] ?? '') ?></td>
            <td data-label="<?= e(t('Status')) ?>"><?= $off ? badge(t('Disabled'), 'err') : ($s['_online'] ? badge(t('Online'), 'ok') : badge(t('Offline'), 'neutral')) ?></td>
            <td data-label="IP" class="mono"><?= e($s['_addr'] ?: ($s['remote-address'] ?? '')) ?: '-' ?></td>
            <td data-label="MAC" class="mono"><?= e($s['caller-id'] ?? '') ?: '-' ?></td>
            <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($s['comment'] ?? '') ?></td>
            <td class="actions" data-label=""><?php if ($canW) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-sec" data-edit="<?= jattr(['id' => $s['.id'], 'name' => $s['name'], 'service' => $s['service'] ?? 'pppoe', 'profile' => $s['profile'] ?? 'default', 'caller_id' => $s['caller-id'] ?? '', 'local_address' => $s['local-address'] ?? '', 'remote_address' => $s['remote-address'] ?? '', 'comment' => $s['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
          </tr>
        <?php } ?>
        </tbody>
      </table></div>
      <?= pager($pg, $pages, $total) ?>
      <?php } ?>
    </form>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-active" aria-labelledby="tab-active" hidden>
    <form method="post" action="<?= e(url('/pppoe/active/kick')) ?>" data-bulk>
      <?= csrf_field() ?>
      <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#act-tbl" aria-label="<?= e(t('Filter')) ?>"></div>
      <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
        <?php if ($canW) { ?><button class="btn btn-sm btn-danger" data-confirm="<?= e(t('Disconnect the selected sessions?')) ?>"><?= e(t('Disconnect')) ?></button><?php } ?></div>
      <?php if (!$active) { echo empty_state('activity', t('No active PPPoE sessions')); } else { ?>
      <div class="table-wrap"><table class="tbl resp" id="act-tbl">
        <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('Name')) ?></th><th>IP</th><th>MAC</th><th><?= e(t('Service')) ?></th><th data-sort>Uptime</th></tr></thead>
        <tbody><?php foreach ($active as $a) { ?>
          <tr><td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($a['.id']) ?>" aria-label="<?= e($a['name']) ?>"></td>
            <td data-label="<?= e(t('Name')) ?>" class="mono"><?= e($a['name']) ?></td><td data-label="IP" class="mono"><?= e($a['address'] ?? '') ?></td><td data-label="MAC" class="mono"><?= e($a['caller-id'] ?? '') ?></td>
            <td data-label="<?= e(t('Service')) ?>"><?= e($a['service'] ?? '') ?></td><td data-label="Uptime" class="mono"><?= e($a['uptime'] ?? '') ?></td></tr>
        <?php } ?></tbody>
      </table></div>
      <?php } ?>
    </form>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-profiles" aria-labelledby="tab-profiles" hidden>
    <div class="nm-toolbar"><?php if ($canW) { ?><button class="btn btn-sm btn-primary" type="button" data-open="#dlg-prof" data-new><?= icon('plus', 16) ?><?= e(t('Add profile')) ?></button><?php } ?></div>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Name')) ?></th><th><?= e(t('Local address')) ?></th><th><?= e(t('Remote address / pool')) ?></th><th><?= e(t('Rate limit')) ?></th><th class="num"><?= e(t('Secrets')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody><?php foreach ($profiles as $p) { $builtin = in_array($p['name'], ['default', 'default-encryption'], true); ?>
        <tr><td data-label="<?= e(t('Name')) ?>"><?= e($p['name']) ?> <?= $builtin ? badge(t('built-in'), 'neutral') : '' ?></td>
          <td data-label="<?= e(t('Local address')) ?>" class="mono"><?= e($p['local-address'] ?? '') ?: '-' ?></td><td data-label="<?= e(t('Remote address / pool')) ?>" class="mono"><?= e($p['remote-address'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Rate limit')) ?>" class="mono"><?= e($p['rate-limit'] ?? '') ?: '-' ?></td><td data-label="<?= e(t('Secrets')) ?>" class="num"><?= (int)($inUse[$p['name']] ?? 0) ?></td>
          <td class="actions" data-label=""><?php if ($canW) { ?>
            <button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-prof" data-edit="<?= jattr(['id' => $p['.id'], 'name' => $p['name'], 'local_address' => $p['local-address'] ?? '', 'remote_address' => $p['remote-address'] ?? '', 'rate_limit' => $p['rate-limit'] ?? '', 'only_one' => $p['only-one'] ?? 'default']) ?>"><?= icon('edit', 16) ?></button>
            <?php if (!$builtin) { ?><form class="inline-form" method="post" action="<?= e(url('/pppoe/profile/delete')) ?>" data-confirm="<?= e(t('Delete this profile?')) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['.id']) ?>"><button class="btn btn-sm btn-ghost btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form><?php } ?>
          <?php } ?></td></tr>
      <?php } ?></tbody>
    </table></div>
  </div>
</section>

<?php if ($canW) { ?>
<dialog class="modal" id="dlg-sec" aria-labelledby="dlg-sec-t">
  <form method="post" action="<?= e(url('/pppoe/secret/save')) ?>" autocomplete="off">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-sec-t"><?= e(t('PPPoE secret')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="s-name"><?= e(t('Name')) ?></label><input class="input mono" id="s-name" name="name" required maxlength="64" autocapitalize="off"></div>
      <div class="field"><label for="s-pass"><?= e(t('Password')) ?></label><input class="input mono" id="s-pass" name="password" maxlength="64" autocomplete="new-password"><p class="help" data-edit-only hidden><?= e(t('Leave blank to keep the current password.')) ?></p></div>
      <div class="field"><label for="s-prof"><?= e(t('Profile')) ?></label><select class="select" id="s-prof" name="profile"><?php foreach ($profNames as $pn) { ?><option><?= e($pn) ?></option><?php } ?></select></div>
      <div class="field"><label for="s-svc"><?= e(t('Service')) ?></label><select class="select" id="s-svc" name="service"><?php foreach (['pppoe', 'any', 'pptp', 'l2tp', 'sstp', 'ovpn'] as $sv) { ?><option><?= $sv ?></option><?php } ?></select></div>
      <div class="field"><label for="s-cid"><?= e(t('Lock to MAC (caller-id)')) ?></label><input class="input mono" id="s-cid" name="caller_id" placeholder="AA:BB:CC:DD:EE:FF"></div>
      <div class="field"><label for="s-ra"><?= e(t('Fixed IP (remote address)')) ?></label><input class="input mono" id="s-ra" name="remote_address" placeholder="10.20.1.15"></div>
      <div class="field"><label for="s-la"><?= e(t('Local address')) ?></label><input class="input mono" id="s-la" name="local_address"></div>
      <div class="field"><label for="s-com"><?= e(t('Comment')) ?></label><input class="input" id="s-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<dialog class="modal" id="dlg-prof" aria-labelledby="dlg-prof-t">
  <form method="post" action="<?= e(url('/pppoe/profile/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-prof-t"><?= e(t('PPP profile')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="pf-name"><?= e(t('Name')) ?></label><input class="input mono" id="pf-name" name="name" required maxlength="40" autocapitalize="off"></div>
      <div class="field"><label for="pf-rate"><?= e(t('Rate limit')) ?></label><input class="input mono" id="pf-rate" name="rate_limit" placeholder="10M/10M"></div>
      <div class="field"><label for="pf-la"><?= e(t('Local address')) ?></label><input class="input mono" id="pf-la" name="local_address" placeholder="10.20.0.1"></div>
      <div class="field"><label for="pf-ra"><?= e(t('Remote address / pool')) ?></label><input class="input mono" id="pf-ra" name="remote_address" placeholder="pppoe-pool"></div>
      <div class="field full"><label for="pf-one"><?= e(t('Only one session per user')) ?></label><select class="select" id="pf-one" name="only_one"><option value="default">default</option><option value="yes">yes</option><option value="no">no</option></select></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
