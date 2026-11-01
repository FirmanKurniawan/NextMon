<?php /** Vars: $c $profiles $gateways $routers */
$rows = $c['packages'];
for ($i = 0; $i < 3; $i++) {
    $rows[] = ['id' => '', 'profile' => '', 'price' => '', 'label' => '', 'badge' => '', 'desc' => '', 'active' => true];
}
$row = function (int $i, array $p) { ?>
        <tr class="shp-prow">
          <td data-label="<?= e(t('Profile')) ?>"><input type="hidden" name="pkg[<?= $i ?>][id]" value="<?= e($p['id']) ?>"><input class="input input-sm" aria-label="<?= e(t('Profile')) ?>" name="pkg[<?= $i ?>][profile]" list="shp-profiles" value="<?= e($p['profile']) ?>" placeholder="<?= e(t('Hotspot profile')) ?>"></td>
          <td data-label="<?= e(t('Price')) ?>"><input class="input input-sm mono" aria-label="<?= e(t('Price')) ?>" name="pkg[<?= $i ?>][price]" inputmode="numeric" value="<?= e($p['price']) ?>" placeholder="5000" style="min-width:90px"></td>
          <td data-label="<?= e(t('Label')) ?>"><input class="input input-sm" aria-label="<?= e(t('Label')) ?>" name="pkg[<?= $i ?>][label]" value="<?= e($p['label']) ?>" maxlength="40" placeholder="1 Jam"></td>
          <td data-label="<?= e(t('Badge')) ?>"><input class="input input-sm" aria-label="<?= e(t('Badge')) ?>" name="pkg[<?= $i ?>][badge]" value="<?= e($p['badge']) ?>" maxlength="16" placeholder="<?= e(t('Popular')) ?>"></td>
          <td data-label="<?= e(t('Description')) ?>"><input class="input input-sm" aria-label="<?= e(t('Description')) ?>" name="pkg[<?= $i ?>][desc]" value="<?= e($p['desc']) ?>" maxlength="100"></td>
          <td data-label="<?= e(t('Active')) ?>"><label class="check"><input type="checkbox" name="pkg[<?= $i ?>][active]" value="1"<?= chk(!empty($p['active'])) ?>><span class="sr-only"><?= e(t('Active')) ?></span></label></td>
        </tr>
<?php };
?>
<?= page_head(t('Shop settings'), t('Configure the public shop at /shop: packages, payment gateway, branding.'),
    '<a class="btn" href="' . e(url(Shop::homePath())) . '" target="_blank" rel="noopener">' . icon('globe', 16) . e(t('Open shop')) . '</a><a class="btn" href="' . e(url('/orders')) . '">' . icon('list', 16) . e(t('Online orders')) . '</a>') ?>

