<?php
/** Vars: $hosts $ips $q $servers $portal */
$canW = Auth::can('write');
$table = function (array $rows, string $kind) use ($canW) {
    ?>
    <form method="post" action="<?= e(url('/walledgarden/action')) ?>" data-bulk>
      <?= csrf_field() ?><input type="hidden" name="kind" value="<?= $kind ?>">
      <div class="sel-bar" data-sel-bar hidden><span data-sel-count></span><span class="spacer"></span>
        <?php if ($canW) { ?>
        <button class="btn btn-sm" name="action" value="enable"><?= e(t('Enable')) ?></button>
        <button class="btn btn-sm" name="action" value="disable"><?= e(t('Disable')) ?></button>
        <button class="btn btn-sm" name="action" value="toggle"><?= e(t('Toggle')) ?></button>
        <button class="btn btn-sm btn-danger" name="action" value="remove" data-confirm="<?= e(t('Remove the selected entries?')) ?>"><?= icon('trash', 16) ?><?= e(t('Remove')) ?></button>
        <?php } ?></div>
      <?php if (!$rows) { echo empty_state('globe', t('No entries')); } else { ?>
      <div class="table-wrap"><table class="tbl resp">
        <thead><tr><th class="cell-chk"><input type="checkbox" data-check-all aria-label="<?= e(t('Select all')) ?>"></th>
          <?php if ($kind === 'host') { ?><th data-sort><?= e(t('Host')) ?></th><th><?= e(t('Action')) ?></th><?php } else { ?><th data-sort><?= e(t('Address')) ?></th><th><?= e(t('Protocol')) ?></th><th><?= e(t('Port')) ?></th><th><?= e(t('Action')) ?></th><?php } ?>
          <th>Server</th><th><?= e(t('Status')) ?></th><th><?= e(t('Comment')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $w) { $off = NetworkController::off($w); $dyn = in_array((string)($w['dynamic'] ?? ''), ['true', 'yes'], true); ?>
          <tr>
            <td class="cell-chk" data-label=""><input type="checkbox" name="ids[]" value="<?= e($w['.id']) ?>" aria-label="<?= e($w['dst-host'] ?? $w['dst-address'] ?? '') ?>"></td>
            <?php if ($kind === 'host') { ?>
            <td data-label="<?= e(t('Host')) ?>" class="mono"><?= e($w['dst-host'] ?? '') ?: '-' ?></td>
            <td data-label="<?= e(t('Action')) ?>"><?= badge($w['action'] ?? 'allow', ($w['action'] ?? 'allow') === 'allow' ? 'ok' : 'err') ?></td>
            <?php } else { ?>
            <td data-label="<?= e(t('Address')) ?>" class="mono"><?= e($w['dst-address'] ?? $w['dst-host'] ?? '') ?></td>
            <td data-label="<?= e(t('Protocol')) ?>"><?= e($w['protocol'] ?? '') ?: 'any' ?></td>
            <td data-label="<?= e(t('Port')) ?>" class="mono"><?= e($w['dst-port'] ?? '') ?: '-' ?></td>
            <td data-label="<?= e(t('Action')) ?>"><?= badge($w['action'] ?? 'accept', ($w['action'] ?? 'accept') === 'accept' ? 'ok' : 'err') ?></td>
            <?php } ?>
            <td data-label="Server"><?= e($w['server'] ?? '') ?: 'all' ?></td>
            <td data-label="<?= e(t('Status')) ?>"><?= $off ? badge(t('Disabled'), 'warn') : badge(t('Active'), 'ok') ?></td>
            <td data-label="<?= e(t('Comment')) ?>" class="wrap muted"><?= e($w['comment'] ?? '') ?></td>
            <td class="actions" data-label=""><?php if ($canW && !$dyn) { ?><button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-wg-<?= $kind ?>" data-edit="<?= jattr(['id' => $w['.id'], 'dst_host' => $w['dst-host'] ?? '', 'dst_address' => $w['dst-address'] ?? '', 'protocol' => $w['protocol'] ?? '', 'dst_port' => $w['dst-port'] ?? '', 'action' => $w['action'] ?? '', 'server' => $w['server'] ?? '', 'comment' => $w['comment'] ?? '']) ?>"><?= icon('edit', 16) ?></button><?php } ?></td>
          </tr>
        <?php } ?>
        </tbody>
      </table></div>
      <?php } ?>
    </form>
    <?php
};
?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-network.css')) ?>">
<?= page_head(t('Walled garden'), t('Hosts and addresses guests can reach without logging in (payment pages, the portal, captive-portal checks).')) ?>

<section class="card glass">
  <div class="tabs" role="tablist" data-hash-tabs>
    <button type="button" role="tab" id="tab-host" aria-controls="panel-host" aria-selected="true" data-tab="host"><?= e(t('Hosts')) ?> (<?= count($hosts) ?>)</button>
    <button type="button" role="tab" id="tab-ip" aria-controls="panel-ip" aria-selected="false" data-tab="ip"><?= e(t('IP addresses')) ?> (<?= count($ips) ?>)</button>
  </div>
  <form class="nm-toolbar" method="get" action="<?= e(url('/walledgarden')) ?>">
    <input class="input search" type="search" name="q" value="<?= e($q) ?>" placeholder="<?= e(t('Search host, address or comment')) ?>" aria-label="<?= e(t('Search')) ?>">
    <button class="btn btn-sm"><?= icon('search', 16) ?><?= e(t('Search')) ?></button>
    <span class="spacer"></span>
    <?php if ($canW) { ?>
    <button class="btn btn-sm btn-primary" type="button" data-open="#dlg-wg-host" data-new><?= icon('plus', 16) ?><?= e(t('Add host')) ?></button>
    <button class="btn btn-sm" type="button" data-open="#dlg-wg-ip" data-new><?= icon('plus', 16) ?><?= e(t('Add IP')) ?></button>
    <button class="btn btn-sm" type="button" data-open="#dlg-wg-def"><?= icon('shield', 16) ?><?= e(t('Apply defaults')) ?></button>
    <?php } ?>
  </form>
  <div class="tabpanel" role="tabpanel" id="panel-host" aria-labelledby="tab-host"><?php $table($hosts, 'host'); ?></div>
  <div class="tabpanel" role="tabpanel" id="panel-ip" aria-labelledby="tab-ip" hidden><?php $table($ips, 'ip'); ?></div>
</section>

<?php if ($canW) { ?>
<dialog class="modal" id="dlg-wg-host" aria-labelledby="dlg-wg-host-t">
  <form method="post" action="<?= e(url('/walledgarden/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id"><input type="hidden" name="kind" value="host">
    <div class="modal-h"><h2 id="dlg-wg-host-t"><?= e(t('Walled garden host')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field full"><label for="wh-host"><?= e(t('Host')) ?></label><input class="input mono" id="wh-host" name="dst_host" required placeholder="*.midtrans.com" autocapitalize="off"><p class="help"><?= e(t('Wildcards * and ? are allowed.')) ?></p></div>
      <div class="field"><label for="wh-act"><?= e(t('Action')) ?></label><select class="select" id="wh-act" name="action"><option value="allow">allow</option><option value="deny">deny</option></select></div>
      <div class="field"><label for="wh-srv">Server</label><input class="input" id="wh-srv" name="server" list="dl-wg-srv" placeholder="<?= e(t('(all)')) ?>"></div>
      <div class="field full"><label for="wh-com"><?= e(t('Comment')) ?></label><input class="input" id="wh-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<dialog class="modal" id="dlg-wg-ip" aria-labelledby="dlg-wg-ip-t">
  <form method="post" action="<?= e(url('/walledgarden/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id"><input type="hidden" name="kind" value="ip">
    <div class="modal-h"><h2 id="dlg-wg-ip-t"><?= e(t('Walled garden IP')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="wi-addr"><?= e(t('Address')) ?></label><input class="input mono" id="wi-addr" name="dst_address" required placeholder="10.5.50.1 or 8.8.8.0/24"></div>
      <div class="field"><label for="wi-act"><?= e(t('Action')) ?></label><select class="select" id="wi-act" name="action"><option value="accept">accept</option><option value="drop">drop</option><option value="reject">reject</option></select></div>
      <div class="field"><label for="wi-pr"><?= e(t('Protocol')) ?></label><select class="select" id="wi-pr" name="protocol"><option value="tcp">tcp</option><option value="udp">udp</option><option value="icmp">icmp</option><option value=""><?= e(t('any')) ?></option></select></div>
      <div class="field"><label for="wi-port"><?= e(t('Port')) ?></label><input class="input mono" id="wi-port" name="dst_port" placeholder="443 or 80,443"></div>
      <div class="field"><label for="wi-srv">Server</label><input class="input" id="wi-srv" name="server" list="dl-wg-srv" placeholder="<?= e(t('(all)')) ?>"></div>
      <div class="field"><label for="wi-com"><?= e(t('Comment')) ?></label><input class="input" id="wi-com" name="comment"></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<datalist id="dl-wg-srv"><?php foreach ($servers as $s) { ?><option value="<?= e($s) ?>"><?php } ?></datalist>
<dialog class="modal" id="dlg-wg-def" aria-labelledby="dlg-wg-def-t">
  <form method="post" action="<?= e(url('/walledgarden/defaults')) ?>">
    <?= csrf_field() ?>
    <div class="modal-h"><h2 id="dlg-wg-def-t"><?= e(t('Apply recommended defaults')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b stack">
      <p class="muted"><?= e(t('Adds the NextMON portal, payment gateways (Midtrans, Xendit, Tripay) and captive-portal checks for iOS/Android. Entries that already exist are skipped; nothing is removed.')) ?></p>
      <div class="field"><label for="wd-portal"><?= e(t('NextMON portal host')) ?></label><input class="input mono" id="wd-portal" name="portal" value="<?= e($portal) ?>" placeholder="nextmon.example.com"></div>
    </div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Apply')) ?></button></div>
  </form>
</dialog>
<?php } ?>
