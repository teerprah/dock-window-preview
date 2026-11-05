import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POPUP_GAP = 12;
const POPUP_MARGIN = 8;
const DEFAULT_PREVIEW_LAYOUT = 'vertical';
const DEFAULT_PREVIEW_WIDTH = 260;
const DEFAULT_PREVIEW_HEIGHT = 160;
const DEFAULT_TITLE_OVERFLOW_MODE = 'truncate';
const DEFAULT_SHOW_CLOSE_BUTTON = false;
const DEFAULT_CLOSE_BUTTON_POSITION = 'right';
const DEFAULT_MIDDLE_CLICK_CLOSE = true;
const CLOSE_FADE_DURATION_MS = 180;
const CLOSE_REFRESH_DELAY_MS = 220;

const BOX_LAYOUT_HAS_ORIENTATION =
    St.BoxLayout.find_property('orientation') !== null;

function boxLayoutOrientation(vertical) {
    if (BOX_LAYOUT_HAS_ORIENTATION) {
        return {
            orientation: vertical
                ? Clutter.Orientation.VERTICAL
                : Clutter.Orientation.HORIZONTAL,
        };
    }

    return {vertical};
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

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

export default class WindowPreviewPopup {
    constructor() {
        this._sourceActor = null;
        this._app = null;
        this._previewLayout = DEFAULT_PREVIEW_LAYOUT;
        this._previewWidth = DEFAULT_PREVIEW_WIDTH;
        this._previewHeight = DEFAULT_PREVIEW_HEIGHT;
        this._titleOverflowMode = DEFAULT_TITLE_OVERFLOW_MODE;
        this._showCloseButton = DEFAULT_SHOW_CLOSE_BUTTON;
        this._closeButtonPosition = DEFAULT_CLOSE_BUTTON_POSITION;
        this._middleClickClose = DEFAULT_MIDDLE_CLICK_CLOSE;
        this._refreshTimeoutId = 0;

        this._actor = new St.BoxLayout({
            style_class: 'dock-preview-popup',
            ...boxLayoutOrientation(true),
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
        });

        Main.layoutManager.addTopChrome(this._actor);
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
        this._showCloseButton = config.showCloseButton ?? DEFAULT_SHOW_CLOSE_BUTTON;
        this._closeButtonPosition = config.closeButtonPosition === 'left' ? 'left' : 'right';
        this._middleClickClose = config.middleClickClose ?? DEFAULT_MIDDLE_CLICK_CLOSE;
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

        this._app = app;
        this._sourceActor = sourceActor;
        this._clearChildren();

        this._actor.add_child(new St.Label({
            style_class: 'dock-preview-header',
            text: app.get_name(),
            x_align: Clutter.ActorAlign.START,
        }));

        const itemsContainer = new St.BoxLayout({
            style_class: 'dock-preview-items',
            ...boxLayoutOrientation(this._previewLayout !== 'horizontal'),
            x_expand: true,
        });
        this._actor.add_child(itemsContainer);

        for (const window of windows)
            itemsContainer.add_child(this._createWindowButton(window, app));

        this._actor.show();
        this._positionNearSource();
    }

    hide() {
        this._cancelRefresh();
        this._app = null;
        this._sourceActor = null;
        this._actor.hide();
    }

    destroy() {
        this._cancelRefresh();
        this._clearChildren();
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        this._actor = null;
        this._app = null;
        this._sourceActor = null;
    }

    _clearChildren() {
        for (const child of this._actor.get_children())
            child.destroy();
    }

    _createWindowButton(metaWindow, app) {
        const item = new St.Widget({
            style_class: 'dock-preview-item-frame',
            layout_manager: new Clutter.BinLayout(),
            x_expand: this._previewLayout !== 'horizontal',
        });

        const button = new St.Button({
            style_class: 'dock-preview-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: this._previewLayout !== 'horizontal',
            y_expand: true,
        });

        const layout = new St.BoxLayout({
            ...boxLayoutOrientation(true),
            x_expand: true,
        });

        layout.add_child(this._createThumbnail(metaWindow, app));
        layout.add_child(this._createTitleLabel(metaWindow, app));

        button.set_child(layout);
        button.connect('clicked', () => {
            this.hide();
            Main.activateWindow(metaWindow);
        });

        if (this._middleClickClose)
            this._connectMiddleClick(button, item, metaWindow, app);

        item.add_child(button);

        if (this._showCloseButton)
            item.add_child(this._createCloseButtonRow(item, metaWindow, app));

        return item;
    }

    _connectMiddleClick(button, item, metaWindow, app) {
        button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_MIDDLE)
                return Clutter.EVENT_PROPAGATE;

            this._closeWindow(item, metaWindow, app);
            return Clutter.EVENT_STOP;
        });
    }

    _closeWindow(item, metaWindow, app) {
        this._animateWindowClose(item);

        if (typeof metaWindow.delete === 'function')
            metaWindow.delete(global.get_current_time());
        else if (typeof app.request_quit === 'function')
            app.request_quit();

        this._queueRefresh();
    }

    _createCloseButtonRow(item, metaWindow, app) {
        const row = new St.BoxLayout({
            style_class: 'dock-preview-item-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
        });
        const spacer = new St.Widget({x_expand: true});
        const closeButton = this._createCloseButton(item, metaWindow, app);

        if (this._closeButtonPosition === 'left') {
            row.add_child(closeButton);
            row.add_child(spacer);
        } else {
            row.add_child(spacer);
            row.add_child(closeButton);
        }

        return row;
    }

    _createCloseButton(item, metaWindow, app) {
        const closeIcon = new St.Icon({
            icon_name: 'window-close-symbolic',
            style_class: 'dock-preview-close-icon',
        });
        const closeButton = new St.Button({
            style_class: 'dock-preview-close-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        closeButton.set_child(closeIcon);
        closeButton.connect('clicked', () =>
            this._closeWindow(item, metaWindow, app));

        return closeButton;
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

    _queueRefresh() {
        if (this._refreshTimeoutId)
            return;

        this._refreshTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            CLOSE_REFRESH_DELAY_MS,
            () => {
                this._refreshTimeoutId = 0;

                if (!this._app || !this._sourceActor)
                    return GLib.SOURCE_REMOVE;

                const windows = getVisibleAppWindows(this._app);
                if (windows.length === 0) {
                    this.hide();
                    return GLib.SOURCE_REMOVE;
                }

                this.show(this._app, windows, this._sourceActor);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelRefresh() {
        if (!this._refreshTimeoutId)
            return;

        GLib.source_remove(this._refreshTimeoutId);
        this._refreshTimeoutId = 0;
    }

    _animateWindowClose(item) {
        if (!item)
            return;

        item.reactive = false;
        item.can_focus = false;
        item.ease({
            opacity: 0,
            duration: CLOSE_FADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
}
