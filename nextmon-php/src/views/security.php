<?php /** Vars: $me $admin $policy $sessions $names $curSid $history */
$tabs = ['sessions' => 'Sessions', 'history' => 'Login history'] + ($admin ? ['policy' => 'Policy'] : []);
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Security'), t('Password policy, session timeout, signed-in devices and sign-in history.'), '<a class="btn" href="' . e(url('/settings')) . '">' . icon('settings', 16) . e(t('Settings')) . '</a>') ?>
<section class="card glass"><div class="card-b">
  <div class="tabs" role="tablist" data-hash-tabs>
    <?php foreach ($tabs as $k => $l) { ?><button type="button" role="tab" id="tab-<?= $k ?>" aria-controls="panel-<?= $k ?>" aria-selected="<?= $k === 'sessions' ? 'true' : 'false' ?>" data-tab="<?= $k ?>"><?= e(t($l)) ?></button><?php } ?>
  </div>

  <!-- Sessions -->
  <div class="tabpanel" role="tabpanel" id="panel-sessions" aria-labelledby="tab-sessions">
    <div class="row" style="justify-content:space-between;margin-bottom:var(--s3)">
      <p class="muted"><?= e($admin ? t('All signed-in devices. Signing one out ends it on its next request.') : t('Devices signed in to your account.')) ?></p>
      <form method="post" action="<?= e(url('/security/sessions/revoke-others')) ?>" data-confirm="<?= e(t('Sign out all your other devices?')) ?>"><?= csrf_field() ?><button class="btn btn-sm"><?= icon('logout', 16) ?><?= e(t('Sign out other devices')) ?></button></form>
    </div>
    <?php if (!$sessions) { echo '<p class="muted">' . e(t('No tracked sessions yet.')) . '</p>'; } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><?php if ($admin) { ?><th><?= e(t('User')) ?></th><?php } ?><th><?= e(t('Device')) ?></th><th>IP</th><th><?= e(t('Signed in')) ?></th><th><?= e(t('Last active')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($sessions as $h => $s) { ?>
        <tr>
          <?php if ($admin) { ?><td data-label="<?= e(t('User')) ?>"><b><?= e($names[$s['uid']] ?? '?') ?></b></td><?php } ?>
          <td data-label="<?= e(t('Device')) ?>" title="<?= e($s['ua'] ?? '') ?>"><?= e(Security::uaLabel((string)($s['ua'] ?? ''))) ?><?= $h === $curSid ? ' ' . badge(t('This device'), 'info') : '' ?></td>
          <td data-label="IP" class="mono"><?= e($s['ip'] ?? '') ?></td>
          <td data-label="<?= e(t('Signed in')) ?>" class="mono nowrap"><?= e(date('Y-m-d H:i', (int)($s['created'] ?? 0))) ?></td>
          <td data-label="<?= e(t('Last active')) ?>"><?= e(ago((int)($s['last'] ?? 0))) ?></td>
          <td class="actions" data-label=""><?php if ($h !== $curSid) { ?><form class="inline-form" method="post" action="<?= e(url('/security/sessions/revoke')) ?>"><?= csrf_field() ?><input type="hidden" name="sid" value="<?= e($h) ?>"><button class="btn btn-sm btn-danger"><?= e(t('Sign out')) ?></button></form><?php } ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </div>

  <!-- Login history -->
  <div class="tabpanel" role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden>
    <p class="muted" style="margin-bottom:var(--s3)"><?= e($admin ? t('Sign-in, sign-out and password events for all users (from the audit log).') : t('Sign-in events for your account.')) ?></p>
    <?php if (!$history) { echo '<p class="muted">' . e(t('No activity yet.')) . '</p>'; } else { ?>
    <div class="table-wrap"><table class="tbl resp">
      <thead><tr><th><?= e(t('Time')) ?></th><th><?= e(t('User')) ?></th><th><?= e(t('Event')) ?></th><th><?= e(t('Detail')) ?></th><th>IP</th></tr></thead>
      <tbody>
      <?php foreach ($history as $a) { $bad = strpos($a['action'], 'fail') !== false; ?>
        <tr>
          <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('Y-m-d H:i:s', (int)$a['ts'])) ?></td>
          <td data-label="<?= e(t('User')) ?>"><?= e($a['user']) ?></td>
          <td data-label="<?= e(t('Event')) ?>"><?= badge($a['action'], $bad ? 'err' : 'neutral') ?></td>
          <td data-label="<?= e(t('Detail')) ?>" class="wrap"><?= e($a['detail']) ?></td>
          <td data-label="IP" class="mono"><?= e($a['ip']) ?></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </div>

  <?php if ($admin) { ?>
  <!-- Policy -->
  <div class="tabpanel" role="tabpanel" id="panel-policy" aria-labelledby="tab-policy" hidden>
    <form method="post" action="<?= e(url('/security/policy')) ?>" class="stack" style="max-width:560px">
      <?= csrf_field() ?>
      <div class="form-grid">
        <div class="field"><label for="p-min"><?= e(t('Minimum password length')) ?></label><input class="input" id="p-min" name="pw_min" type="number" min="8" max="64" value="<?= (int)$policy['pw_min'] ?>"></div>
        <div class="field"><label for="p-to"><?= e(t('Idle session timeout (minutes)')) ?></label><input class="input" id="p-to" name="timeout_min" type="number" min="0" max="43200" value="<?= (int)$policy['timeout_min'] ?>"><p class="help"><?= e(t('0 = never (until the browser closes).')) ?></p></div>
      </div>
      <label class="switch"><input type="checkbox" name="pw_upper" value="1"<?= chk($policy['pw_upper']) ?>><span class="track"></span><span><?= e(t('Require upper and lower case letters')) ?></span></label>
      <label class="switch"><input type="checkbox" name="pw_digit" value="1"<?= chk($policy['pw_digit']) ?>><span class="track"></span><span><?= e(t('Require a digit')) ?></span></label>
      <label class="switch"><input type="checkbox" name="pw_symbol" value="1"<?= chk($policy['pw_symbol']) ?>><span class="track"></span><span><?= e(t('Require a symbol')) ?></span></label>
      <label class="switch"><input type="checkbox" name="pw_no_username" value="1"<?= chk($policy['pw_no_username']) ?>><span class="track"></span><span><?= e(t('Password must not contain the username')) ?></span></label>
      <p class="help"><?= e(t('Applies to new and changed passwords. Existing passwords keep working.')) ?></p>
      <div><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
    </form>
  </div>
  <?php } ?>
</div></section>
