import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import WindowPreviewPopup from '../windowPreviewPopup.js';

const HIDE_DELAY_MS = 240;
const POINTER_POLL_MS = 90;
const DEFAULT_HOVER_DELAY_MS = 180;
const DEFAULT_PREVIEW_LAYOUT = 'vertical';
const DEFAULT_PREVIEW_WIDTH = 260;
const DEFAULT_PREVIEW_HEIGHT = 160;
const DEFAULT_TITLE_OVERFLOW_MODE = 'truncate';
const DEFAULT_SHOW_CLOSE_BUTTON = false;
const DEFAULT_CLOSE_BUTTON_POSITION = 'right';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function hasStyleClass(actor, className) {
    if (!actor || typeof actor.get_style_class_name !== 'function')
        return false;

    const style = actor.get_style_class_name();
    return typeof style === 'string' && style.split(/\s+/).includes(className);
}

export default class DockHoverTracker {
    constructor(settings) {
        this._settings = settings;
        this._settingsChangedId = 0;
        this._hoverDelayMs = DEFAULT_HOVER_DELAY_MS;

        this._popup = new WindowPreviewPopup();
        this._hoveredIcon = null;
        this._hoveredIconActor = null;
        this._pollId = 0;
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;

        if (this._settings)
            this._settingsChangedId = this._settings.connect('changed', () => this._syncSettings());

        this._syncSettings();
    }

