<?php /** Vars: $rows $counts */ $canW = Auth::can('write'); ?>
<?= page_head(t('User profiles'), t('Rate limits, price, validity and the on-login script that records sales.'),
    $canW ? '<button class="btn btn-primary" type="button" data-open="#dlg-prof" data-new>' . icon('plus', 16) . e(t('Add profile')) . '</button>' : '') ?>

<section class="card glass">
  <?php if ($rows) { ?><div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#prof-tbl" aria-label="<?= e(t('Filter')) ?>"><span class="spacer"></span></div><?php } ?>
  <?php if (!$rows) { echo empty_state('tag', t('No profiles yet')); } else { ?>
  <div class="table-wrap">
    <table class="tbl resp" id="prof-tbl">
      <thead><tr><th data-sort><?= e(t('Name')) ?></th><th><?= e(t('Rate limit')) ?></th><th class="num"><?= e(t('Price')) ?></th><th><?= e(t('Validity')) ?></th><th><?= e(t('Expired mode')) ?></th><th><?= e(t('Locks')) ?></th><th class="num"><?= e(t('Users')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $p) { $m = $p['_meta']; ?>
        <tr>
          <td data-label="<?= e(t('Name')) ?>"><b><?= e($p['name']) ?></b></td>
          <td data-label="<?= e(t('Rate limit')) ?>" class="mono"><?= e($p['rate-limit'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Price')) ?>" class="num"><?= $m && $m['sprice'] !== '' ? e(money($m['sprice'])) : '-' ?></td>
          <td data-label="<?= e(t('Validity')) ?>" class="mono"><?= e($m['validity'] ?? '') ?: '-' ?></td>
          <td data-label="<?= e(t('Expired mode')) ?>"><?= $m ? badge($m['mode'], strpos($m['mode'], 'c') !== false ? 'info' : 'neutral') : '<span class="muted">-</span>' ?></td>
          <td data-label="<?= e(t('Locks')) ?>"><?php if ($m && $m['lock_user']) { echo badge('MAC'); } if ($m && $m['lock_server']) { echo ' ' . badge('Server'); } if (!$m || (!$m['lock_user'] && !$m['lock_server'])) { echo '<span class="muted">-</span>'; } ?></td>
          <td data-label="<?= e(t('Users')) ?>" class="num"><?= (int)($counts[$p['name']] ?? 0) ?></td>
          <td class="actions" data-label="">
            <?php if ($canW) { ?>
            <button class="btn btn-sm btn-ghost btn-icon" type="button" aria-label="<?= e(t('Edit')) ?>" data-open="#dlg-prof" data-edit="<?= jattr(['id' => $p['.id'], 'name' => $p['name'], 'rate_limit' => $p['rate-limit'] ?? '', 'shared' => $p['shared-users'] ?? '1', 'mode' => $m['mode'] ?? 'none', 'price' => $m['price'] ?? '', 'sprice' => $m['sprice'] ?? '', 'validity' => $m['validity'] ?? '', 'lock_user' => !empty($m['lock_user']) ? '1' : '', 'lock_server' => !empty($m['lock_server']) ? '1' : '', 'parent_queue' => ($p['parent-queue'] ?? '') === 'none' ? '' : ($p['parent-queue'] ?? ''), 'pool' => $p['address-pool'] ?? '']) ?>"><?= icon('edit', 16) ?></button>
            <?php if ($p['name'] !== 'default') { ?>
            <form class="inline-form" method="post" action="<?= e(url('/hotspot/profiles/delete')) ?>" data-confirm="<?= e(t('Delete profile :n?', [':n' => $p['name']])) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['.id']) ?>"><input type="hidden" name="name" value="<?= e($p['name']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form>
            <?php } } ?>
          </td>
        </tr>
      <?php } ?>
      </tbody>
    </table>
  </div>
  <?php } ?>
</section>

<?php if ($canW) { ?>
<dialog class="modal wide" id="dlg-prof" aria-labelledby="dlg-prof-t">
  <form method="post" action="<?= e(url('/hotspot/profiles/save')) ?>" data-preview-url="<?= e(url('/hotspot/profiles/preview')) ?>">
    <?= csrf_field() ?><input type="hidden" name="id">
    <div class="modal-h"><h2 id="dlg-prof-t"><?= e(t('User profile')) ?></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="<?= e(t('Close')) ?>"><?= icon('x') ?></button></div>
    <div class="modal-b"><div class="form-grid">
      <div class="field"><label for="p-name"><?= e(t('Name')) ?></label><input class="input" id="p-name" name="name" required maxlength="40"></div>
      <div class="field"><label for="p-rate"><?= e(t('Rate limit (rx/tx)')) ?></label><input class="input mono" id="p-rate" name="rate_limit" placeholder="2M/2M"></div>
      <div class="field"><label for="p-shared"><?= e(t('Shared users')) ?></label><input class="input" id="p-shared" name="shared" type="number" min="1" value="1"></div>
      <div class="field"><label for="p-valid"><?= e(t('Validity')) ?></label><input class="input mono" id="p-valid" name="validity" placeholder="1d" autocapitalize="off"><p class="help"><?= e(t('Active period counted from first login, e.g. 3h, 1d, 30d.')) ?></p></div>
      <div class="field"><label for="p-price"><?= e(t('Price')) ?></label><input class="input" id="p-price" name="price" inputmode="numeric" placeholder="5000"></div>
      <div class="field"><label for="p-sprice"><?= e(t('Selling price')) ?></label><input class="input" id="p-sprice" name="sprice" inputmode="numeric" placeholder="<?= e(t('same as price')) ?>"></div>
      <div class="field full"><label for="p-mode"><?= e(t('Expired mode')) ?></label>
        <select class="select" id="p-mode" name="mode">
          <option value="remc"><?= e(t('remc - remove on expiry + record sale')) ?></option>
          <option value="rem"><?= e(t('rem - remove on expiry')) ?></option>
          <option value="ntfc"><?= e(t('ntfc - keep user, block login + record sale')) ?></option>
          <option value="ntf"><?= e(t('ntf - keep user, block login')) ?></option>
          <option value="none"><?= e(t('none - no script')) ?></option>
        </select></div>
      <div class="field"><label class="switch"><input type="checkbox" name="lock_user" value="1"><span class="track"></span><span><?= e(t('Lock user to first MAC')) ?></span></label></div>
      <div class="field"><label class="switch"><input type="checkbox" name="lock_server" value="1"><span class="track"></span><span><?= e(t('Lock to hotspot server')) ?></span></label></div>
      <div class="field"><label for="p-queue"><?= e(t('Parent queue')) ?></label><input class="input" id="p-queue" name="parent_queue"></div>
      <div class="field"><label for="p-pool"><?= e(t('Address pool')) ?></label><input class="input" id="p-pool" name="pool"></div>
      <div class="full"><button type="button" class="btn btn-sm" data-preview-script><?= icon('terminal', 16) ?><?= e(t('Preview on-login script')) ?></button>
        <pre class="out" id="script-out" hidden style="margin-top:var(--s2)"></pre></div>
    </div></div>
    <div class="modal-f"><button type="button" class="btn" data-close><?= e(t('Cancel')) ?></button><button class="btn btn-primary"><?= e(t('Save')) ?></button></div>
  </form>
</dialog>
<?php } ?>
