import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import DockHoverTracker from './trackers/dockHoverTracker.js';
import MaximizeWorkspaceTracker from './trackers/maximizeWorkspaceTracker.js';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.dock-window-preview';

function getVisibleAppWindows(app) {
    if (!app || typeof app.get_windows !== 'function')
        return [];

    return app.get_windows().filter(window => {
        if (!window)
            return false;

        if (typeof window.is_skip_taskbar === 'function')
            return !window.is_skip_taskbar();

        return !window.skip_taskbar;
    });
}

export default class DockWindowPreviewExtension extends Extension {
    enable() {
        try {
            this._settings = this.getSettings(SETTINGS_SCHEMA);
        } catch (error) {
            console.error(`[dock-window-preview] Failed to load settings: ${error}`);
            this._settings = null;
        }

        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(
            AppDisplay.AppIcon.prototype,
            'shouldShowTooltip',
            originalMethod => function () {
                if (this instanceof Dash.DashIcon && getVisibleAppWindows(this.app).length > 0)
                    return false;

                if (typeof originalMethod === 'function')
                    return originalMethod.call(this);

                return false;
            }
        );

        this._tracker = new DockHoverTracker(this._settings);
        this._tracker.enable();

        this._maximizeWorkspaceTracker = new MaximizeWorkspaceTracker(this._settings);
        this._maximizeWorkspaceTracker.enable();
    }

    disable() {
        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        if (this._maximizeWorkspaceTracker) {
            this._maximizeWorkspaceTracker.destroy();
            this._maximizeWorkspaceTracker = null;
        }

        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }

        this._settings = null;
    }
}
