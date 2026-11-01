<?php /** Vars: $rows $profiles $profInfo $batches $q $prof $batch $status $pg $pages $total */
$canW = Auth::can('write');
$back = App::path() . (($_SERVER['QUERY_STRING'] ?? '') !== '' ? '?' . $_SERVER['QUERY_STRING'] : '');
?>
<?= page_head(t('Hotspot users'), t('Create, filter and manage hotspot accounts.'),
    ($canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-user" data-new>' . icon('plus', 16) . e(t('Add user')) . '</button>' : '')
    . (Auth::can('sell') ? '<a class="btn" href="' . e(url('/vouchers')) . '">' . icon('ticket', 16) . e(t('Generate vouchers')) . '</a>' : '')) ?>

<section class="card glass">
  <form class="tbl-tools" method="get" action="<?= e(url('/hotspot/users')) ?>" role="search">
    <input class="input search" type="search" name="q" value="<?= e($q) ?>" placeholder="<?= e(t('Search name or comment')) ?>" aria-label="<?= e(t('Search')) ?>">
    <select class="select" name="profile" aria-label="<?= e(t('Profile')) ?>" data-autosubmit><option value=""><?= e(t('All profiles')) ?></option>
      <?php foreach ($profiles as $p) { ?><option<?= sel($p, $prof) ?>><?= e($p) ?></option><?php } ?></select>
    <select class="select" name="batch" aria-label="<?= e(t('Batch')) ?>" data-autosubmit><option value=""><?= e(t('All batches')) ?></option>
      <?php foreach ($batches as $b) { ?><option<?= sel($b, $batch) ?>><?= e($b) ?></option><?php } ?></select>
    <select class="select" name="status" aria-label="<?= e(t('Status')) ?>" data-autosubmit><option value=""><?= e(t('Any status')) ?></option>
      <?php foreach (['new' => 'Unused', 'online' => 'Online', 'used' => 'Used', 'expired' => 'Expired', 'disabled' => 'Disabled'] as $k => $l) { ?><option value="<?= $k ?>"<?= sel($k, $status) ?>><?= e(t($l)) ?></option><?php } ?></select>
    <button class="btn btn-sm"><?= icon('filter', 16) ?><?= e(t('Filter')) ?></button>
    <span class="spacer"></span>
    <button class="btn btn-sm btn-ghost hide-m" type="button" data-density><?= e(t('Density')) ?></button>
  </form>

  <form method="post" action="<?= e(url('/hotspot/users/action')) ?>" id="bulk" data-bulk>
    <?= csrf_field() ?><input type="hidden" name="back" value="<?= e($back) ?>">
    <div class="sel-bar" data-sel-bar hidden>
      <span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?>
      <button class="btn btn-sm" name="action" value="disable"><?= icon('ban', 16) ?><?= e(t('Disable')) ?></button>
      <button class="btn btn-sm" name="action" value="enable"><?= icon('check', 16) ?><?= e(t('Enable')) ?></button>
      <button class="btn btn-sm" name="action" value="kick"><?= icon('logout', 16) ?><?= e(t('Kick')) ?></button>
      <button class="btn btn-sm btn-danger" name="action" value="delete" data-confirm="<?= e(t('Delete the selected users? This cannot be undone.')) ?>"><?= icon('trash', 16) ?><?= e(t('Delete')) ?></button>
      <?php } ?>
    </div>
    <?php if (!$rows) { ?>
      <?= empty_state('users', t('No users found'), t('Try different filters, or generate a batch of vouchers.'), Auth::can('sell') ? '<a class="btn btn-primary" href="' . e(url('/vouchers')) . '">' . e(t('Generate vouchers')) . '</a>' : '') ?>
    <?php } else { ?>
    <div class="table-wrap">
      <table class="tbl resp" id="users-tbl">
        <thead><tr>
          <th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th>
          <th data-sort><?= e(t('User')) ?></th><th data-sort data-chip><?= e(t('Profile')) ?></th><th data-sort data-chip><?= e(t('Status')) ?></th>
          <th data-sort><?= e(t('Uptime')) ?></th><th class="num"><?= e(t('Data in / out')) ?></th><th><?= e(t('Comment / expiry')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th>
        </tr></thead>
        <tbody>
        <?php foreach ($rows as $u) { ?>
          <tr>
            <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($u['.id']) ?>" aria-label="<?= e($u['name']) ?>"></td>
            <td data-label="<?= e(t('User')) ?>"><span class="mono"><b><?= e($u['name']) ?></b></span><?php if ($canW && ($u['password'] ?? '') !== '' && $u['password'] !== $u['name']) { ?> <span class="muted mono">/ <?= e($u['password']) ?></span><?php } ?></td>
            <td data-label="<?= e(t('Profile')) ?>"><?= e($u['profile'] ?? '') ?></td>
            <td data-label="<?= e(t('Status')) ?>"><?= user_status_badge($u['_status']) ?></td>
            <td data-label="<?= e(t('Uptime')) ?>" class="mono"><?= e($u['uptime'] ?? '0s') ?></td>
            <td data-label="<?= e(t('Data in / out')) ?>" class="num mono nowrap"><?= e(fmt_bytes($u['bytes-in'] ?? 0)) ?> / <?= e(fmt_bytes($u['bytes-out'] ?? 0)) ?></td>
            <td data-label="<?= e(t('Comment')) ?>" class="wrap"><?php if ($u['_exp']) { ?><span class="badge badge-warn" title="<?= e(t('Expires')) ?>"><?= e($u['_exp']) ?></span> <?php } ?><span class="muted"><?= e(trim(preg_replace('~^[a-z]{3}/\d\d/\d{4} \d\d:\d\d:\d\d~i', '', (string)($u['comment'] ?? '')))) ?></span></td>
            <td class="actions" data-label="">
              <?php if ($canW) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-user" data-edit="<?= jattr(['id' => $u['.id'], 'name' => $u['name'], 'password' => $u['password'] ?? '', 'profile' => $u['profile'] ?? '', 'comment' => $u['comment'] ?? '', 'limit_uptime' => in_array($u['limit-uptime'] ?? '', ['0s', '1s'], true) ? '' : ($u['limit-uptime'] ?? ''), 'limit_bytes' => ($u['limit-bytes-total'] ?? '0') === '0' ? '' : $u['limit-bytes-total'], 'mac' => ($u['mac-address'] ?? '') === '00:00:00:00:00:00' ? '' : ($u['mac-address'] ?? ''), 'disabled' => ($u['disabled'] ?? '') === 'true' ? '1' : '0']) ?>"><?= icon('edit', 16) ?></button><?php } ?>
            </td>
          </tr>
        <?php } ?>
        </tbody>
      </table>
    </div>
    <?= pager($pg, $pages, $total) ?>
    <?php } ?>
  </form>
</section>

<?php if ($canW) { ?>
<dialog class="modal" id="dlg-user" aria-labelledby="dlg-user-t">
  <form method="post" action="<?= e(url('/hotspot/users/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id"><input type="hidden" name="back" value="<?= e($back) ?>">
    <div class="modal-h"><h2 id="dlg-user-t"><?= e(t('Hotspot user')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="u-name"><?= e(t('Username')) ?></label><input class="input mono" id="u-name" name="name" required maxlength="64" autocapitalize="off" autocomplete="off"></div>
      <div class="field"><label for="u-pass"><?= e(t('Password')) ?></label><input class="input mono" id="u-pass" name="password" autocomplete="off"></div>
      <div class="field"><label for="u-prof"><?= e(t('Profile')) ?></label><select class="select" id="u-prof" name="profile"><?php foreach ($profiles as $p) { ?><option><?= e($p) ?></option><?php } ?></select></div>
      <div class="field"><label for="u-mac"><?= e(t('MAC address (lock)')) ?></label><input class="input mono" id="u-mac" name="mac" placeholder="AA:BB:CC:DD:EE:FF"></div>
      <div class="field"><label for="u-lim"><?= e(t('Time limit')) ?></label><input class="input mono" id="u-lim" name="limit_uptime" placeholder="1h30m" autocapitalize="off"></div>
      <div class="field"><label for="u-bytes"><?= e(t('Data limit (bytes)')) ?></label><input class="input mono" id="u-bytes" name="limit_bytes" inputmode="numeric" placeholder="1073741824"></div>
      <div class="full"><p class="help"><b><?= e(t('Validity')) ?></b> <?= e(t('is the active period counted from first login (set per profile). ')) ?><b><?= e(t('Time limit')) ?></b> <?= e(t('is the total online time and stops counting while logged out. Time limit must not exceed validity.')) ?></p></div>
      <div class="field full"><label for="u-com"><?= e(t('Comment')) ?></label><input class="input" id="u-com" name="comment" maxlength="120"></div>
      <div class="field full" data-edit-only><label class="switch"><input type="checkbox" name="disabled" value="1"><span class="track"></span><span><?= e(t('Disabled')) ?></span></label></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
