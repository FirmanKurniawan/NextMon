<?php /** Vars: $ifaces */ ?>
<?= page_head(t('Tools'), t('Diagnostics that run on the router itself.')) ?>
<section class="card glass" id="tools" data-run-url="<?= e(url('/tools/run')) ?>">
  <div class="card-b">
    <div class="tabs" role="tablist" aria-label="<?= e(t('Tools')) ?>">
      <?php foreach (['ping' => 'Ping', 'traceroute' => 'Traceroute', 'torch' => 'Torch', 'health' => 'System health', 'logs' => 'Logs'] as $k => $l) { ?>
        <button type="button" role="tab" id="tab-<?= $k ?>" aria-controls="panel-<?= $k ?>" aria-selected="<?= $k === 'ping' ? 'true' : 'false' ?>" data-tab="<?= $k ?>"><?= e(t($l)) ?></button>
      <?php } ?>
    </div>

    <div class="tabpanel" role="tabpanel" id="panel-ping" aria-labelledby="tab-ping">
      <form class="row" data-tool="ping"><div class="field" style="flex:1 1 220px"><label for="pg-a"><?= e(t('Address')) ?></label><input class="input mono" id="pg-a" name="address" value="8.8.8.8" required autocapitalize="off"></div>
        <div class="field" style="width:96px"><label for="pg-c"><?= e(t('Count')) ?></label><input class="input" id="pg-c" name="count" type="number" min="1" max="10" value="4"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary"><?= e(t('Run')) ?></button></div></form>
    </div>
    <div class="tabpanel" role="tabpanel" id="panel-traceroute" aria-labelledby="tab-traceroute" hidden>
      <form class="row" data-tool="traceroute"><div class="field" style="flex:1 1 220px"><label for="tr-a"><?= e(t('Address')) ?></label><input class="input mono" id="tr-a" name="address" value="8.8.8.8" required autocapitalize="off"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary"><?= e(t('Run')) ?></button></div></form>
    </div>
    <div class="tabpanel" role="tabpanel" id="panel-torch" aria-labelledby="tab-torch" hidden>
      <form class="row" data-tool="torch"><div class="field" style="flex:1 1 200px"><label for="to-i"><?= e(t('Interface')) ?></label><select class="select" id="to-i" name="interface"><?php foreach ($ifaces as $i) { ?><option><?= e($i) ?></option><?php } ?></select></div>
        <div class="field" style="width:120px"><label for="to-d"><?= e(t('Seconds')) ?></label><input class="input" id="to-d" name="duration" type="number" min="1" max="10" value="3"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary"><?= e(t('Start torch')) ?></button></div></form>
    </div>
    <div class="tabpanel" role="tabpanel" id="panel-health" aria-labelledby="tab-health" hidden>
      <form class="row" data-tool="health"><button class="btn btn-primary"><?= icon('refresh', 16) ?><?= e(t('Read health')) ?></button></form>
    </div>
    <div class="tabpanel" role="tabpanel" id="panel-logs" aria-labelledby="tab-logs" hidden>
      <form class="row" data-tool="logs"><div class="field" style="flex:1 1 200px"><label for="lg-t"><?= e(t('Topic contains')) ?></label><input class="input" id="lg-t" name="topic" placeholder="hotspot"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary"><?= e(t('Load logs')) ?></button></div></form>
    </div>

    <div id="tool-out" style="margin-top:var(--s4)" aria-live="polite"></div>
  </div>
</section>