<form method="post" action="<?= e(url('/shop/settings/save')) ?>" class="stack">
  <?= csrf_field() ?>
  <div class="grid">
    <section class="card glass col-6">
      <div class="card-h"><h2><?= e(t('General')) ?></h2></div>
      <div class="card-b stack">
        <label class="switch"><input type="checkbox" name="enabled" value="1"<?= chk($c['enabled']) ?>><span class="track"></span><span><?= e(t('Shop is open to the public')) ?></span></label>
        <div class="field"><label for="s-title"><?= e(t('Shop name')) ?></label><input class="input" id="s-title" name="title" value="<?= e($c['title']) ?>" maxlength="60" placeholder="<?= e(Store::setting('hotspot_name', 'NextMON WiFi')) ?>"></div>
        <div class="field"><label for="s-tag"><?= e(t('Headline')) ?></label><input class="input" id="s-tag" name="tagline" value="<?= e($c['tagline']) ?>" maxlength="160" placeholder="<?= e(t('Buy WiFi access')) ?>"></div>
        <div class="field"><label for="s-router"><?= e(t('Create vouchers on router')) ?></label>
          <select class="select" id="s-router" name="router"><?php foreach ($routers as $r) { ?><option value="<?= e($r['id']) ?>"<?= sel($r['id'], $c['router'] !== '' ? $c['router'] : ($routers[0]['id'] ?? '')) ?>><?= e($r['name']) ?></option><?php } ?></select></div>
        <div class="form-grid">
          <div class="field"><label for="s-exp"><?= e(t('Order expires after (minutes)')) ?></label><input class="input mono" id="s-exp" name="expiry_minutes" type="number" min="5" max="1440" value="<?= (int)$c['expiry_minutes'] ?>"></div>
          <div class="field"><label for="s-lim"><?= e(t('Max orders per IP / 10 min')) ?></label><input class="input mono" id="s-lim" name="order_limit" type="number" min="1" max="50" value="<?= (int)$c['order_limit'] ?>"></div>
        </div>
        <label class="switch"><input type="checkbox" name="require_phone" value="1"<?= chk($c['require_phone']) ?>><span class="track"></span><span><?= e(t('Require phone number')) ?></span></label>
        <div class="field"><label for="s-terms"><?= e(t('Terms and conditions')) ?></label><textarea class="textarea" id="s-terms" name="terms" rows="5" maxlength="3000" style="height:auto"><?= e($c['terms']) ?></textarea><p class="help"><?= e(t('Leave empty to hide the terms checkbox.')) ?></p></div>
      </div>
    </section>

    <section class="card glass col-6">
      <div class="card-h"><h2><?= e(t('Payment')) ?></h2></div>
      <div class="card-b stack">
        <div class="form-grid">
          <div class="field"><label for="s-gw"><?= e(t('Gateway')) ?></label>
            <select class="select" id="s-gw" name="gateway"><?php foreach ($gateways as $id => $g) { ?><option value="<?= e($id) ?>"<?= sel($id, $c['gateway']) ?>><?= e($g->label()) ?></option><?php } ?></select></div>
          <div class="field"><label for="s-env"><?= e(t('Mode')) ?></label>
            <select class="select" id="s-env" name="env"><option value="sandbox"<?= sel('sandbox', $c['env']) ?>>Sandbox</option><option value="production"<?= sel('production', $c['env']) ?>>Production</option></select></div>
        </div>
        <?php if ($c['gateway'] === 'mock') { ?><div class="alert warn"><?= icon('alert', 18) ?><div><?= e(t('The demo gateway lets anyone with a link "pay" for free. Use it only on a private test install, never on a public server.')) ?></div></div><?php } ?>
        <div class="field"><label for="s-ins"><?= e(t('Manual transfer instructions')) ?></label><textarea class="textarea" id="s-ins" name="instructions" rows="4" maxlength="1000" style="height:auto" placeholder="BCA 123456789 a.n. ..."><?= e($c['instructions']) ?></textarea><p class="help"><?= e(t('Shown to the customer when the gateway is manual transfer.')) ?></p></div>
        <div class="field"><label for="s-ips"><?= e(t('Allowed callback IPs (optional)')) ?></label><textarea class="textarea mono" id="s-ips" name="callback_ips" rows="2" style="height:auto" placeholder="203.0.113.10, 198.51.100.0/24"><?= e($c['callback_ips']) ?></textarea><p class="help"><?= e(t('If set, webhooks from other addresses are rejected. Signatures are always checked as well. Behind a proxy this sees the proxy address.')) ?></p></div>
      </div>
    </section>

    <section class="card glass col-12">
      <div class="card-h"><h2><?= e(t('Gateway credentials')) ?></h2><span class="muted"><?= e(t('Stored encrypted. Leave a secret blank to keep the saved one.')) ?></span></div>
      <div class="card-b grid">
        <?php foreach ($gateways as $id => $g) { if (!$g->fields()) { continue; } ?>
        <div class="col-4 stack" style="gap:var(--s3)">
          <b><?= e($g->label()) ?></b>
          <?php foreach ($g->fields() as $f) { $saved = (string)($c['gw'][$id][$f['key']] ?? '') !== ''; ?>
          <div class="field"><label for="g-<?= e($id . $f['key']) ?>"><?= e($f['label']) ?></label>
            <input class="input mono" id="g-<?= e($id . $f['key']) ?>" name="gw[<?= e($id) ?>][<?= e($f['key']) ?>]" autocomplete="off"
              <?php if (!empty($f['secret'])) { ?>type="password" placeholder="<?= $saved ? e(t('(saved - leave blank to keep)')) : '' ?>"<?php } else { ?>type="text" value="<?= e($c['gw'][$id][$f['key']] ?? '') ?>"<?php } ?>>
            <?php if (!empty($f['help'])) { ?><p class="help"><?= e($f['help']) ?></p><?php } ?></div>
          <?php } ?>
          <div class="field"><label for="cb-<?= e($id) ?>"><?= e(t('Callback (webhook) URL')) ?></label><input class="input mono" id="cb-<?= e($id) ?>" readonly value="<?= e(Shop::callbackUrl($id)) ?>" data-autoselect></div>
        </div>
        <?php } ?>
      </div>
      <p class="help" style="padding:0 var(--s4) var(--s4)"><?= e(t('Gateways call your server, so the URL must be reachable from the internet (HTTPS recommended). Live gateway calls have not been tested against the real services.')) ?></p>
    </section>

    <section class="card glass col-12">
      <div class="card-h"><h2><?= e(t('Packages')) ?></h2><button class="btn btn-sm" type="button" data-shp-addrow><?= icon('plus', 16) ?><?= e(t('Add row')) ?></button></div>
      <datalist id="shp-profiles"><?php foreach ($profiles as $p) { ?><option value="<?= e($p) ?>"><?php } ?></datalist>
      <div class="table-wrap"><table class="tbl resp" id="shp-ptable">
        <thead><tr><th><?= e(t('Profile')) ?></th><th><?= e(t('Price')) ?></th><th><?= e(t('Label')) ?></th><th><?= e(t('Badge')) ?></th><th><?= e(t('Description')) ?></th><th><?= e(t('Active')) ?></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $i => $p) { $row($i, $p); } ?>
        </tbody>
      </table></div>
      <p class="help" style="padding:var(--s3) var(--s4) var(--s4)"><?= e(t('Customers only choose among these packages; the price is always read from here. Clear the profile to remove a row.')) ?></p>
      <template id="shp-prow-tpl"><?php $row(9999, ['id' => '', 'profile' => '', 'price' => '', 'label' => '', 'badge' => '', 'desc' => '', 'active' => true]); ?></template>
    </section>
  </div>
  <div><button class="btn btn-primary btn-lg"><?= e(t('Save')) ?></button></div>
</form>
