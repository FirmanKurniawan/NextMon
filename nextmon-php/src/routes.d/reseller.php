<?php
/** Reseller / agent wallets. NOTE: POST /vouchers/generate is wrapped (charges a reseller, then delegates to VoucherController::generate). */
return [
    'GET /resellers' => ['ResellerController', 'index', 'admin'],
    'POST /resellers/save' => ['ResellerController', 'save', 'admin'],
    'POST /resellers/fund' => ['ResellerController', 'fund', 'admin'],
    'POST /resellers/refund' => ['ResellerController', 'refund', 'admin'],
    'GET /resellers/ledger' => ['ResellerController', 'ledger', 'admin'],
    'GET /me/wallet' => ['ResellerController', 'wallet', 'sell'],
    'POST /vouchers/generate' => ['ResellerController', 'voucherGenerate', 'sell'],
];
