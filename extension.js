import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.dock-window-preview';

const HIDE_DELAY_MS = 240;
const POINTER_POLL_MS = 90;
const POPUP_GAP = 12;
const POPUP_MARGIN = 8;

const DEFAULT_HOVER_DELAY_MS = 180;
const DEFAULT_PREVIEW_LAYOUT = 'vertical';
const DEFAULT_PREVIEW_WIDTH = 260;
const DEFAULT_PREVIEW_HEIGHT = 160;
const DEFAULT_TITLE_OVERFLOW_MODE = 'truncate';

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function hasStyleClass(actor, className) {
    if (!actor || typeof actor.get_style_class_name !== 'function')
        return false;

    const style = actor.get_style_class_name();
    return typeof style === 'string' && style.split(/\s+/).includes(className);
}

class WindowPreviewPopup {
    constructor() {
        this._sourceActor = null;
        this._previewLayout = DEFAULT_PREVIEW_LAYOUT;
        this._previewWidth = DEFAULT_PREVIEW_WIDTH;
        this._previewHeight = DEFAULT_PREVIEW_HEIGHT;
        this._titleOverflowMode = DEFAULT_TITLE_OVERFLOW_MODE;

        this._actor = new St.BoxLayout({
            style_class: 'dock-preview-popup',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
        });

        Main.layoutManager.addTopChrome(this._actor, {
            affectsInputRegion: true,
        });
    }

    get visible() {
        return this._actor.visible;
    }

    updateConfig(config) {
        const layout = config.previewLayout;
        this._previewLayout = layout === 'horizontal' ? 'horizontal' : 'vertical';
        this._previewWidth = clamp(config.previewWidth, 120, 640);
        this._previewHeight = clamp(config.previewHeight, 80, 480);
        this._titleOverflowMode = config.titleOverflowMode === 'wrap' ? 'wrap' : 'truncate';
    }

    containsActor(actor) {
        for (let current = actor; current; current = current.get_parent()) {
            if (current === this._actor)
                return true;
        }

        return false;
    }

    show(app, windows, sourceActor) {
        if (!sourceActor || windows.length === 0)
            return;

        this._sourceActor = sourceActor;
        this._clearChildren();

        this._actor.add_child(new St.Label({
            style_class: 'dock-preview-header',
            text: app.get_name(),
            x_align: Clutter.ActorAlign.START,
        }));

        const itemsContainer = new St.BoxLayout({
            style_class: 'dock-preview-items',
            vertical: this._previewLayout !== 'horizontal',
            x_expand: true,
        });
        this._actor.add_child(itemsContainer);

        for (const window of windows)
            itemsContainer.add_child(this._createWindowButton(window, app));

        this._actor.show();
        this._positionNearSource();
    }

    hide() {
        this._sourceActor = null;
        this._actor.hide();
    }

    destroy() {
        this._clearChildren();
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        this._sourceActor = null;
    }

    _clearChildren() {
        for (const child of this._actor.get_children())
            child.destroy();
    }

    _createWindowButton(metaWindow, app) {
        const button = new St.Button({
            style_class: 'dock-preview-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: this._previewLayout !== 'horizontal',
        });

        const layout = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        layout.add_child(this._createThumbnail(metaWindow, app));
        layout.add_child(this._createTitleLabel(metaWindow, app));

        button.set_child(layout);
        button.connect('clicked', () => {
            this.hide();
            Main.activateWindow(metaWindow);
        });

        return button;
    }

    _createTitleLabel(metaWindow, app) {
        const titleLabel = new St.Label({
            style_class: 'dock-preview-title',
            text: metaWindow.get_title() || app.get_name(),
            x_align: Clutter.ActorAlign.START,
            x_expand: false,
        });

        titleLabel.set_width(this._previewWidth);
        titleLabel.set_style(`max-width: ${this._previewWidth}px;`);

        const textActor = titleLabel.clutter_text;
        if (!textActor)
            return titleLabel;

        if (this._titleOverflowMode === 'wrap') {
            textActor.single_line_mode = false;
            textActor.line_wrap = true;
            textActor.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            textActor.ellipsize = Pango.EllipsizeMode.NONE;
        } else {
            textActor.single_line_mode = true;
            textActor.line_wrap = false;
            textActor.ellipsize = Pango.EllipsizeMode.END;
        }

        return titleLabel;
    }

