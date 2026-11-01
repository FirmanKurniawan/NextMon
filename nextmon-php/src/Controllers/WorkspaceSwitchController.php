<?php
/**
 * POST /platform/switch   workspace = <id | slug | "home" | "">
 * Platform admins only (capability `platform`, CSRF-checked by App::run). The choice lives in the SERVER session ($_SESSION['ws_switch']);
 * Auth::user() re-validates it on every request. Both the entry and the exit are audited in the target workspace (via=platform) and in
 * the platform log.
 */
class WorkspaceSwitchController
{
    public static function switchTo(): void
    {
        $u = Auth::user();
        $home = (string)($u['workspace'] ?? 'main');
        $to = App::post('workspace');
        $target = $home;
        if ($to !== '' && $to !== 'home' && $to !== $home) {
            $w = Workspace::resolveRef($to);
            if (!$w) {
                App::redirect(App::localPath(App::post('back'), '/'), t('Workspace not found.'), 'err');
            }
            $target = (string)$w['id'];
        }
        $from = Workspace::id();
        if ($target === $home) {
            unset($_SESSION['ws_switch']);
        } else {
            $_SESSION['ws_switch'] = $target;
        }
        unset($_SESSION['router']);
        Workspace::platformLog('platform.switch', $from . ' -> ' . $target);
        Workspace::set($target);
        App::$impersonating = $target !== $home;
        Audit::log($target === $home ? 'platform.leave' : 'platform.enter', $from . ' -> ' . $target);
        App::redirect('/');
    }
}
