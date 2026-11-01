<?php
return [
    'GET /pppoe' => ['NetworkController', 'pppoe', 'view'],
    'POST /pppoe/secret/save' => ['NetworkController', 'pppSecretSave', 'write'],
    'POST /pppoe/secret/action' => ['NetworkController', 'pppSecretAction', 'write'],
    'POST /pppoe/active/kick' => ['NetworkController', 'pppActiveKick', 'write'],
    'POST /pppoe/profile/save' => ['NetworkController', 'pppProfileSave', 'write'],
    'POST /pppoe/profile/delete' => ['NetworkController', 'pppProfileDelete', 'write'],

    'GET /dhcp' => ['NetworkController', 'dhcp', 'view'],
    'POST /dhcp/save' => ['NetworkController', 'dhcpSave', 'write'],
    'POST /dhcp/action' => ['NetworkController', 'dhcpAction', 'write'],

    'GET /arp' => ['NetworkController', 'arp', 'view'],
    'POST /arp/save' => ['NetworkController', 'arpSave', 'write'],
    'POST /arp/action' => ['NetworkController', 'arpAction', 'write'],

    'GET /walledgarden' => ['NetworkController', 'walled', 'view'],
    'POST /walledgarden/save' => ['NetworkController', 'walledSave', 'write'],
    'POST /walledgarden/action' => ['NetworkController', 'walledAction', 'write'],
    'POST /walledgarden/defaults' => ['NetworkController', 'walledDefaults', 'write'],
];
