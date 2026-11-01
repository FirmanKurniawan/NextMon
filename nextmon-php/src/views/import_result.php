<?php /** Vars: $token $res */ ?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head($res['dry'] ? t('Dry run finished') : t('Import finished'), $res['file'] . ' - ' . date('Y-m-d H:i:s', (int)$res['ts']),
    '<a class="btn" href="' . e(url('/hotspot/users')) . '">' . icon('users', 16) . e(t('Hotspot users')) . '</a><a class="btn" href="' . e(url('/import')) . '">' . e(t('Import another file')) . '</a>'
    . ($res['dry'] ? '<a class="btn btn-primary" href="' . e(url('/import/preview?t=' . $token)) . '">' . e(t('Back to preview')) . '</a>' : '')) ?>
<?php if ($res['dry']) { ?><div class="alert info" style="margin-bottom:var(--s4)"><?= icon('alert', 18) ?><div><?= e(t('Dry run: nothing was written to the router. Run the import again without the dry-run option to apply.')) ?></div></div><?php } ?>
<div class="grid" style="margin-bottom:var(--s4)">
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e($res['dry'] ? t('Would add') : t('Added')) ?></div><div class="stat-value rs-pos"><?= (int)$res['added'] ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e($res['dry'] ? t('Would update') : t('Updated')) ?></div><div class="stat-value"><?= (int)$res['updated'] ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Skipped')) ?></div><div class="stat-value"><?= (int)$res['skipped'] ?></div></div></section>
  <section class="card glass col-3"><div class="card-b"><div class="stat-label"><?= e(t('Errors')) ?></div><div class="stat-value <?= $res['errors'] ? 'rs-neg' : '' ?>"><?= (int)$res['errors'] ?></div></div></section>
</div>
<?php if ($res['rowErrors']) { ?>
<section class="card glass">
  <div class="card-h"><h2><?= e(t('Row errors')) ?></h2><a class="btn btn-sm" href="<?= e(url('/import/errors?t=' . $token)) ?>"><?= icon('download', 16) ?>CSV</a></div>
  <div class="table-wrap"><table class="tbl resp compact">
    <thead><tr><th><?= e(t('Line')) ?></th><th><?= e(t('Name')) ?></th><th><?= e(t('Error')) ?></th></tr></thead>
    <tbody>
    <?php foreach (array_slice($res['rowErrors'], 0, 300) as $e) { ?>
      <tr><td data-label="<?= e(t('Line')) ?>" class="mono"><?= (int)$e['line'] ?></td><td data-label="<?= e(t('Name')) ?>" class="mono"><?= e($e['name']) ?></td><td data-label="<?= e(t('Error')) ?>" class="wrap"><?= e($e['error']) ?></td></tr>
    <?php } ?>
    </tbody>
  </table></div>
</section>
<?php } ?>
