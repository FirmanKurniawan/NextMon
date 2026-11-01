<?php
return [
    ['group' => 'Network', 'items' => [
        ['monitor', '/monitor', 'activity', 'Monitor', 'view'],
        ['pppoe', '/pppoe', 'users', 'PPPoE', 'view'],
        ['dhcp', '/dhcp', 'list', 'DHCP leases', 'view'],
        ['arp', '/arp', 'link', 'ARP', 'view'],
        ['walledgarden', '/walledgarden', 'globe', 'Walled garden', 'view'],
        ['wizard', '/wizard', 'zap', 'Setup wizard', 'admin'],
    ]],
];
