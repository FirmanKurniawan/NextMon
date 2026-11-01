<?php /** Vars: $rows $hasRule */ $canW = Auth::can('write'); ?>
<?= page_head(t('Firewall address list'), t('Block or allow addresses with firewall address-lists.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-fw" data-new>' . icon('ban', 16) . e(t('Block address')) . '</button>' : '') ?>

<?php if (!$hasRule) { ?>
<div class="alert warn" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div style="flex:1"><?= e(t('List "nextmon-block" has no drop rule yet, so blocked addresses are not enforced.')) ?></div>
  <?php if (Auth::can('admin')) { ?><form method="post" action="<?= e(url('/firewall/rule')) ?>"><?= csrf_field() ?><button class="btn btn-sm"><?= e(t('Install drop rule')) ?></button></form><?php } ?></div>
<?php } ?>

<section class="card glass">
  <form method="post" action="<?= e(url('/firewall/remove')) ?>" data-bulk>
    <?= csrf_field() ?>
    <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#fw-tbl" aria-label="<?= e(t('Filter')) ?>"></div>
    <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
      <?php if ($canW) { ?><button class="btn btn-sm btn-danger" data-confirm="<?= e(t('Remove the selected entries?')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button><?php } ?></div>
    <?php if (!$rows) { echo empty_state('shield', t('No entries')); } else { ?>
    <div class="table-wrap"><table class="tbl resp" id="fw-tbl">
      <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th><th data-sort><?= e(t('List')) ?></th><th data-sort><?= e(t('Address')) ?></th><th><?= e(t('Timeout')) ?></th><th><?= e(t('Comment')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $a) { ?>
        <tr>
          <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($a['.id']) ?>" aria-label="<?= e($a['address'] ?? '') ?>"></td>
          <td data-label="<?= e(t('List')) ?>"><?= badge($a['list'] ?? '', ($a['list'] ?? '') === 'nextmon-block' ? 'err' : 'neutral') ?></td>
          <td data-label="<?= e(t('Address')) ?>" class="mono"><?= e($a['address'] ?? '') ?></td>
          <td data-label="<?= e(t('Timeout')) ?>" class="mono"><?= e($a['timeout'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($a['comment'] ?? '') ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </form>
</section>
<?php if ($canW) { ?>
<dialog class="modal" id="dlg-fw" aria-labelledby="dlg-fw-t">
  <form method="post" action="<?= e(url('/firewall/add')) ?>">
    <?= csrf_field() ?>
    <div class="modal-h"><h2 id="dlg-fw-t"><?= e(t('Add to address list')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="f-list"><?= e(t('List')) ?></label><input class="input mono" id="f-list" name="list" value="nextmon-block" required></div>
      <div class="field"><label for="f-addr"><?= e(t('Address')) ?></label><input class="input mono" id="f-addr" name="address" required placeholder="10.5.50.77"></div>
      <div class="field"><label for="f-to"><?= e(t('Timeout')) ?></label><input class="input mono" id="f-to" name="timeout" placeholder="1d" autocapitalize="off"><p class="help"><?= e(t('Empty = permanent.')) ?></p></div>
      <div class="field"><label for="f-com"><?= e(t('Comment')) ?></label><input class="input" id="f-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Add')) ?></button></div>
  </form>
</dialog>
<?php } ?>
