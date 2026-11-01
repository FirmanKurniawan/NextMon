<?php /** Vars: $files $hasRouter $admin $pending $safety */ ?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Backup'), t('Create files on the router and download exports.')) ?>
<div class="grid">
  <?php if ($hasRouter) { ?>
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
  <?php } ?>
  <?php if (!empty($admin)) {
      $labels = ['routers' => 'Routers', 'settings' => 'Settings and voucher templates', 'shop' => 'Shop configuration', 'resellers' => 'Resellers', 'wallets' => 'Reseller wallets',
          'wallet_ledger' => 'Wallet ledger', 'reseller_batches' => 'Reseller voucher batches', 'orders' => 'Shop orders']; ?>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('NextMON data backup')) ?></h2></div>
    <div class="card-b stack">
      <p class="muted"><?= e(t('Routers, settings, voucher templates, shop, resellers, wallets, orders and ledgers of this workspace in one file. Restorable on the PHP and Next.js editions.')) ?></p>
      <form method="get" action="<?= e(url('/backup/appdata')) ?>" class="stack">
        <label class="switch"><input type="checkbox" name="secrets" value="1"><span class="track"></span><span><?= e(t('Include encrypted secrets (router passwords, gateway keys)')) ?></span></label>
        <p class="help"><?= e(t('Without this, router passwords and keys are left out and must be typed again after a restore. Encrypted secrets only work on an installation that has the same secret key.')) ?></p>
        <div><button class="btn btn-primary"><?= icon('download', 16) ?><?= e(t('Download NextMON data')) ?></button></div>
      </form>
    </div>
  </section>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Restore NextMON data')) ?></h2></div>
    <form class="card-b stack" method="post" action="<?= e(url('/backup/restore/preview')) ?>" enctype="multipart/form-data">
      <?= csrf_field() ?>
      <div class="imp-drop"><input type="file" name="file" accept=".json,application/json" required aria-label="<?= e(t('Backup file')) ?>">
        <p class="help"><?= e(t('Max :m MB. Only this workspace is affected; accounts, sessions and API keys in the file are never imported.', [':m' => Backup::MAX_BYTES / 1048576])) ?></p></div>
      <p class="help"><?= e(t('Nothing is written yet: the next step shows what would be replaced.')) ?></p>
      <div><button class="btn"><?= icon('check', 16) ?><?= e(t('Check file')) ?></button></div>
    </form>
  </section>
  <?php if ($pending) { ?>
  <section class="card glass col-12" id="restore">
    <div class="card-h"><h2><?= e(t('Restore preview')) ?>: <span class="mono"><?= e($pending['file']) ?></span></h2></div>
    <form class="card-b stack" method="post" action="<?= e(url('/backup/restore/apply')) ?>">
      <?= csrf_field() ?><input type="hidden" name="token" value="<?= e($pending['token']) ?>">
      <p class="muted"><?= e(t('File from the :e edition, made :d. The selected items will be REPLACED by the file content.', [':e' => $pending['meta']['edition'] === 'next' ? 'Next.js' : 'PHP', ':d' => $pending['meta']['created']])) ?></p>
      <?php foreach ($pending['warnings'] as $w) { ?><div class="alert info" role="status"><?= e($w) ?></div><?php } ?>
      <?php if ($pending['ignored']) { ?><p class="help"><?= e(t('Ignored (never imported): :l', [':l' => implode(', ', $pending['ignored'])])) ?></p><?php } ?>
      <div class="table-wrap"><table class="tbl resp">
        <thead><tr><th><?= e(t('Restore')) ?></th><th><?= e(t('Item')) ?></th><th class="num"><?= e(t('Now')) ?></th><th class="num"><?= e(t('In the file')) ?></th></tr></thead>
        <tbody>
        <?php foreach ($pending['plan'] as $row) { ?>
          <tr>
            <td data-label="<?= e(t('Restore')) ?>"><input type="checkbox" name="c[]" value="<?= e($row['id']) ?>" checked aria-label="<?= e(t($labels[$row['id']] ?? $row['id'])) ?>"></td>
            <td data-label="<?= e(t('Item')) ?>"><?= e(t($labels[$row['id']] ?? $row['id'])) ?></td>
            <td data-label="<?= e(t('Now')) ?>" class="num"><?= (int)$row['current'] ?></td>
            <td data-label="<?= e(t('In the file')) ?>" class="num"><?= (int)$row['incoming'] ?></td>
          </tr>
        <?php } ?>
        </tbody>
      </table></div>
      <p class="help"><?= e(t('A safety backup of the current data is saved first, and everything is rolled back if the restore fails.')) ?></p>
      <div class="field"><label for="rs-confirm"><?= e(t('Type RESTORE to confirm')) ?></label><input class="input" id="rs-confirm" name="confirm" autocomplete="off" required pattern="[Rr][Ee][Ss][Tt][Oo][Rr][Ee]" style="max-width:240px"></div>
      <div class="row">
        <button class="btn btn-danger" data-confirm="<?= e(t('Replace the selected data of this workspace now?')) ?>"><?= icon('check', 16) ?><?= e(t('Restore now')) ?></button>
        <button class="btn btn-ghost" type="submit" formaction="<?= e(url('/backup/restore/cancel')) ?>" formnovalidate><?= e(t('Cancel')) ?></button>
      </div>
    </form>
  </section>
  <?php } ?>
  <?php if ($safety) { ?>
  <section class="card glass col-12">
    <div class="card-h"><h2><?= e(t('Safety backups (made before each restore)')) ?></h2></div>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('File')) ?></th><th class="num"><?= e(t('Size')) ?></th><th><?= e(t('Created')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($safety as $s) { ?>
        <tr>
          <td data-label="<?= e(t('File')) ?>" class="mono"><?= e($s['name']) ?></td>
          <td data-label="<?= e(t('Size')) ?>" class="num"><?= e(fmt_bytes($s['size'])) ?></td>
          <td data-label="<?= e(t('Created')) ?>" class="mono"><?= e(date('Y-m-d H:i', $s['time'])) ?></td>
          <td class="actions" data-label=""><a class="btn btn-sm" href="<?= e(url('/backup/safety?name=' . rawurlencode($s['name']))) ?>"><?= icon('download', 16) ?><?= e(t('Download')) ?></a></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
  </section>
  <?php } ?>
  <?php } ?>
</div>