    enable() {
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
            this._pollPointer();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        this._cancelShow();
        this._cancelHide();

        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }

        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        this._popup.destroy();
        this._popup = null;
        this._hoveredIcon = null;
        this._hoveredIconActor = null;
        this._settings = null;
    }

    _syncSettings() {
        const hoverDelay = this._readIntSetting(
            'hover-delay-ms',
            50,
            5000,
            DEFAULT_HOVER_DELAY_MS
        );
        const previewWidth = this._readIntSetting(
            'preview-width',
            120,
            640,
            DEFAULT_PREVIEW_WIDTH
        );
        const previewHeight = this._readIntSetting(
            'preview-height',
            80,
            480,
            DEFAULT_PREVIEW_HEIGHT
        );

        this._hoverDelayMs = hoverDelay;
        this._popup.updateConfig({
            previewLayout: this._readLayoutSetting(),
            previewWidth,
            previewHeight,
            titleOverflowMode: this._readTitleOverflowSetting(),
            showCloseButton: this._readBooleanSetting(
                'show-close-button',
                DEFAULT_SHOW_CLOSE_BUTTON
            ),
            closeButtonPosition: this._readCloseButtonPositionSetting(),
        });

        this._cancelShow();
        this._cancelHide();
        this._popup.hide();
    }

    _readIntSetting(key, min, max, fallback) {
        if (!this._settings)
            return fallback;

        try {
            return clamp(this._settings.get_int(key), min, max);
        } catch (error) {
            return fallback;
        }
    }

    _readLayoutSetting() {
        if (!this._settings)
            return DEFAULT_PREVIEW_LAYOUT;

        try {
            return this._settings.get_string('preview-layout');
        } catch (error) {
            return DEFAULT_PREVIEW_LAYOUT;
        }
    }

    _readBooleanSetting(key, fallback) {
        if (!this._settings)
            return fallback;

        try {
            return this._settings.get_boolean(key);
        } catch (error) {
            return fallback;
        }
    }

    _readTitleOverflowSetting() {
        if (!this._settings)
            return DEFAULT_TITLE_OVERFLOW_MODE;

        try {
            const value = this._settings.get_string('title-overflow-mode');
            return value === 'wrap' ? 'wrap' : 'truncate';
        } catch (error) {
            return DEFAULT_TITLE_OVERFLOW_MODE;
        }
    }

    _readCloseButtonPositionSetting() {
        if (!this._settings)
            return DEFAULT_CLOSE_BUTTON_POSITION;

        try {
            const value = this._settings.get_string('close-button-position');
            return value === 'left' ? 'left' : 'right';
        } catch (error) {
            return DEFAULT_CLOSE_BUTTON_POSITION;
        }
    }

    _pollPointer() {
        const actor = this._getPointerActor();
        const hoveredIcon = this._findDockIcon(actor);
        const pointerInPopup = this._popup.containsActor(actor);

        if (hoveredIcon) {
            const iconChanged =
                hoveredIcon.icon !== this._hoveredIcon ||
                hoveredIcon.actor !== this._hoveredIconActor;

            this._hoveredIcon = hoveredIcon.icon;
            this._hoveredIconActor = hoveredIcon.actor;
            this._cancelHide();

            if (iconChanged)
                this._scheduleShow(hoveredIcon.icon, hoveredIcon.actor);

            return;
        }

        this._hoveredIcon = null;
        this._hoveredIconActor = null;
        this._cancelShow();

        if (pointerInPopup)
            this._cancelHide();
        else
            this._scheduleHide();
    }

    _getPointerActor() {
        const [x, y] = global.get_pointer();
        return global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
    }

    _findDockIcon(actor) {
        for (let current = actor; current; current = current.get_parent()) {
            const delegate = current._delegate;
            if (!this._isDockAppIcon(delegate))
                continue;

            if (!delegate.app || !this._isInsideDash(current))
                continue;

            return {
                icon: delegate,
                actor: this._getIconActor(delegate, current),
            };
        }

        return null;
    }

    _isDockAppIcon(delegate) {
        if (!delegate || !delegate.app)
            return false;

        const hasWindowSource =
            typeof delegate.getInterestingWindows === 'function' ||
            typeof delegate.app?.get_windows === 'function';

        return hasWindowSource;
    }

    _isInsideDash(actor) {
        for (let current = actor; current; current = current.get_parent()) {
            if (hasStyleClass(current, 'dash-item-container') ||
                hasStyleClass(current, 'dash-item') ||
                hasStyleClass(current, 'dash'))
                return true;
        }

        return false;
    }

    _getIconActor(icon, fallbackActor) {
        if (icon instanceof Clutter.Actor)
            return icon;

        if (icon.actor instanceof Clutter.Actor)
            return icon.actor;

        return fallbackActor;
    }

    _scheduleShow(icon, actor) {
        this._cancelShow();
        this._cancelHide();

        this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hoverDelayMs, () => {
            this._showTimeoutId = 0;

            if (this._hoveredIcon !== icon || this._hoveredIconActor !== actor)
                return GLib.SOURCE_REMOVE;

            const windows = this._getAppWindows(icon);
            if (windows.length === 0) {
                this._popup.hide();
                return GLib.SOURCE_REMOVE;
            }

            this._popup.show(icon.app, windows, actor);
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleHide() {
        if (this._hideTimeoutId || !this._popup.visible)
            return;

        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideTimeoutId = 0;
            this._popup.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelShow() {
        if (!this._showTimeoutId)
            return;

        GLib.source_remove(this._showTimeoutId);
        this._showTimeoutId = 0;
    }

    _cancelHide() {
        if (!this._hideTimeoutId)
            return;

        GLib.source_remove(this._hideTimeoutId);
        this._hideTimeoutId = 0;
    }

    _getAppWindows(icon) {
        let windows = [];
        if (typeof icon.getInterestingWindows === 'function')
            windows = icon.getInterestingWindows();

        if (windows.length === 0 && typeof icon.app?.get_windows === 'function')
            windows = icon.app.get_windows();

        return windows
            .filter(window => {
                if (!window)
                    return false;

                if (typeof window.is_skip_taskbar === 'function')
                    return !window.is_skip_taskbar();

                return !window.skip_taskbar;
            })
            .sort((left, right) => {
                const leftTime = typeof left.get_user_time === 'function'
                    ? left.get_user_time()
                    : 0;
                const rightTime = typeof right.get_user_time === 'function'
                    ? right.get_user_time()
                    : 0;
                return rightTime - leftTime;
            });
    }
}
