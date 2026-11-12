import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export default class MaximizeWorkspaceTracker {
    constructor(settings) {
        this._settings = settings;
        this._enabled = this._settings.get_boolean('maximize-to-new-workspace');
        this._settingsChangedId = 0;
        this._windowCreatedId = 0;
        this._windowSignals = new Map();
        this._windowStates = new Map();
        this._pendingChecks = new Map();
        this._cleanupSourceIds = new Set();

        this._settingsChangedId = this._settings.connect(
            'changed::maximize-to-new-workspace',
            () => this._syncEnabled()
        );
    }

    enable() {
        this._windowCreatedId = global.display.connect(
            'window-created',
            (_display, metaWindow) => this._trackWindow(metaWindow)
        );

        for (const actor of global.get_window_actors())
            this._trackWindow(actor.meta_window);
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }

        for (const sourceId of this._pendingChecks.values())
            GLib.Source.remove(sourceId);
        this._pendingChecks.clear();

        for (const sourceId of this._cleanupSourceIds)
            GLib.Source.remove(sourceId);
        this._cleanupSourceIds.clear();

        for (const [metaWindow, signalIds] of this._windowSignals)
            for (const signalId of signalIds)
                metaWindow.disconnect(signalId);
        this._windowSignals.clear();

        this._restoreAllWindows(false);
        this._settings = null;
    }

    _syncEnabled() {
        this._enabled = this._settings.get_boolean('maximize-to-new-workspace');
        if (this._enabled) {
            for (const metaWindow of this._windowSignals.keys())
                this._queueWindowCheck(metaWindow);
        } else {
            this._restoreAllWindows(false);
        }
    }

    _trackWindow(metaWindow) {
        if (!metaWindow || this._windowSignals.has(metaWindow))
            return;

        const signalIds = [
            metaWindow.connect(
                'notify::maximized-horizontally',
                () => this._queueWindowCheck(metaWindow)
            ),
            metaWindow.connect(
                'notify::maximized-vertically',
                () => this._queueWindowCheck(metaWindow)
            ),
            metaWindow.connect(
                'unmanaged',
                () => this._windowUnmanaged(metaWindow)
            ),
        ];
        this._windowSignals.set(metaWindow, signalIds);
        this._queueWindowCheck(metaWindow);
    }

    _windowUnmanaged(metaWindow) {
        this._cancelWindowCheck(metaWindow);
        this._windowSignals.delete(metaWindow);

        const state = this._windowStates.get(metaWindow);
        this._windowStates.delete(metaWindow);
        if (state)
            this._queueWorkspaceCleanup(state.dedicatedWorkspace);
    }

    _queueWindowCheck(metaWindow) {
        if (this._pendingChecks.has(metaWindow))
            return;

        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingChecks.delete(metaWindow);

            if (this._windowSignals.has(metaWindow))
                this._checkWindow(metaWindow);

            return GLib.SOURCE_REMOVE;
        });
        this._pendingChecks.set(metaWindow, sourceId);
    }

    _cancelWindowCheck(metaWindow) {
        const sourceId = this._pendingChecks.get(metaWindow);
        if (!sourceId)
            return;

        GLib.Source.remove(sourceId);
        this._pendingChecks.delete(metaWindow);
    }

    _checkWindow(metaWindow) {
        const isMaximized =
            metaWindow.maximized_horizontally &&
            metaWindow.maximized_vertically;
        const state = this._windowStates.get(metaWindow);

        if (state) {
            if (!isMaximized)
                this._restoreWindow(metaWindow, state, true);
            return;
        }

        if (this._enabled && isMaximized && this._canManageWindow(metaWindow))
            this._moveWindowToNewWorkspace(metaWindow);
    }

    _canManageWindow(metaWindow) {
        return metaWindow.get_window_type() === Meta.WindowType.NORMAL &&
            metaWindow.can_maximize() &&
            !metaWindow.is_override_redirect() &&
            !metaWindow.is_skip_taskbar() &&
            !metaWindow.is_on_all_workspaces();
    }

    _moveWindowToNewWorkspace(metaWindow) {
        const workspaceManager = global.workspace_manager;
        const originalWorkspace = metaWindow.get_workspace();
        if (!originalWorkspace)
            return;

        const timestamp = global.get_current_time();
        const dedicatedWorkspace = workspaceManager.append_new_workspace(false, timestamp);
        this._windowStates.set(metaWindow, {
            originalWorkspace,
            originalWorkspaceIndex: originalWorkspace.index(),
            dedicatedWorkspace,
        });

        metaWindow.change_workspace(dedicatedWorkspace);
        dedicatedWorkspace.activate_with_focus(metaWindow, timestamp);
    }

    _restoreAllWindows(activate) {
        for (const [metaWindow, state] of [...this._windowStates])
            this._restoreWindow(metaWindow, state, activate);
    }

    _restoreWindow(metaWindow, state, activate) {
        this._windowStates.delete(metaWindow);

        const targetWorkspace = this._resolveOriginalWorkspace(state);
        if (targetWorkspace && targetWorkspace !== state.dedicatedWorkspace) {
            metaWindow.change_workspace(targetWorkspace);
            if (activate)
                targetWorkspace.activate_with_focus(metaWindow, global.get_current_time());
        }

        this._removeWorkspaceIfEmpty(state.dedicatedWorkspace);
    }

    _resolveOriginalWorkspace(state) {
        if (this._workspaceIsValid(state.originalWorkspace))
            return state.originalWorkspace;

        const workspaceManager = global.workspace_manager;
        const lastIndex = workspaceManager.get_n_workspaces() - 1;
        if (lastIndex < 0)
            return null;

        const index = clamp(state.originalWorkspaceIndex, 0, lastIndex);
        return workspaceManager.get_workspace_by_index(index);
    }

    _workspaceIsValid(workspace) {
        if (!workspace)
            return false;

        // Mutter may dispose a stored dynamic workspace before the window is restored.
        try {
            return workspace.index() >= 0;
        } catch {
            return false;
        }
    }

    _queueWorkspaceCleanup(workspace) {
        let sourceId = 0;
        sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._cleanupSourceIds.delete(sourceId);
            this._removeWorkspaceIfEmpty(workspace);
            return GLib.SOURCE_REMOVE;
        });
        this._cleanupSourceIds.add(sourceId);
    }

    _removeWorkspaceIfEmpty(workspace) {
        if (!this._workspaceIsValid(workspace))
            return;

        // Mutter removes empty dynamic workspaces itself. Calling
        // remove_workspace() at the same time races the Shell workspace UI
        // and can leave it holding disposed actors.
        if (Meta.prefs_get_dynamic_workspaces())
            return;

        const workspaceManager = global.workspace_manager;
        const workspaceWindows = workspace.list_windows()
            .filter(metaWindow => !metaWindow.is_on_all_workspaces());
        if (workspaceManager.get_n_workspaces() <= 1 || workspaceWindows.length > 0)
            return;

        workspaceManager.remove_workspace(workspace, global.get_current_time());
    }
}
