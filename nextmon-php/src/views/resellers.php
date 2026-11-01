<?php /** Vars: $list [[u,cfg,bal]] $total $prices [profile=>base] */ ?>
<link rel="stylesheet" href="<?= e(asset('/assets/css/mod-security.css')) ?>">
<?= page_head(t('Resellers'), t('Agents with a prepaid balance. Their voucher and POS sales are paid from the wallet.'),
    '<a class="btn" href="' . e(url('/resellers/ledger')) . '">' . icon('list', 16) . e(t('Ledger')) . '</a>'
    . '<a class="btn" href="' . e(url('/settings#users')) . '">' . icon('plus', 16) . e(t('Add reseller user')) . '</a>') ?>

<div class="grid" style="margin-bottom:var(--s4)">
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= e(t('Resellers')) ?></div><div class="stat-value"><?= count($list) ?></div></div></section>
  <section class="card glass col-4"><div class="card-b"><div class="stat-label"><?= e(t('Total wallet balance')) ?></div><div class="stat-value rs-balance"><?= e(money($total)) ?></div></div></section>
</div>

<section class="card glass">
  <?php if (!$list) { echo '<div class="card-b">' . empty_state('users', t('No reseller users yet'), t('Create a user with the Reseller role in Settings, then set up the wallet here.'), '<a class="btn btn-primary" href="' . e(url('/settings#users')) . '">' . e(t('Users and roles')) . '</a>') . '</div>'; } else { ?>
  <div class="table-wrap"><table class="tbl resp">
    <thead><tr><th><?= e(t('Reseller')) ?></th><th><?= e(t('Status')) ?></th><th class="num"><?= e(t('Balance')) ?></th><th class="num"><?= e(t('Commission')) ?></th><th class="num"><?= e(t('Price adj.')) ?></th><th><?= e(t('Profiles')) ?></th><th><?= e(t('Shop referral')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
    <tbody>
    <?php foreach ($list as $x) { $u = $x['u']; $c = $x['cfg']; $d = $c ?: Reseller::defaults(); ?>
      <tr>
        <td data-label="<?= e(t('Reseller')) ?>"><b><?= e($u['username']) ?></b></td>
        <td data-label="<?= e(t('Status')) ?>"><?= !$c ? badge(t('Not set up'), 'warn') : ($c['active'] ? badge(t('Active'), 'ok') : badge(t('Disabled'), 'err')) ?></td>
        <td data-label="<?= e(t('Balance')) ?>" class="num mono rs-balance <?= $x['bal'] < 0 ? 'rs-neg' : '' ?>"><?= e(money($x['bal'])) ?></td>
        <td data-label="<?= e(t('Commission')) ?>" class="num"><?= e(rtrim(rtrim(number_format((float)$d['commission'], 2, '.', ''), '0'), '.')) ?>%</td>
        <td data-label="<?= e(t('Price adj.')) ?>" class="num"><?= e(($d['adj'] > 0 ? '+' : '') . rtrim(rtrim(number_format((float)$d['adj'], 2, '.', ''), '0'), '.')) ?>%</td>
        <td data-label="<?= e(t('Profiles')) ?>" class="wrap"><?= $d['allow_all'] ? '<span class="muted">' . e(t('All')) . '</span>' : (e(implode(', ', array_keys($d['profiles']))) ?: '-') ?></td>
        <td data-label="<?= e(t('Shop referral')) ?>" class="wrap">
          <form method="post" action="<?= e(url('/resellers/ref')) ?>" class="row"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($u['id']) ?>">
            <input class="input input-sm mono" name="ref" value="<?= e($d['ref'] ?? '') ?>" maxlength="24" pattern="[a-z0-9][a-z0-9\-]{2,23}" placeholder="<?= e(t('code')) ?>" aria-label="<?= e(t('Referral code')) ?>" style="width:9rem"><button class="btn btn-sm"><?= e(t('Save')) ?></button></form>
          <?php if (!empty($d['ref'])) { ?><div class="help mono">/shop<?= e(Shop::wQuery()) ?><?= Shop::wQuery() === '' ? '?' : '&amp;' ?>ref=<?= e($d['ref']) ?></div><?php } ?>
        </td>
        <td class="actions" data-label="">
          <button class="btn btn-sm btn-primary" type="button" data-open="#dlg-fund" data-rs-fund="<?= e($u['id']) ?>" data-name="<?= e($u['username']) ?>"><?= icon('plus', 16) ?><span class="hide-m"><?= e(t('Top up')) ?></span></button>
          <button class="btn btn-sm" type="button" data-open="#dlg-rs" data-rs-edit="<?= jattr(['id' => $u['id'], 'username' => $u['username'], 'active' => $d['active'], 'commission' => $d['commission'], 'adj' => $d['adj'], 'credit' => $d['credit'], 'allow_all' => $d['allow_all'], 'profiles' => (object)$d['profiles']]) ?>"><?= icon('edit', 16) ?><span class="hide-m"><?= e(t('Edit')) ?></span></button>
          <a class="btn btn-sm btn-ghost" href="<?= e(url('/resellers/ledger?uid=' . rawurlencode($u['id']))) ?>"><?= e(t('Ledger')) ?></a>
        </td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
  <?php } ?>
</section>

<dialog class="modal" id="dlg-fund" aria-labelledby="fund-t">
  <form method="post" action="<?= e(url('/resellers/fund')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="fund-t"><?= e(t('Top up / adjust')) ?>: <span data-rs-title></span></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="f-kind"><?= e(t('Type')) ?></label><select class="select" id="f-kind" name="kind"><option value="topup"><?= e(t('Top up (add balance)')) ?></option><option value="adjustment"><?= e(t('Adjustment (+ or -)')) ?></option></select></div>
      <div class="field"><label for="f-amt"><?= e(t('Amount')) ?></label><input class="input mono" id="f-amt" name="amount" inputmode="numeric" required placeholder="50000"></div>
      <div class="field full"><label for="f-note"><?= e(t('Note')) ?></label><input class="input" id="f-note" name="note" maxlength="200" placeholder="<?= e(t('e.g. bank transfer 1 Nov')) ?>"><p class="help"><?= e(t('Required for adjustments. Entries cannot be edited or deleted; correct mistakes with a new adjustment.')) ?></p></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>

<dialog class="modal" id="dlg-rs" aria-labelledby="rs-t">
  <form method="post" action="<?= e(url('/resellers/save')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="rs-t"><?= e(t('Reseller settings')) ?>: <span data-rs-title></span></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field full"><label class="switch"><input type="checkbox" name="active" value="1"><span class="track"></span><span><?= e(t('Active (can sell)')) ?></span></label></div>
      <div class="field"><label for="r-com"><?= e(t('Commission (%)')) ?></label><input class="input" id="r-com" name="commission" type="number" step="0.01" min="0" max="100" value="0"><p class="help"><?= e(t('Credited to the wallet on every sale, % of the customer price.')) ?></p></div>
      <div class="field"><label for="r-adj"><?= e(t('Price markup / discount (%)')) ?></label><input class="input" id="r-adj" name="adj" type="number" step="0.01" min="-100" max="1000" value="0"><p class="help"><?= e(t('What the reseller pays vs the customer price. -10 = 10% discount, +5 = 5% markup.')) ?></p></div>
      <div class="field"><label for="r-cr"><?= e(t('Credit limit')) ?></label><input class="input" id="r-cr" name="credit" type="number" min="0" step="1" value="0"><p class="help"><?= e(t('How far below zero the balance may go. 0 = prepaid only.')) ?></p></div>
      <div class="field full"><label class="switch"><input type="checkbox" name="allow_all" value="1" checked><span class="track"></span><span><?= e(t('May sell all profiles')) ?></span></label></div>
      <div class="field full"><label><?= e(t('Allowed profiles (when not all) with optional own markup/discount %')) ?></label>
        <?php if (!$prices) { echo '<p class="muted">' . e(t('No priced profiles found (router unreachable?).')) . '</p>'; } else { ?>
        <div class="rs-profiles">
          <?php foreach ($prices as $name => $base) { ?>
          <label data-prof="<?= e($name) ?>"><input type="checkbox" name="prof[<?= e($name) ?>]" value="1"><span><?= e($name) ?> <span class="muted"><?= e(money($base)) ?></span></span><input class="input input-sm" type="number" step="0.01" min="-100" max="1000" name="padj[<?= e($name) ?>]" placeholder="%" aria-label="<?= e(t('Adjustment')) ?> <?= e($name) ?>"></label>
          <?php } ?>
        </div>
        <?php } ?>
      </div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<script src="<?= e(asset('/assets/js/mod-security.js')) ?>" defer></script>
