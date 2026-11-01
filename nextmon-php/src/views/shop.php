<?php /** Public storefront. Vars: $c $title $packages $err $old */
include __DIR__ . '/shop_top.php';
$sel = (string)($old['package'] ?? '');
if ($sel === '' && count($packages) === 1) {
    $sel = $packages[0]['id'];
}
?>
  <section class="shp-card glass">
    <h1 class="shp-h1"><?= e($c['tagline'] !== '' ? $c['tagline'] : t('Buy WiFi access')) ?></h1>
    <p class="muted shp-lead"><?= e(t('Choose a package, pay, and get your voucher instantly.')) ?></p>

    <?php if ($err) { ?><div class="alert err" role="alert"><?= icon('alert', 18) ?><div><?= e($err) ?></div></div><?php } ?>

    <?php if (!$c['enabled']) { ?>
      <?= empty_state('wifi', t('The shop is currently closed.'), t('Please ask the staff for a voucher.')) ?>
    <?php } elseif (!$packages) { ?>
      <?= empty_state('tag', t('No packages available'), t('Please check back later.')) ?>
    <?php } else { ?>
    <form method="post" action="<?= e(url('/shop/order') . Shop::wQuery()) ?>" class="shp-form" id="shop-form" autocomplete="on">
      <?= csrf_field() ?>
      <div class="shp-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

      <fieldset class="shp-packs">
        <legend class="label"><?= e(t('Package')) ?></legend>
        <?php foreach ($packages as $p) { $lab = $p['label'] !== '' ? $p['label'] : $p['profile']; ?>
        <label class="shp-pack">
          <input type="radio" name="package" value="<?= e($p['id']) ?>" data-price="<?= e(money($p['price'])) ?>" required<?= chk($sel === $p['id']) ?>>
          <span class="shp-pack-body">
            <span class="shp-dot" aria-hidden="true"></span>
            <span class="shp-pack-main">
              <span class="shp-pack-title"><b><?= e($lab) ?></b><?php if ($p['badge'] !== '') { ?><span class="shp-chip"><?= e($p['badge']) ?></span><?php } ?></span>
              <?php if ($p['desc'] !== '') { ?><span class="shp-pack-desc"><?= e($p['desc']) ?></span><?php } ?>
            </span>
            <span class="shp-price"><?= e(money($p['price'])) ?></span>
          </span>
        </label>
        <?php } ?>
      </fieldset>

      <div class="shp-fields">
        <div class="field"><label for="f-name"><?= e(t('Name')) ?></label><input class="input" id="f-name" name="name" value="<?= e($old['name'] ?? '') ?>" required maxlength="60" autocomplete="name"></div>
        <div class="field"><label for="f-phone"><?= e(t('Phone / WhatsApp')) ?><?= $c['require_phone'] ? '' : ' <span class="muted">(' . e(t('optional')) . ')</span>' ?></label><input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" value="<?= e($old['phone'] ?? '') ?>"<?= $c['require_phone'] ? ' required' : '' ?> maxlength="20" autocomplete="tel" placeholder="08xxxxxxxxxx"></div>
        <div class="field"><label for="f-email"><?= e(t('Email')) ?> <span class="muted">(<?= e(t('optional')) ?>)</span></label><input class="input" id="f-email" name="email" type="email" value="<?= e($old['email'] ?? '') ?>" maxlength="100" autocomplete="email"></div>
      </div>

      <?php if (trim($c['terms']) !== '') { ?>
      <details class="shp-terms"><summary><?= e(t('Terms and conditions')) ?></summary><div><?= nl2br(e($c['terms'])) ?></div></details>
      <label class="check shp-agree"><input type="checkbox" name="terms" value="1" required><?= e(t('I agree to the terms')) ?></label>
      <?php } ?>

      <div class="shp-bar">
        <div class="shp-total"><span class="muted"><?= e(t('Total')) ?></span><b id="shp-total">-</b></div>
        <button class="btn btn-primary btn-lg" type="submit" id="shp-submit"><?= e(t('Pay now')) ?></button>
      </div>
    </form>
    <?php } ?>
  </section>
<?php include __DIR__ . '/shop_bottom.php'; ?>