    _createThumbnail(metaWindow, app) {
        const thumbnail = new St.Widget({
            style_class: 'dock-preview-thumb',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        thumbnail.set_size(this._previewWidth, this._previewHeight);

        const windowActor = metaWindow.get_compositor_private();
        if (windowActor) {
            const [sourceWidth, sourceHeight] = windowActor.get_size();
            const width = Math.max(1, sourceWidth);
            const height = Math.max(1, sourceHeight);
            const scale = Math.min(
                this._previewWidth / width,
                this._previewHeight / height,
                1
            );

            thumbnail.add_child(new Clutter.Clone({
                source: windowActor,
                reactive: false,
                width: Math.floor(width * scale),
                height: Math.floor(height * scale),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            let icon = null;
            if (typeof app.create_icon_texture === 'function')
                icon = app.create_icon_texture(72);

            if (!icon) {
                icon = new St.Icon({
                    icon_name: 'application-x-executable-symbolic',
                    icon_size: 72,
                });
            }

            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            thumbnail.add_child(icon);
        }

        return thumbnail;
    }

    _positionNearSource() {
        if (!this._sourceActor)
            return;

        const monitor =
            Main.layoutManager.findMonitorForActor(this._sourceActor) ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const [sourceX, sourceY] = this._sourceActor.get_transformed_position();
        const [sourceWidth, sourceHeight] = this._sourceActor.get_transformed_size();
        const [, , popupWidth, popupHeight] = this._actor.get_preferred_size();

        const sourceCenterX = sourceX + sourceWidth / 2;
        const sourceCenterY = sourceY + sourceHeight / 2;
        const side = this._guessDockSide(monitor, sourceCenterX, sourceCenterY);

        let x = sourceX + (sourceWidth - popupWidth) / 2;
        let y = sourceY - popupHeight - POPUP_GAP;

        if (side === St.Side.LEFT) {
            x = sourceX + sourceWidth + POPUP_GAP;
            y = sourceY + (sourceHeight - popupHeight) / 2;
        } else if (side === St.Side.RIGHT) {
            x = sourceX - popupWidth - POPUP_GAP;
            y = sourceY + (sourceHeight - popupHeight) / 2;
        } else if (side === St.Side.TOP) {
            x = sourceX + (sourceWidth - popupWidth) / 2;
            y = sourceY + sourceHeight + POPUP_GAP;
        }

        x = clamp(
            x,
            monitor.x + POPUP_MARGIN,
            monitor.x + monitor.width - popupWidth - POPUP_MARGIN
        );
        y = clamp(
            y,
            monitor.y + POPUP_MARGIN,
            monitor.y + monitor.height - popupHeight - POPUP_MARGIN
        );

        this._actor.set_position(Math.round(x), Math.round(y));
    }

    _guessDockSide(monitor, centerX, centerY) {
        const distances = [
            [St.Side.LEFT, Math.abs(centerX - monitor.x)],
            [St.Side.RIGHT, Math.abs(centerX - (monitor.x + monitor.width))],
            [St.Side.TOP, Math.abs(centerY - monitor.y)],
            [St.Side.BOTTOM, Math.abs(centerY - (monitor.y + monitor.height))],
        ];

        distances.sort((left, right) => left[1] - right[1]);
        return distances[0][0];
    }
}

class DockHoverTracker {
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

export default class DockWindowPreviewExtension extends Extension {
    enable() {
        try {
            this._settings = this.getSettings(SETTINGS_SCHEMA);
        } catch (error) {
            console.error(`[dock-window-preview] Failed to load settings: ${error}`);
            this._settings = null;
        }

        this._tracker = new DockHoverTracker(this._settings);
        this._tracker.enable();
    }

    disable() {
        if (!this._tracker)
            return;

        this._tracker.destroy();
        this._tracker = null;
        this._settings = null;
    }
}
