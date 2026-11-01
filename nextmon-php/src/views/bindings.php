<?php /** Vars: $rows */ $canW = Auth::can('write'); ?>
<?= page_head(t('IP bindings'), t('Bypass or block devices by MAC or address without a login.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-bind" data-new>' . icon('plus', 16) . e(t('Add binding')) . '</button>' : '') ?>
<section class="card glass">
  <form method="post" action="<?= e(url('/hotspot/bindings/action')) ?>" data-bulk>
    <?= csrf_field() ?>
    <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#bind-tbl" aria-label="<?= e(t('Filter')) ?>"><span class="spacer"></span></div>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?>
      <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
      <button class="btn btn-sm" name="action" value="disable"><?= e(t('Disable')) ?></button>
      <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Remove the selected bindings?')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button>
      <?php } ?></div>
    <?php if (!$rows) { echo empty_state('link', t('No bindings')); } else { ?>
    <div class="table-wrap"><table class="tbl resp" id="bind-tbl">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th>MAC</th><th><?= e(t('IP address')) ?></th><th data-sort data-chip><?= e(t('Type')) ?></th><th>Server</th><th data-sort data-chip><?= e(t('Status')) ?></th><th><?= e(t('Comment')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $b) { $kind = ['bypassed' => 'ok', 'blocked' => 'err'][$b['type'] ?? ''] ?? 'neutral'; ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($b['.id']) ?>" aria-label="<?= e($b['address'] ?? $b['mac-address'] ?? '') ?>"></td>
          <td data-label="MAC" class="mono"><?= e($b['mac-address'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('IP address')) ?>" class="mono"><?= e($b['address'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Type')) ?>"><?= badge($b['type'] ?? 'regular', $kind) ?></td>
          <td data-label="Server"><?= e($b['server'] ?? 'all') ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= ($b['disabled'] ?? '') === 'true' ? badge(t('Disabled'), 'warn') : badge(t('Active'), 'ok') ?></td>
          <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($b['comment'] ?? '') ?></td>
          <td class="actions" data-label=""><?php if ($canW) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-bind" data-edit="<?= jattr(['id' => $b['.id'], 'mac' => $b['mac-address'] ?? '', 'address' => $b['address'] ?? '', 'to_address' => $b['to-address'] ?? '', 'server' => $b['server'] ?? 'all', 'type' => $b['type'] ?? 'regular', 'comment' => $b['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </form>
</section>
<?php if ($canW) { ?>
<dialog class="modal" id="dlg-bind" aria-labelledby="dlg-bind-t">
  <form method="post" action="<?= e(url('/hotspot/bindings/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-bind-t"><?= e(t('IP binding')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="b-mac">MAC</label><input class="input mono" id="b-mac" name="mac" placeholder="AA:BB:CC:DD:EE:FF"></div>
      <div class="field"><label for="b-addr"><?= e(t('IP address')) ?></label><input class="input mono" id="b-addr" name="address"></div>
      <div class="field"><label for="b-to"><?= e(t('To address')) ?></label><input class="input mono" id="b-to" name="to_address"></div>
      <div class="field"><label for="b-srv">Server</label><input class="input" id="b-srv" name="server" value="all"></div>
      <div class="field full"><label for="b-type"><?= e(t('Type')) ?></label><select class="select" id="b-type" name="type"><option value="bypassed">bypassed</option><option value="regular">regular</option><option value="blocked">blocked</option></select></div>
      <div class="field full"><label for="b-com"><?= e(t('Comment')) ?></label><input class="input" id="b-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
