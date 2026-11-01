<?php /** Vars: $s $users $keys $newKey $forced */
$admin = Auth::can('admin');
$me = Auth::user();
$tabs = ['general' => 'General', 'account' => 'My account'] + ($admin ? ['users' => 'Users and roles', 'api' => 'API keys'] : []);
?>
<?= page_head(t('Settings')) ?>
<section class="card glass"><div class="card-b">
  <div class="tabs" role="tablist" data-hash-tabs>
    <?php foreach ($tabs as $k => $l) { ?><button type="button" role="tab" id="tab-<?= $k ?>" aria-controls="panel-<?= $k ?>" aria-selected="<?= $k === 'general' ? 'true' : 'false' ?>" data-tab="<?= $k ?>"><?= e(t($l)) ?></button><?php } ?>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-general" aria-labelledby="tab-general">
    <?php if ($admin) { ?>
    <form method="post" action="<?= e(url('/settings/save')) ?>" class="stack" style="max-width:720px">
      <?= csrf_field() ?>
      <div class="form-grid">
        <div class="field"><label for="s-lang"><?= e(t('Default language')) ?></label><select class="select" id="s-lang" name="lang"><option value="id"<?= sel('id', $s['lang']) ?>>Bahasa Indonesia</option><option value="en"<?= sel('en', $s['lang']) ?>>English</option></select></div>
        <div class="field"><label for="s-tz"><?= e(t('Time zone')) ?></label><input class="input" id="s-tz" name="timezone" value="<?= e($s['timezone']) ?>" list="tzlist"><datalist id="tzlist"><?php foreach (['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'UTC'] as $z) { ?><option value="<?= e($z) ?>"><?php } ?></datalist></div>
        <div class="field"><label for="s-cur"><?= e(t('Currency symbol')) ?></label><input class="input" id="s-cur" name="currency" value="<?= e($s['currency']) ?>" maxlength="6"></div>
        <div class="field"><label for="s-qty"><?= e(t('Max vouchers per batch')) ?></label><input class="input" id="s-qty" name="max_qty" type="number" min="1" max="2000" value="<?= (int)$s['max_qty'] ?>"></div>
        <div class="field full"><label for="s-hs"><?= e(t('Default hotspot name')) ?></label><input class="input" id="s-hs" name="hotspot_name" value="<?= e($s['hotspot_name']) ?>"></div>
        <div class="field full"><label for="s-login"><?= e(t('Hotspot login URL (used in voucher QR codes)')) ?></label><input class="input mono" id="s-login" name="login_url" value="<?= e($s['login_url']) ?>"><p class="help"><?= e(t('QR opens: URL?username=...&password=...')) ?></p></div>
        <div class="field full"><label for="s-cors"><?= e(t('Allowed origins for /status.json (comma separated)')) ?></label><input class="input mono" id="s-cors" name="status_cors" value="<?= e($s['status_cors']) ?>" placeholder="http://hotspot.local"><p class="help"><?= e(t('Router hosts are allowed automatically. Use this for the hotspot DNS name.')) ?></p></div>
        <div class="field full"><label class="switch"><input type="checkbox" name="live_report" value="1"<?= chk(!empty($s['live_report'])) ?>><span class="track"></span><span><?= e(t('Show live report on the dashboard')) ?></span></label></div>
      </div>
      <div><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
    </form>
    <?php } else { echo '<p class="muted">' . e(t('Only administrators can change global settings.')) . '</p>'; } ?>
    <hr style="border:0;border-top:1px solid var(--border);margin:var(--s5) 0">
    <dl class="kv" style="max-width:560px">
      <dt><?= e(t('Demo mode')) ?></dt><dd><?= $forced ? badge('NEXTMON_DEMO=1', 'warn') : '<span class="muted">' . e(t('per router')) . '</span>' ?></dd>
      <dt>PHP</dt><dd class="mono"><?= e(PHP_VERSION) ?></dd>
      <dt>OpenSSL</dt><dd><?= function_exists('openssl_encrypt') ? badge(t('available'), 'ok') : badge(t('missing'), 'err') ?></dd>
      <dt>cURL</dt><dd><?= function_exists('curl_init') ? badge(t('available'), 'ok') : badge(t('not available (fallback used)'), 'warn') ?></dd>
    </dl>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-account" aria-labelledby="tab-account" hidden>
    <p class="muted" style="margin-bottom:var(--s4)"><?= e($me['username']) ?> &middot; <?= e(Auth::roleLabel($me['role'])) ?></p>
    <form method="post" action="<?= e(url('/settings/password')) ?>" class="stack" style="max-width:420px">
      <?= csrf_field() ?>
      <div class="field"><label for="a-cur"><?= e(t('Current password')) ?></label><input class="input" id="a-cur" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label for="a-new"><?= e(t('New password')) ?></label><input class="input" id="a-new" type="password" name="new" autocomplete="new-password" required minlength="8"></div>
      <div class="field"><label for="a-new2"><?= e(t('Repeat new password')) ?></label><input class="input" id="a-new2" type="password" name="new2" autocomplete="new-password" required minlength="8"></div>
      <div><button class="btn btn-primary"><?= e(t('Change password')) ?></button></div>
    </form>
  </div>

  <?php if ($admin) { ?>
  <div class="tabpanel" role="tabpanel" id="panel-users" aria-labelledby="tab-users" hidden>
    <div class="row" style="justify-content:space-between;margin-bottom:var(--s3)"><p class="muted"><?= e(t('Admin: everything. Operator: manage hotspot, no settings. Reseller: sell vouchers only. Viewer: read-only.')) ?></p>
      <button class="btn btn-primary" type="button" data-open="#dlg-usr" data-new><?= icon('plus', 16) ?><?= e(t('Add user')) ?></button></div>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Username')) ?></th><th><?= e(t('Role')) ?></th><th><?= e(t('Created')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($users as $u) { ?>
        <tr>
          <td data-label="<?= e(t('Username')) ?>"><b><?= e($u['username']) ?></b></td>
          <td data-label="<?= e(t('Role')) ?>"><?= badge(Auth::roleLabel($u['role']), $u['role'] === 'admin' ? 'info' : 'neutral') ?></td>
          <td data-label="<?= e(t('Created')) ?>" class="mono"><?= e(date('Y-m-d', (int)$u['created'])) ?></td>
          <td class="actions" data-label="">
            <button class="btn btn-sm" type="button" data-open="#dlg-usr" data-edit="<?= jattr(['id' => $u['id'], 'username' => $u['username'], 'role' => $u['role']]) ?>"><?= icon('edit', 16) ?><span class="hide-m"><?= e(t('Edit')) ?></span></button>
            <?php if ($u['id'] !== $me['id']) { ?><form class="inline-form" method="post" action="<?= e(url('/settings/user-delete')) ?>" data-confirm="<?= e(t('Delete user :n?', [':n' => $u['username']])) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($u['id']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form><?php } ?>
          </td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-api" aria-labelledby="tab-api" hidden>
    <?php if ($newKey) { ?>
    <div class="alert warn" style="margin-bottom:var(--s4)"><?= icon('key', 18) ?><div style="min-width:0"><b><?= e(t('Your new API key (shown once):')) ?></b><br><code style="word-break:break-all" id="new-key"><?= e($newKey) ?></code></div><button class="btn btn-sm" type="button" data-copy="#new-key"><?= e(t('Copy')) ?></button></div>
    <?php } ?>
    <p class="muted" style="margin-bottom:var(--s3)"><?= e(t('Send the key as header "X-API-Key" or "Authorization: Bearer". Base URL:')) ?> <code><?= e(App::origin()) ?>/api/v1/</code></p>
    <pre class="out" style="margin-bottom:var(--s4)">GET  /api/v1/status | users | profiles | active | hosts | sales | logs | health | interfaces
POST /api/v1/vouchers  {"profile":"1Jam","qty":5,"prefix":"","length":6,"mode":"vc","batch":"api"}   (write scope)
POST /api/v1/kick      {"user":"abc123"}                                                              (write scope)
?router=ID selects a router (default: first)</pre>
    <form class="row" method="post" action="<?= e(url('/settings/key')) ?>" style="margin-bottom:var(--s4);align-items:flex-end">
      <?= csrf_field() ?>
      <div class="field" style="flex:1 1 200px"><label for="k-name"><?= e(t('Key name')) ?></label><input class="input" id="k-name" name="name" required maxlength="40" placeholder="billing-system"></div>
      <div class="field"><label for="k-scope"><?= e(t('Scope')) ?></label><select class="select" id="k-scope" name="scope"><option value="read">read</option><option value="write">write</option></select></div>
      <button class="btn btn-primary"><?= icon('key', 16) ?><?= e(t('Create key')) ?></button>
    </form>
    <?php if (!$keys) { echo '<p class="muted">' . e(t('No API keys.')) . '</p>'; } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Name')) ?></th><th><?= e(t('Key')) ?></th><th><?= e(t('Scope')) ?></th><th><?= e(t('Last used')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($keys as $k) { ?>
        <tr>
          <td data-label="<?= e(t('Name')) ?>"><b><?= e($k['name']) ?></b></td>
          <td data-label="<?= e(t('Key')) ?>" class="mono"><?= e($k['prefix']) ?>...</td>
          <td data-label="<?= e(t('Scope')) ?>"><?= badge($k['scope'], $k['scope'] === 'write' ? 'warn' : 'neutral') ?></td>
          <td data-label="<?= e(t('Last used')) ?>"><?= $k['last'] ? e(ago((int)$k['last'])) : '<span class="muted">-</span>' ?></td>
          <td class="actions" data-label=""><form class="inline-form" method="post" action="<?= e(url('/settings/key-delete')) ?>" data-confirm="<?= e(t('Revoke this key?')) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($k['id']) ?>"><button class="btn btn-sm btn-danger"><?= e(t('Revoke')) ?></button></form></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </div>
  <?php } ?>
</div></section>

<?php if ($admin) { ?>
<dialog class="modal" id="dlg-usr" aria-labelledby="dlg-usr-t">
  <form method="post" action="<?= e(url('/settings/user')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-usr-t"><?= e(t('Dashboard user')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="du-name"><?= e(t('Username')) ?></label><input class="input" id="du-name" name="username" required pattern="[A-Za-z0-9_.\-]{3,32}"></div>
      <div class="field"><label for="du-role"><?= e(t('Role')) ?></label><select class="select" id="du-role" name="role"><?php foreach (Auth::ROLES as $r) { ?><option value="<?= $r ?>"><?= e(Auth::roleLabel($r)) ?></option><?php } ?></select></div>
      <div class="field full"><label for="du-pass"><?= e(t('Password')) ?></label><input class="input" id="du-pass" name="password" type="password" autocomplete="new-password" minlength="8"><p class="help"><?= e(t('8+ characters. When editing, leave blank to keep the current password.')) ?></p></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
