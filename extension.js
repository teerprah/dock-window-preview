import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import DockHoverTracker from './trackers/dockHoverTracker.js';
import {getVisibleAppWindows} from './utils/windows.js';

export default class DockWindowPreviewExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(
            AppDisplay.AppIcon.prototype,
            'shouldShowTooltip',
            originalMethod => function () {
                if (this instanceof Dash.DashIcon && getVisibleAppWindows(this.app).length > 0)
                    return false;
                return originalMethod.call(this);
            }
        );

        this._tracker = new DockHoverTracker(this._settings);
        this._tracker.enable();

        this._maximizeWorkspaceTracker = new MaximizeWorkspaceTracker(this._settings);
        this._maximizeWorkspaceTracker.enable();
    }

    disable() {
        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }

        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        this._settings = null;
    }
}
