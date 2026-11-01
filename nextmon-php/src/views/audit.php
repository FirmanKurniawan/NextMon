<?php /** Vars: $rows */ ?>
<?= page_head(t('Audit log'), t('Who did what. The newest 300 events are shown.')) ?>
<section class="card glass">
  <div class="tbl-tools"><input class="input search" type="search" placeholder="<?= e(t('Filter this list')) ?>" data-filter="#audit-tbl" aria-label="<?= e(t('Filter')) ?>"></div>
  <?php if (!$rows) { echo empty_state('list', t('No activity yet.')); } else { ?>
  <div class="table-wrap"><table class="tbl resp" id="audit-tbl">
    <thead><tr><th><?= e(t('Time')) ?></th><th data-sort><?= e(t('User')) ?></th><th data-sort><?= e(t('Action')) ?></th><th><?= e(t('Detail')) ?></th><th>IP</th><th><?= e(t('Router')) ?></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $a) { ?>
      <tr>
        <td data-label="<?= e(t('Time')) ?>" class="mono nowrap"><?= e(date('Y-m-d H:i:s', (int)$a['ts'])) ?></td>
        <td data-label="<?= e(t('User')) ?>"><?= e($a['user']) ?></td>
        <td data-label="<?= e(t('Action')) ?>"><?= badge($a['action'], strpos($a['action'], 'fail') !== false || strpos($a['action'], 'error') !== false ? 'err' : 'neutral') ?></td>
        <td data-label="<?= e(t('Detail')) ?>" class="wrap"><?= e($a['detail']) ?></td>
        <td data-label="IP" class="mono"><?= e($a['ip']) ?></td>
        <td data-label="<?= e(t('Router')) ?>" class="mono"><?= e($a['router']) ?></td>
      </tr>
    <?php } ?>
    </tbody>
  </table></div>
  <?php } ?>
</section>
