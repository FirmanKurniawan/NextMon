<?php /** Vars: $profiles $cols $maxMb $maxRows $phpMax */ ?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Import / export users'), t('Move hotspot users in and out with CSV (Mikhmon-style columns).'),
    '<a class="btn" href="' . e(url('/hotspot/users')) . '">' . icon('users', 16) . e(t('Hotspot users')) . '</a>') ?>

<div class="grid">
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Export')) ?></h2></div>
    <form class="card-b stack" method="get" action="<?= e(url('/import/export')) ?>">
      <div class="field"><label for="x-prof"><?= e(t('Profile')) ?></label><select class="select" id="x-prof" name="profile"><option value=""><?= e(t('All profiles')) ?></option>
        <?php foreach ($profiles as $p) { ?><option><?= e($p) ?></option><?php } ?></select></div>
      <div class="field"><label for="x-q"><?= e(t('Name or comment contains')) ?></label><input class="input" id="x-q" name="q" placeholder="<?= e(t('e.g. batch tag')) ?>"></div>
      <div class="field"><label for="x-sep"><?= e(t('Separator')) ?></label><select class="select" id="x-sep" name="sep"><option value="comma">, (<?= e(t('comma')) ?>)</option><option value="semicolon">; (<?= e(t('semicolon, for Excel ID')) ?>)</option></select></div>
      <label class="switch"><input type="checkbox" name="stats" value="1"><span class="track"></span><span><?= e(t('Include uptime and traffic columns (ignored on import)')) ?></span></label>
      <div><button class="btn btn-primary"><?= icon('download', 16) ?><?= e(t('Download CSV')) ?></button></div>
    </form>
  </section>

  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Import')) ?></h2></div>
    <?php if (!Auth::can('write')) { echo '<div class="card-b"><p class="muted">' . e(t('Your role cannot import users.')) . '</p></div>'; } else { ?>
    <form class="card-b stack" method="post" action="<?= e(url('/import/preview')) ?>" enctype="multipart/form-data">
      <?= csrf_field() ?>
      <div class="imp-drop"><input type="file" name="csv" accept=".csv,.txt,text/csv" required aria-label="CSV">
        <p class="help"><?= e(t('Max :m MB and :r rows per file (server upload limit: :p). UTF-8 or Windows-1252; separators , ; or tab are detected.', [':m' => $maxMb, ':r' => $maxRows, ':p' => $phpMax])) ?></p></div>
      <fieldset class="stack" style="border:0;padding:0;margin:0">
        <legend class="help" style="padding:0"><?= e(t('If a user already exists')) ?></legend>
        <label class="switch"><input type="radio" name="mode" value="skip" checked><span class="track"></span><span><?= e(t('Skip it (keep the router entry)')) ?></span></label>
        <label class="switch"><input type="radio" name="mode" value="overwrite"><span class="track"></span><span><?= e(t('Overwrite it with the non-empty CSV cells')) ?></span></label>
      </fieldset>
      <p class="help"><?= e(t('Nothing is written yet: the next screen validates every row and shows what would happen.')) ?></p>
      <div class="row"><button class="btn btn-primary"><?= icon('check', 16) ?><?= e(t('Validate and preview')) ?></button>
        <a class="btn btn-ghost" href="<?= e(url('/import/template')) ?>"><?= e(t('Download template')) ?></a></div>
    </form>
    <?php } ?>
  </section>

  <section class="card glass col-12">
    <div class="card-h"><h2><?= e(t('Columns')) ?></h2></div>
    <div class="card-b imp-cols">
      <p class="muted" style="margin-bottom:var(--s2)"><?= e(t('The first row must be the header. Only Name is required; column order does not matter and unknown columns are ignored.')) ?></p>
      <?php foreach ($cols as $key => $def) { ?><code title="<?= e($key) ?>"><?= e($def[0]) ?></code><?php } ?>
      <p class="help" style="margin-top:var(--s2)"><?= e(t('Accepted header aliases include User/Username, Pass, Package, MAC, Uptime Limit, Limit Bytes. Disabled: yes/no. Time limit like 1h30m, data limit like 500M or 2G.')) ?></p>
    </div>
  </section>
</div>
