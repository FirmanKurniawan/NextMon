<?php
/** Vars: $rows $q $type $pg $pages $total $servers $nDyn */
$canW = Auth::can('write');
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-network.css')) ?>">
<?= page_head(t('DHCP leases'), t('Connected devices. Make a lease static to pin a device to its IP address.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-lease" data-new>' . icon('plus', 16) . e(t('Add static lease')) . '</button>' : '') ?>
<section class="card glass">
  <form class="nm-toolbar" method="get" action="<?= e(url('/dhcp')) ?>">
    <input class="input search" type="search" name="q" value="<?= e($q) ?>" placeholder="<?= e(t('Search IP, MAC, host name or comment')) ?>" aria-label="<?= e(t('Search')) ?>">
    <select class="select select-sm" name="type" style="width:auto" aria-label="<?= e(t('Type')) ?>" data-autosubmit><option value=""><?= e(t('Static and dynamic')) ?></option><option value="dynamic"<?= sel('dynamic', $type) ?>><?= e(t('Dynamic only')) ?> (<?= (int)$nDyn ?>)</option><option value="static"<?= sel('static', $type) ?>><?= e(t('Static only')) ?></option></select>
    <button class="btn btn-sm"><?= icon('search', 16) ?><?= e(t('Search')) ?></button>
  </form>
  <form method="post" action="<?= e(url('/dhcp/action')) ?>" data-bulk>
    <?= csrf_field() ?>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?>
      <button class="btn btn-sm btn-primary" name="action" value="static"><?= e(t('Make static')) ?></button>
      <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
      <button class="btn btn-sm" name="action" value="disable"><?= e(t('Disable')) ?></button>
      <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Remove the selected leases? Devices get a new address on their next request.')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button>
      <?php } ?></div>
    <?php if (!$rows) { echo empty_state('list', t('No leases found')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('IP address')) ?></th><th>MAC</th><th data-sort><?= e(t('Host name')) ?></th><th>Server</th><th><?= e(t('Type')) ?></th><th><?= e(t('Status')) ?></th><th><?= e(t('Expires in')) ?></th><th><?= e(t('Comment')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $l) { $dyn = in_array((string)($l['dynamic'] ?? ''), ['true', 'yes'], true); $off = NetworkController::off($l); ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($l['.id']) ?>" aria-label="<?= e($l['address'] ?? '') ?>"></td>
          <td data-label="<?= e(t('IP address')) ?>" class="mono"><?= e($l['address'] ?? '') ?></td>
          <td data-label="MAC" class="mono"><?= e($l['mac-address'] ?? '') ?></td>
          <td data-label="<?= e(t('Host name')) ?>"><?= e($l['host-name'] ?? '') ?: '-' ?></td>
          <td data-label="Server"><?= e($l['server'] ?? '') ?></td>
          <td data-label="<?= e(t('Type')) ?>"><?= $dyn ? badge(t('dynamic'), 'neutral') : badge(t('static'), 'info') ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= $off ? badge(t('Disabled'), 'err') : (($l['status'] ?? '') === 'bound' ? badge('bound', 'ok') : badge($l['status'] ?? 'waiting', 'warn')) ?></td>
          <td data-label="<?= e(t('Expires in')) ?>" class="mono"><?= e($l['expires-after'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($l['comment'] ?? '') ?></td>
          <td class="actions" data-label=""><?php if ($canW && !$dyn) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-lease" data-edit="<?= jattr(['id' => $l['.id'], 'address' => $l['address'] ?? '', 'mac' => $l['mac-address'] ?? '', 'server' => $l['server'] ?? '', 'comment' => $l['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?= pager($pg, $pages, $total) ?>
    <?php } ?>
  </form>
</section>
<?php if ($canW) { ?>
<dialog class="modal" id="dlg-lease" aria-labelledby="dlg-lease-t">
  <form method="post" action="<?= e(url('/dhcp/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-lease-t"><?= e(t('Static lease')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="l-ip"><?= e(t('IP address')) ?></label><input class="input mono" id="l-ip" name="address" required placeholder="10.5.50.30"></div>
      <div class="field"><label for="l-mac">MAC</label><input class="input mono" id="l-mac" name="mac" required placeholder="AA:BB:CC:DD:EE:FF"></div>
      <div class="field"><label for="l-srv">DHCP server</label><input class="input" id="l-srv" name="server" list="dl-srv" placeholder="<?= e(t('(optional)')) ?>"><datalist id="dl-srv"><?php foreach ($servers as $s) { ?><option value="<?= e($s) ?>"><?php } ?></datalist></div>
      <div class="field"><label for="l-com"><?= e(t('Comment')) ?></label><input class="input" id="l-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
