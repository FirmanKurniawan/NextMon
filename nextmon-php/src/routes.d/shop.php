<?php
/** Shop module routes. /shop, /shop/order and /pay/callback are public (App::PUBLIC_PATHS); their auth is token/signature based. */
return [
    'GET /shop' => ['ShopController', 'page', 'view'],
    'POST /shop/order' => ['ShopController', 'create', 'view'],
    'GET /shop/order' => ['ShopController', 'status', 'view'],
    'GET /pay/callback' => ['ShopController', 'payPage', 'view'],
    'POST /pay/callback' => ['ShopController', 'callback', 'view'],

    'GET /shop/settings' => ['ShopController', 'settings', 'admin'],
    'POST /shop/settings/save' => ['ShopController', 'settingsSave', 'admin'],

    'GET /orders' => ['OrdersController', 'index', 'write'],
    'GET /orders/view' => ['OrdersController', 'view', 'write'],
    'GET /orders/export' => ['OrdersController', 'export', 'write'],
    'POST /orders/action' => ['OrdersController', 'action', 'write'],
];
