<?php
// "Resellers" for admins; "My wallet" only for reseller accounts (so operators/admins do not see an empty page)
$items = [['resellers', '/resellers', 'users', 'Resellers', 'admin']];
$u = Auth::user();
if ($u && ($u['role'] ?? '') === 'reseller') {
    $items[] = ['wallet', '/me/wallet', 'cart', 'My wallet', 'sell'];
}
return [['group' => 'Sales', 'items' => $items]];
