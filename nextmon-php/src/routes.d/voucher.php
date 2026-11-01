<?php
// Extra voucher routes (single-voucher quick print, print presets).
return [
    'POST /vouchers/quick' => ['VoucherController', 'quick', 'sell'],
    'POST /vouchers/preset/save' => ['VoucherController', 'presetSave', 'sell'],
    'POST /vouchers/preset/delete' => ['VoucherController', 'presetDelete', 'sell'],
    'POST /vouchers/preset/default' => ['VoucherController', 'presetDefault', 'write'],
];
