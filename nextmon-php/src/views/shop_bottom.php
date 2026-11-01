<?php /** Shared public shop frame (bottom). */ ?>
  <footer class="shp-foot">
    <a href="<?= e(url('/status')) ?>"><?= e(t('Check voucher status')) ?></a>
    <span aria-hidden="true">&middot;</span>
    <span class="muted">NextMON</span>
  </footer>
</main>
<script src="<?= e(asset('/assets/js/qr.js')) ?>"></script>
<script src="<?= e(asset('/assets/js/mod-shop.js')) ?>"></script>
</body>
</html>
