<?php /** Vars: $code, $message, optional $routerHelp */ ?>
<div class="card glass" style="max-width:640px;margin:var(--s6) auto">
  <div class="card-b">
    <?= empty_state($code >= 500 ? 'alert' : 'ban', ($code ?: '') . ' ' . $title, $message,
        '<div class="row" style="justify-content:center;margin-top:var(--s3)"><a class="btn btn-primary" href="' . e(url('/')) . '">' . e(t('Back to dashboard')) . '</a>'
        . (!empty($routerHelp) ? '<a class="btn" href="' . e(url('/routers')) . '">' . e(t('Check routers')) . '</a>' : '') . '</div>') ?>
  </div>
</div>
