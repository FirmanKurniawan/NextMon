/** Strings the shared vanilla JS (app.js/pages.js) needs, passed in <script type="application/json" id="i18n">. Same list as the PHP layout. */
export const JS_STRINGS = [
  'Close', 'Command palette', 'Focus search', 'Toggle sidebar', 'Show shortcuts', 'Select range', 'Go to', 'This page', 'Appearance', 'Recent', 'Accent', 'Density',
  'Compact', 'Comfortable', 'A new version of NextMON is ready.', 'Sent', 'received', 'loss', 'Host', 'Time', 'TTL', 'Size', 'timeout', 'Hop', 'Address', 'Loss %', 'Last',
  'Avg', 'Best', 'Worst', 'Source', 'Destination', 'Proto', 'Port', 'TX', 'RX', 'Topics', 'Message', 'Identity', 'Board', 'RouterOS', 'Uptime', 'CPU load', 'Memory',
  'Temperature', 'CPU temperature', 'Voltage', 'Auto', 'Light', 'Dark', 'Update',
  'Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).', 'Popup blocked',
  'BarcodeDetector / camera not supported in this browser. Use Chrome on Android or desktop (HTTPS).', 'Account', 'Refresh data', 'Rows', 'All', 'Columns', 'General',
  'Navigate', 'Select', 'Shortcuts',
  // keys used by pages.js dashboard
  'users total', 'vs yesterday', 'sales', 'Peak hour', 'Busiest day', 'Peak',
];

/** Short keys the JS looks up (K.t('copied') ...) mapped to English source strings. */
export const JS_KEYS: Record<string, string> = {
  copied: 'Copied',
  error: 'Something went wrong',
  confirm: 'Are you sure?',
  selected: ':n selected',
  theme: 'Toggle theme',
  lang: 'Switch language',
  logout: 'Sign out',
  nodata: 'No data',
  offline: 'You are offline',
  pages: 'Pages',
  actions: 'Actions',
  noresult: 'No results',
  close: 'Close',
  rows: 'rows',
  all: 'All',
  columns: 'Columns',
  shortcuts: 'Keyboard shortcuts',
  general: 'General',
  navigate: 'Navigate',
  select: 'Select',
};
