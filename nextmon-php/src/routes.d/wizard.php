<?php
return [
    'GET /wizard' => ['WizardController', 'index', 'admin'],
    'POST /wizard/run' => ['WizardController', 'run', 'admin'],
    'POST /wizard/use-user' => ['WizardController', 'useUser', 'admin'],
    'GET /wizard/template.zip' => ['WizardController', 'templateZip', 'admin'],
];
