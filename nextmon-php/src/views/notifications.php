<?php /** Vars: $tg $hook $log */ $ev = (array)($tg['events'] ?? []); ?>
<?= page_head(t('Notifications'), t('Send alerts to a Telegram chat and/or a generic webhook.')) ?>
<div class="grid">
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Channels')) ?></h2></div>
    <form class="card-b stack" method="post" action="<?= e(url('/notifications/save')) ?>">
      <?= csrf_field() ?>
      <label class="switch"><input type="checkbox" name="enabled" value="1"<?= chk(!empty($tg['enabled'])) ?>><span class="track"></span><span><?= e(t('Enable Telegram')) ?></span></label>
      <div class="field"><label for="n-token"><?= e(t('Bot token')) ?></label><input class="input mono" id="n-token" name="token" type="password" autocomplete="off" placeholder="<?= !empty($tg['token']) ? e(t('(saved - leave blank to keep)')) : '123456:ABC...' ?>"><p class="help"><?= e(t('Stored encrypted. Create a bot with @BotFather.')) ?></p></div>
      <div class="field"><label for="n-chat"><?= e(t('Chat ID')) ?></label><input class="input mono" id="n-chat" name="chat_id" value="<?= e($tg['chat_id'] ?? '') ?>" placeholder="-1001234567890"></div>
      <div class="field"><label for="n-hook"><?= e(t('Webhook URL (optional)')) ?></label><input class="input mono" id="n-hook" name="webhook_url" type="url" value="<?= e($hook) ?>" placeholder="https://example.com/hook"><p class="help"><?= e(t('Receives JSON: event, text, ts.')) ?></p></div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="label"><?= e(t('Send notifications for')) ?></legend>
        <div class="stack" style="gap:var(--s1);margin-top:var(--s2)">
          <?php foreach (['sale' => 'POS sales', 'voucher' => 'Voucher batches generated', 'router' => 'Router connection errors', 'login' => 'Failed logins'] as $k => $l) { ?>
          <label class="check"><input type="checkbox" name="events[]" value="<?= $k ?>"<?= chk(in_array($k, $ev, true)) ?>><?= e(t($l)) ?></label>
          <?php } ?>
        </div></fieldset>
      <div><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
    </form>
    <form class="card-b" style="padding-top:0" method="post" action="<?= e(url('/notifications/test')) ?>"><?= csrf_field() ?><button class="btn"><?= icon('bell', 16) ?><?= e(t('Send test message')) ?></button></form>
  </section>
  <section class="card glass col-6">
    <div class="card-h"><h2><?= e(t('Recent deliveries')) ?></h2></div>
    <?php if (!$log) { echo empty_state('bell', t('Nothing sent yet')); } else { ?>
    <div class="table-wrap" style="max-height:480px"><table class="tbl resp">
      <thead><tr><th><?= e(t('Time')) ?></th><th><?= e(t('Event')) ?></th><th><?= e(t('Result')) ?></th></tr></thead>
      <tbody>
      <?php foreach ($log as $l) { ?>
        <tr>
          <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('m-d H:i', (int)$l['ts'])) ?></td>
          <td data-label="<?= e(t('Event')) ?>"><?= badge($l['event']) ?></td>
          <td data-label="<?= e(t('Result')) ?>" class="wrap"><?= !empty($l['ok']) ? badge(t('Sent'), 'ok') : badge(t('Failed'), 'err') ?> <span class="muted"><?= e($l['result']) ?></span></td>
        </tr>
      <?php } ?>
      </tbody>
    </table></div>
    <?php } ?>
  </section>
</div>
