<?php /** Vars: $rows */ $canW = Auth::can('write'); ?>
<?= page_head(t('Queues'), t('Simple queues: limit bandwidth per IP or network.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-queue" data-new>' . icon('plus', 16) . e(t('Add queue')) . '</button>' : '') ?>
<section class="card glass">
  <form method="post" action="<?= e(url('/queues/action')) ?>" data-bulk>
    <?= csrf_field() ?>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?>
      <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
      <button class="btn btn-sm" name="action" value="disable"><?= e(t('Disable')) ?></button>
      <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Remove the selected queues?')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button>
      <?php } ?></div>
    <?php if (!$rows) { echo empty_state('layers', t('No queues')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('Name')) ?></th><th><?= e(t('Target')) ?></th><th><?= e(t('Max limit (up/down)')) ?></th><th><?= e(t('Traffic (up/down)')) ?></th><th><?= e(t('Status')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $q) { $b = explode('/', (string)($q['bytes'] ?? '0/0')); ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($q['.id']) ?>" aria-label="<?= e($q['name'] ?? '') ?>"></td>
          <td data-label="<?= e(t('Name')) ?>"><b><?= e($q['name'] ?? '') ?></b><?php if (!empty($q['comment'])) { ?> <span class="muted"><?= e($q['comment']) ?></span><?php } ?></td>
          <td data-label="<?= e(t('Target')) ?>" class="mono wrap"><?= e($q['target'] ?? '') ?></td>
          <td data-label="<?= e(t('Max limit (up/down)')) ?>" class="mono"><?= e($q['max-limit'] ?? '') ?></td>
          <td data-label="<?= e(t('Traffic (up/down)')) ?>" class="mono nowrap"><?= e(fmt_bytes($b[0] ?? 0)) ?> / <?= e(fmt_bytes($b[1] ?? 0)) ?></td>
          <td data-label="<?= e(t('Status')) ?>"><?= ($q['disabled'] ?? '') === 'true' ? badge(t('Disabled'), 'warn') : badge(t('Active'), 'ok') ?></td>
          <td class="actions" data-label=""><?php if ($canW) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-queue" data-edit="<?= jattr(['id' => $q['.id'], 'name' => $q['name'] ?? '', 'target' => $q['target'] ?? '', 'max_limit' => $q['max-limit'] ?? '', 'comment' => $q['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </form>
</section>
<?php if ($canW) { ?>
<dialog class="modal" id="dlg-queue" aria-labelledby="dlg-queue-t">
  <form method="post" action="<?= e(url('/queues/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-queue-t"><?= e(t('Simple queue')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="q-name"><?= e(t('Name')) ?></label><input class="input" id="q-name" name="name" required maxlength="40"></div>
      <div class="field"><label for="q-target"><?= e(t('Target')) ?></label><input class="input mono" id="q-target" name="target" required placeholder="10.5.50.2/32"></div>
      <div class="field"><label for="q-max"><?= e(t('Max limit (up/down)')) ?></label><input class="input mono" id="q-max" name="max_limit" required placeholder="5M/5M" value="5M/5M"></div>
      <div class="field"><label for="q-com"><?= e(t('Comment')) ?></label><input class="input" id="q-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
