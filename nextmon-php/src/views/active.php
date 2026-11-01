<?php /** Vars: $rows */ $canW = Auth::can('write'); ?>
<?= page_head(t('Active sessions'), t('Users currently logged in to the hotspot.'),
    '<label class="switch"><input type="checkbox" data-autoreload="10"><span class="track"></span><span>' . e(t('Auto refresh')) . '</span></label>') ?>
<section class="card glass">
  <form method="post" action="<?= e(url('/hotspot/active/kick')) ?>" data-bulk>
    <?= csrf_field() ?><input type="hidden" name="back" value="/hotspot/active">
    <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#act-tbl" aria-label="<?= e(t('Filter')) ?>"><span class="spacer"></span></div>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?><button class="btn btn-sm btn-danger" data-confirm="<?= e(t('Disconnect the selected sessions?')) ?>"><?= icon('logout', 16) ?><?= e(t('Kick')) ?></button><?php } ?></div>
    <?php if (!$rows) { echo empty_state('activity', t('Nobody is online right now')); } else { ?>
    <div class="table-wrap"><table class="tbl resp" id="act-tbl">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('User')) ?></th><th data-sort><?= e(t('IP address')) ?></th><th>MAC</th><th data-sort><?= e(t('Uptime')) ?></th><th><?= e(t('Time left')) ?></th><th class="num"><?= e(t('Data in / out')) ?></th><th data-chip><?= e(t('Login by')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $a) { ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($a['.id']) ?>" aria-label="<?= e($a['user'] ?? '') ?>"></td>
          <td data-label="<?= e(t('User')) ?>" class="mono"><b><?= e($a['user'] ?? '') ?></b></td>
          <td data-label="<?= e(t('IP address')) ?>" class="mono"><?= e($a['address'] ?? '') ?></td>
          <td data-label="MAC" class="mono"><?= e($a['mac-address'] ?? '') ?></td>
          <td data-label="<?= e(t('Uptime')) ?>" class="mono"><?= e($a['uptime'] ?? '') ?></td>
          <td data-label="<?= e(t('Time left')) ?>" class="mono"><?= e($a['session-time-left'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Data in / out')) ?>" class="num mono nowrap"><?= e(fmt_bytes($a['bytes-in'] ?? 0)) ?> / <?= e(fmt_bytes($a['bytes-out'] ?? 0)) ?></td>
          <td data-label="<?= e(t('Login by')) ?>" class="wrap muted"><?= e($a['login-by'] ?? '') ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </form>
</section>
