import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import WindowPreviewPopup from '../windowPreviewPopup.js';
import {filterVisibleWindows} from '../utils/windows.js';

const HIDE_DELAY_MS = 240;
const POINTER_POLL_MS = 90;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function hasStyleClass(actor, className) {
    const style = actor.get_style_class_name();
    return typeof style === 'string' && style.split(/\s+/).includes(className);
}

export default class DockHoverTracker {
    constructor(settings) {
        this._settings = settings;
        this._settingsChangedId = 0;

        this._popup = new WindowPreviewPopup();
        this._hoveredIcon = null;
        this._hoveredIconActor = null;
        this._pollId = 0;
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;

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

        if (this._settingsChangedId) {
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
        this._hoverDelayMs = clamp(this._settings.get_int('hover-delay-ms'), 50, 5000);
        this._popup.updateConfig({
            previewLayout: this._settings.get_string('preview-layout'),
            previewWidth: this._settings.get_int('preview-width'),
            previewHeight: this._settings.get_int('preview-height'),
            titleOverflowMode: this._settings.get_string('title-overflow-mode'),
            showCloseButton: this._settings.get_boolean('show-close-button'),
            closeButtonPosition: this._settings.get_string('close-button-position'),
            middleClickClose: this._settings.get_boolean('middle-click-close'),
        });

        this._cancelShow();
        this._cancelHide();
        this._popup.hide();
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
        return Boolean(delegate && delegate.app);
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

        if (windows.length === 0)
            windows = icon.app.get_windows();

        return filterVisibleWindows(windows)
            .sort((left, right) => right.get_user_time() - left.get_user_time());
    }
}
