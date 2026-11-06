export function filterVisibleWindows(windows) {
    return windows.filter(window => !window.is_skip_taskbar());
}

export function getVisibleAppWindows(app) {
    return filterVisibleWindows(app.get_windows());
}
