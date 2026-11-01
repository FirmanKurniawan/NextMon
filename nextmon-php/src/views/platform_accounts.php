<?php /** Vars: $rows (workspaces + owner_name, user_count, router_count, eff), $defaults, $home */ ?>
<?= page_head(t('Accounts'), t('Workspaces of this installation. Suspending an account blocks its sign-in, public pages, API keys and scheduled jobs.')) ?>

<section class="card glass" style="margin-bottom:var(--s4)"><div class="card-b">
  <h2 style="font-size:var(--fs-14);margin-bottom:var(--s3)"><?= e(t('New account')) ?></h2>
  <form class="row" method="post" action="<?= e(url('/platform/accounts/create')) ?>" style="align-items:flex-end;flex-wrap:wrap">
    <?= csrf_field() ?>
    <div class="field"><label for="pa-name"><?= e(t('Name')) ?></label><input class="input" id="pa-name" name="name" required maxlength="60"></div>
    <div class="field"><label for="pa-slug"><?= e(t('Slug')) ?></label><input class="input" id="pa-slug" name="slug" pattern="[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]" placeholder="warung-budi"></div>
    <div class="field"><label for="pa-owner"><?= e(t('Owner username')) ?></label><input class="input" id="pa-owner" name="owner" required pattern="[A-Za-z0-9_.\-]{3,32}" autocomplete="off"></div>
    <div class="field"><label for="pa-pw"><?= e(t('Password')) ?></label><input class="input" id="pa-pw" name="password" type="password" required autocomplete="new-password"></div>
    <div class="field"><label for="pa-lr"><?= e(t('Router limit')) ?></label><input class="input" id="pa-lr" name="routers" inputmode="numeric" pattern="[0-9]*" placeholder="<?= e((string)$defaults['routers']) ?>" size="4"></div>
    <div class="field"><label for="pa-ls"><?= e(t('Staff limit')) ?></label><input class="input" id="pa-ls" name="staff" inputmode="numeric" pattern="[0-9]*" placeholder="<?= e((string)$defaults['staff']) ?>" size="4"></div>
    <button class="btn btn-primary"><?= icon('plus', 16) ?><?= e(t('Create account')) ?></button>
  </form>
</div></section>

<section class="card glass">
  <div class="table-wrap">
    <table class="tbl resp">
      <thead><tr><th><?= e(t('Name')) ?></th><th><?= e(t('Slug')) ?></th><th><?= e(t('Status')) ?></th><th><?= e(t('Owner')) ?></th><th><?= e(t('Users')) ?></th><th><?= e(t('Routers')) ?></th><th><?= e(t('Limits')) ?></th><th><span class="sr-only"><?= e(t('Actions')) ?></span></th></tr></thead>
      <tbody>
      <?php foreach ($rows as $w) { $susp = ($w['status'] ?? 'active') === 'suspended'; ?>
        <tr>
          <td data-label="<?= e(t('Name')) ?>"><b><?= e($w['name']) ?></b></td>
          <td data-label="<?= e(t('Slug')) ?>" class="mono"><?= e($w['slug']) ?> <span class="muted">(<?= e($w['id']) ?>)</span></td>
          <td data-label="<?= e(t('Status')) ?>"><?= $susp ? badge(t('Suspended'), 'warn') : badge(t('Active'), 'ok') ?></td>
          <td data-label="<?= e(t('Owner')) ?>"><?= e($w['owner_name'] ?: '-') ?></td>
          <td data-label="<?= e(t('Users')) ?>"><?= (int)$w['user_count'] ?></td>
          <td data-label="<?= e(t('Routers')) ?>"><?= (int)$w['router_count'] ?> / <?= (int)$w['eff']['routers'] ?: '&infin;' ?></td>
          <td data-label="<?= e(t('Limits')) ?>">
            <form class="inline-form row" method="post" action="<?= e(url('/platform/accounts/limits')) ?>" style="gap:var(--s1)">
              <?= csrf_field() ?><input type="hidden" name="id" value="<?= e($w['id']) ?>">
              <input class="input" name="routers" size="3" inputmode="numeric" value="<?= e((string)($w['limits']['routers'] ?? '')) ?>" placeholder="<?= e((string)$defaults['routers']) ?>" aria-label="<?= e(t('Router limit')) ?>">
              <input class="input" name="staff" size="3" inputmode="numeric" value="<?= e((string)($w['limits']['staff'] ?? '')) ?>" placeholder="<?= e((string)$defaults['staff']) ?>" aria-label="<?= e(t('Staff limit')) ?>">
              <input class="input" name="vouchers_per_day" size="5" inputmode="numeric" value="<?= e((string)($w['limits']['vouchers_per_day'] ?? '')) ?>" placeholder="<?= e((string)$defaults['vouchers_per_day']) ?>" aria-label="<?= e(t('Vouchers per day')) ?>">
              <input class="input" name="log_rows" size="5" inputmode="numeric" value="<?= e((string)($w['limits']['log_rows'] ?? '')) ?>" placeholder="<?= e((string)$defaults['log_rows']) ?>" aria-label="<?= e(t('Log size (rows)')) ?>">
              <button class="btn btn-sm"><?= e(t('Save')) ?></button>
            </form>
          </td>
          <td class="actions" data-label="">
            <?php if ($w['id'] !== $home) { ?>
            <form class="inline-form" method="post" action="<?= e(url('/platform/switch')) ?>"><?= csrf_field() ?><input type="hidden" name="workspace" value="<?= e($w['id']) ?>"><button class="btn btn-sm"><?= e(t('Enter')) ?></button></form>
            <?php } ?>
            <form class="inline-form" method="post" action="<?= e(url('/platform/accounts/status')) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($w['id']) ?>"><input type="hidden" name="status" value="<?= $susp ? 'active' : 'suspended' ?>"><button class="btn btn-sm"><?= e($susp ? t('Reactivate') : t('Suspend')) ?></button></form>
            <form class="inline-form row" method="post" action="<?= e(url('/platform/accounts/reset')) ?>" style="gap:var(--s1)"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($w['id']) ?>"><input class="input" name="password" type="password" size="10" autocomplete="new-password" placeholder="<?= e(t('New password')) ?>" aria-label="<?= e(t('New password')) ?>"><button class="btn btn-sm"><?= e(t('Reset password')) ?></button></form>
            <?php if ($w['id'] !== 'main' && $w['id'] !== $home) { ?>
            <form class="inline-form" method="post" action="<?= e(url('/platform/accounts/delete')) ?>" data-confirm="<?= e(t('Delete account :n and ALL its data?', [':n' => $w['name']])) ?>"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($w['id']) ?>"><button class="btn btn-sm btn-danger btn-icon" aria-label="<?= e(t('Delete')) ?>"><?= icon('trash', 16) ?></button></form>
            <?php } ?>
          </td>
        </tr>
      <?php } ?>
      </tbody>
    </table>
  </div>
</section>
