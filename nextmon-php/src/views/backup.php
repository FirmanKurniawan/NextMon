<?php /** Vars: $files */ ?>
<?= page_head(t('Backup'), t('Create files on the router and download exports.')) ?>
<div class="grid">
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('On the router')) ?></h2></div>
    <div class="card-b stack">
      <p class="muted"><?= e(t('The binary backup (.backup) restores everything including users; the export (.rsc) is a readable script.')) ?></p>
      <div class="row">
        <form method="post" action="<?= e(url('/backup/create')) ?>"><?= csrf_field() ?><input type="hidden" name="type" value="backup"><button class="btn btn-primary"><?= icon('download', 16) ?><?= e(t('Create .backup')) ?></button></form>
        <form method="post" action="<?= e(url('/backup/create')) ?>"><?= csrf_field() ?><input type="hidden" name="type" value="rsc"><button class="btn"><?= icon('file', 16) ?><?= e(t('Create .rsc export')) ?></button></form>
      </div>
    </div>
  </section>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Download')) ?></h2></div>
    <div class="card-b stack">
      <div class="row">
        <a class="btn" href="<?= e(url('/backup/download?type=users')) ?>"><?= icon('download', 16) ?><?= e(t('Users (CSV)')) ?></a>
        <a class="btn" href="<?= e(url('/backup/download?type=profiles')) ?>"><?= icon('download', 16) ?><?= e(t('Profiles (JSON)')) ?></a>
        <a class="btn" href="<?= e(url('/backup/download?type=rsc')) ?>"><?= icon('download', 16) ?><?= e(t('Config export (.rsc)')) ?></a>
        <a class="btn" href="<?= e(url('/backup/download?type=app')) ?>"><?= icon('download', 16) ?><?= e(t('NextMON settings (JSON)')) ?></a>
      </div>
      <p class="help"><?= e(t('The users CSV contains passwords: store it safely. .rsc download over the API is best effort; binary .backup files must be fetched with FTP/Winbox.')) ?></p>
    </div>
  </section>
  <section class="card glass col-12">
    <div class="card-h"><h2><?= e(t('Files on router')) ?></h2></div>
    <?php if (!$files) { echo empty_state('file', t('No backup files'), t('Create one with the buttons above.')); } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('File')) ?></th><th><?= e(t('Type')) ?></th><th class="num"><?= e(t('Size')) ?></th><th><?= e(t('Created')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($files as $f) { ?>
        <tr>
          <td data-label="<?= e(t('File')) ?>" class="mono"><?= e($f['name']) ?></td>
          <td data-label="<?= e(t('Type')) ?>"><?= e($f['type'] ?? '') ?></td>
          <td data-label="<?= e(t('Size')) ?>" class="num"><?= e(fmt_bytes($f['size'] ?? 0)) ?></td>
          <td data-label="<?= e(t('Created')) ?>" class="mono"><?= e($f['creation-time'] ?? '') ?></td>
          <td class="actions" data-label=""><?php if (preg_match('/\.rsc$/i', $f['name'])) { ?><a class="btn btn-sm" href="<?= e(url('/backup/download?type=file&name=' . rawurlencode($f['name']))) ?>"><?= icon('download', 16) ?><?= e(t('Download')) ?></a><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </section>
</div>
