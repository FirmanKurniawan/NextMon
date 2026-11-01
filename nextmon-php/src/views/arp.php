<?php
/** Vars: $rows $q $iface $type $ifaces $ifList $pg $pages $total */
$canW = Auth::can('write');
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-network.css')) ?>">
<?= page_head(t('ARP'), t('Address resolution table. Static entries pin an IP to a MAC address.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-arp" data-new>' . icon('plus', 16) . e(t('Add static entry')) . '</button>' : '') ?>
<section class="card glass">
  <form class="nm-toolbar" method="get" action="<?= e(url('/arp')) ?>">
    <input class="input search" type="search" name="q" value="<?= e($q) ?>" placeholder="<?= e(t('Search IP, MAC or comment')) ?>" aria-label="<?= e(t('Search')) ?>">
    <select class="select select-sm" name="iface" style="width:auto" aria-label="<?= e(t('Interface')) ?>" data-autosubmit><option value=""><?= e(t('All interfaces')) ?></option><?php foreach ($ifaces as $i) { ?><option<?= sel($i, $iface) ?>><?= e($i) ?></option><?php } ?></select>
    <select class="select select-sm" name="type" style="width:auto" aria-label="<?= e(t('Type')) ?>" data-autosubmit><option value=""><?= e(t('Static and dynamic')) ?></option><option value="dynamic"<?= sel('dynamic', $type) ?>><?= e(t('Dynamic only')) ?></option><option value="static"<?= sel('static', $type) ?>><?= e(t('Static only')) ?></option></select>
    <button class="btn btn-sm"><?= icon('search', 16) ?><?= e(t('Search')) ?></button>
  </form>
  <form method="post" action="<?= e(url('/arp/action')) ?>" data-bulk>
    <?= csrf_field() ?>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?>
      <button class="btn btn-sm btn-primary" name="action" value="static"><?= e(t('Make static')) ?></button>
      <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
      <button class="btn btn-sm" name="action" value="disable"><?= e(t('Disable')) ?></button>
      <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Remove the selected static entries? Dynamic entries are skipped.')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button>
      <?php } ?></div>
    <?php if (!$rows) { echo empty_state('link', t('No ARP entries found')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('IP address')) ?></th><th>MAC</th><th><?= e(t('Interface')) ?></th><th><?= e(t('Type')) ?></th><th><?= e(t('Status')) ?></th><th><?= e(t('Comment')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $a) { $dyn = in_array((string)($a['dynamic'] ?? ''), ['true', 'yes'], true); $off = NetworkController::off($a); ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($a['.id']) ?>" aria-label="<?= e($a['address'] ?? '') ?>"></td>
          <td data-label="<?= e(t('IP address')) ?>" class="mono"><?= e($a['address'] ?? '') ?></td>
          <td data-label="MAC" class="mono"><?= e($a['mac-address'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Interface')) ?>"><?= e($a['interface'] ?? '') ?></td>
          <td data-label="<?= e(t('Type')) ?>"><?= $dyn ? badge(t('dynamic'), 'neutral') : badge(t('static'), 'info') ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= $off ? badge(t('Disabled'), 'err') : (in_array((string)($a['invalid'] ?? ''), ['true', 'yes'], true) ? badge(t('Invalid'), 'warn') : badge(t('Active'), 'ok')) ?></td>
          <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($a['comment'] ?? '') ?></td>
          <td class="actions" data-label=""><?php if ($canW && !$dyn) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-arp" data-edit="<?= jattr(['id' => $a['.id'], 'address' => $a['address'] ?? '', 'mac' => $a['mac-address'] ?? '', 'interface' => $a['interface'] ?? '', 'comment' => $a['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?= pager($pg, $pages, $total) ?>
    <?php } ?>
  </form>
</section>
<?php if ($canW) { ?>
<dialog class="modal" id="dlg-arp" aria-labelledby="dlg-arp-t">
  <form method="post" action="<?= e(url('/arp/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-arp-t"><?= e(t('Static ARP entry')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="a-ip"><?= e(t('IP address')) ?></label><input class="input mono" id="a-ip" name="address" required placeholder="10.5.50.30"></div>
      <div class="field"><label for="a-mac">MAC</label><input class="input mono" id="a-mac" name="mac" required placeholder="AA:BB:CC:DD:EE:FF"></div>
      <div class="field"><label for="a-if"><?= e(t('Interface')) ?></label><select class="select" id="a-if" name="interface"><?php foreach ($ifList as $i) { ?><option><?= e($i) ?></option><?php } ?></select></div>
      <div class="field"><label for="a-com"><?= e(t('Comment')) ?></label><input class="input" id="a-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
