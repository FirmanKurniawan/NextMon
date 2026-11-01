<?php /** Vars: $rows */ $canW = Auth::can('write'); ?>
<?= page_head(t('Hosts'), t('Every device seen by the hotspot, authorized or not.')) ?>
<section class="card glass">
  <form method="post" action="<?= e(url('/hotspot/hosts/remove')) ?>" data-bulk>
    <?= csrf_field() ?><input type="hidden" name="back" value="/hotspot/hosts">
    <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#host-tbl" aria-label="<?= e(t('Filter')) ?>"><span class="spacer"></span></div>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?><button class="btn btn-sm btn-danger" data-confirm="<?= e(t('Remove the selected hosts?')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button><?php } ?></div>
    <?php if (!$rows) { echo empty_state('monitor', t('No hosts')); } else { ?>
    <div class="table-wrap"><table class="tbl resp" id="host-tbl">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th>MAC</th><th data-sort><?= e(t('IP address')) ?></th><th><?= e(t('To address')) ?></th><th>Server</th><th data-chip><?= e(t('Authorized')) ?></th><th><?= e(t('Comment')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $h) { ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($h['.id']) ?>" aria-label="<?= e($h['mac-address'] ?? '') ?>"></td>
          <td data-label="MAC" class="mono"><?= e($h['mac-address'] ?? '') ?></td>
          <td data-label="<?= e(t('IP address')) ?>" class="mono"><?= e($h['address'] ?? '') ?></td>
          <td data-label="<?= e(t('To address')) ?>" class="mono"><?= e($h['to-address'] ?? '') ?: '-' ?></td>
          <td data-label="Server"><?= e($h['server'] ?? '') ?></td>
          <td data-label="<?= e(t('Authorized')) ?>"><?= ($h['authorized'] ?? '') === 'true' ? badge(t('Yes'), 'ok') : badge(t('No')) ?></td>
          <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($h['comment'] ?? '') ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </form>
</section>
