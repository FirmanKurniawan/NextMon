<?php /** Vars: $token $j $rows $shown $totalRows $only */
$c = $j['counts'];
$stBadge = ['new' => ['New', 'ok'], 'update' => ['Update', 'info'], 'skip' => ['Skip (exists)', 'warn'], 'error' => ['Error', 'err']];
$importable = $c['new'] + $c['update'];
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Import preview'), $j['file'] . ' - ' . t('nothing has been written yet'),
    '<a class="btn" href="' . e(url('/import/errors?t=' . $token)) . '">' . icon('download', 16) . e(t('Error report')) . '</a>') ?>

<section class="card glass" style="margin-bottom:var(--s4)"><div class="card-b">
  <div class="imp-sum">
    <?= badge(t(':n rows', [':n' => array_sum($c)]), 'neutral') ?>
    <?= badge(t(':n new', [':n' => $c['new']]), 'ok') ?>
    <?= badge(t(':n to update', [':n' => $c['update']]), 'info') ?>
    <?= badge(t(':n skipped', [':n' => $c['skip']]), 'warn') ?>
    <?= badge(t(':n with errors', [':n' => $c['error']]), $c['error'] ? 'err' : 'neutral') ?>
  </div>
  <?php if ($c['error']) { ?><div class="alert warn" style="margin-bottom:var(--s3)"><?= icon('alert', 18) ?><div><?= e(t('Rows with errors are left out. Fix them in the CSV and upload again, or import the valid rows now.')) ?></div></div><?php } ?>
  <form method="post" action="<?= e(url('/import/commit')) ?>" class="stack">
    <?= csrf_field() ?><input type="hidden" name="t" value="<?= e($token) ?>">
    <div class="row">
      <label class="switch"><input type="radio" name="mode" value="skip"<?= chk($j['mode'] === 'skip') ?>><span class="track"></span><span><?= e(t('Skip existing users')) ?></span></label>
      <label class="switch"><input type="radio" name="mode" value="overwrite"<?= chk($j['mode'] === 'overwrite') ?>><span class="track"></span><span><?= e(t('Overwrite existing users')) ?></span></label>
    </div>
    <label class="switch"><input type="checkbox" name="dry" value="1"><span class="track"></span><span><?= e(t('Dry run: count what would change, write nothing')) ?></span></label>
    <div class="row">
      <button class="btn btn-primary"<?= $c['new'] + $c['update'] + $c['skip'] === 0 ? ' disabled' : '' ?>><?= icon('check', 16) ?><?= e(t('Run import')) ?></button>
      <button class="btn btn-ghost" formaction="<?= e(url('/import/cancel')) ?>"><?= e(t('Cancel')) ?></button>
    </div>
    <p class="help"><?= e(t('The new/update/skip counts above follow the choice made at upload; the final choice here is applied against the router as it is now.')) ?></p>
  </form>
</div></section>

<section class="card glass">
  <div class="tbl-tools">
    <a class="btn btn-sm<?= $only ? '' : ' btn-primary' ?>" href="<?= e(url('/import/preview?t=' . $token)) ?>"><?= e(t('All rows')) ?></a>
    <a class="btn btn-sm<?= $only ? ' btn-primary' : '' ?>" href="<?= e(url('/import/preview?t=' . $token . '&show=errors')) ?>"><?= e(t('Errors only')) ?></a>
    <span class="spacer"></span><span class="muted"><?= e(t('Showing :a of :b', [':a' => $shown, ':b' => $totalRows])) ?></span>
  </div>
  <div class="table-wrap"><table class="tbl resp compact">
    <thead><tr><th><?= e(t('Line')) ?></th><th><?= e(t('Result')) ?></th><th><?= e(t('Name')) ?></th><th><?= e(t('Password')) ?></th><th><?= e(t('Profile')) ?></th><th><?= e(t('Time Limit')) ?></th><th><?= e(t('Data Limit')) ?></th><th><?= e(t('Comment')) ?></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r) { $d = $r['d']; [$l, $k] = $stBadge[$r['st']]; ?>
      <tr class="<?= $r['st'] === 'error' ? 'imp-row-err' : ($r['st'] === 'skip' ? 'imp-row-dup' : '') ?>">
        <td data-label="<?= e(t('Line')) ?>" class="mono"><?= (int)$r['line'] ?></td>
        <td data-label="<?= e(t('Result')) ?>"><?= badge(t($l), $k) ?><?php foreach ($r['err'] as $m) { ?><div class="help"><?= e($m) ?></div><?php } ?></td>
        <td data-label="<?= e(t('Name')) ?>" class="mono"><?= e($d['name'] ?? '') ?></td>
        <td data-label="<?= e(t('Password')) ?>" class="mono"><?= isset($d['password']) && $d['password'] !== '' ? '••••' : '<span class="muted">-</span>' ?></td>
        <td data-label="<?= e(t('Profile')) ?>"><?= e($d['profile'] ?? '') ?></td>
        <td data-label="<?= e(t('Time Limit')) ?>" class="mono"><?= e($d['limit-uptime'] ?? '') ?></td>
        <td data-label="<?= e(t('Data Limit')) ?>" class="mono"><?= e($d['limit-bytes-total'] ?? '') ?></td>
        <td data-label="<?= e(t('Comment')) ?>" class="wrap"><?= e($d['comment'] ?? '') ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
</section>
