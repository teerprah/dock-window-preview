import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import WindowPeek from './effects/windowPeek.js';
import EnrichedPreview from './ui/enrichedPreview.js';
import {getVisibleAppWindows} from './utils/windows.js';

const POPUP_GAP = 12;
const POPUP_MARGIN = 8;
const DEFAULT_PREVIEW_LAYOUT = 'vertical';
const DEFAULT_PREVIEW_WIDTH = 260;
const DEFAULT_PREVIEW_HEIGHT = 160;
const DEFAULT_TITLE_OVERFLOW_MODE = 'truncate';
const DEFAULT_SHOW_CLOSE_BUTTON = false;
const DEFAULT_CLOSE_BUTTON_POSITION = 'right';
const DEFAULT_MIDDLE_CLICK_CLOSE = true;
const DEFAULT_POPUP_FADE_DURATION_MS = 150;
const DEFAULT_ENRICHED_PREVIEW_ENABLED = true;
const DEFAULT_ENRICHED_PREVIEW_SKIP_FOCUSED = false;
const DEFAULT_ENRICHED_PREVIEW_DELAY_MS = 120;
const DEFAULT_ENRICHED_PREVIEW_FADE_DURATION_MS = 240;
const DEFAULT_ENRICHED_PREVIEW_SIZE_PERCENT = 85;
const DEFAULT_PEEK_ENABLED = false;
const HOVER_LEAVE_DELAY_MS = 80;
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
        this._popupFadeDurationMs = DEFAULT_POPUP_FADE_DURATION_MS;
        this._enrichedPreviewEnabled = DEFAULT_ENRICHED_PREVIEW_ENABLED;
        this._enrichedPreviewSkipFocused = DEFAULT_ENRICHED_PREVIEW_SKIP_FOCUSED;
        this._enrichedPreviewDelayMs = DEFAULT_ENRICHED_PREVIEW_DELAY_MS;
        this._enrichedPreviewFadeDurationMs = DEFAULT_ENRICHED_PREVIEW_FADE_DURATION_MS;
        this._enrichedPreviewSizePercent = DEFAULT_ENRICHED_PREVIEW_SIZE_PERCENT;
        this._peekEnabled = DEFAULT_PEEK_ENABLED;
        this._refreshTimeoutId = 0;

        this._enrichedPreview = null;
        this._hoveredItem = null;
        this._hoveredItemTimeoutId = 0;
        this._hoverIdentity = 0;
        this._hoverLeaveTimeoutId = 0;
        this._windowPeek = new WindowPeek();

        this._actor = new St.BoxLayout({
            style_class: 'dock-preview-popup',
            ...boxLayoutOrientation(true),
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
            opacity: 0,
        });

        Main.layoutManager.addTopChrome(this._actor);
    }

    get visible() { return this._actor.visible; }

    updateConfig(config) {
        const layout = config.previewLayout;
        this._previewLayout = layout === 'horizontal' ? 'horizontal' : 'vertical';
        this._previewWidth = clamp(config.previewWidth, 120, 640);
        this._previewHeight = clamp(config.previewHeight, 80, 480);
        this._titleOverflowMode = config.titleOverflowMode === 'wrap' ? 'wrap' : 'truncate';
        this._showCloseButton = config.showCloseButton;
        this._closeButtonPosition = config.closeButtonPosition === 'left' ? 'left' : 'right';
        this._middleClickClose = config.middleClickClose;
        this._popupFadeDurationMs = clamp(config.popupFadeDurationMs, 0, 1000);
        this._enrichedPreviewEnabled = config.enrichedPreviewEnabled;
        this._enrichedPreviewSkipFocused = config.enrichedPreviewSkipFocused;
        this._enrichedPreviewDelayMs = clamp(config.enrichedPreviewDelayMs, 100, 3000);
        this._enrichedPreviewFadeDurationMs = clamp(config.enrichedPreviewFadeDurationMs, 0, 1000);
        this._enrichedPreviewSizePercent = clamp(
            config.enrichedPreviewSizePercent,
            40,
            95
        );
        const peekWasEnabled = this._peekEnabled;
        this._peekEnabled = config.peekEnabled;
        if (peekWasEnabled && !this._peekEnabled)
            this._windowPeek.restore();

        if (this._enrichedPreview)
            this._enrichedPreview.updateConfig(
                this._enrichedPreviewFadeDurationMs,
                this._enrichedPreviewSizePercent
            );
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
        this._cancelItemHover();
        this._hideEnrichedPreview();
        this._windowPeek.restore();
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

        this._actor.visible = true;
        this._positionNearSource();
        this._animateShow();
    }

    hide() {
        this._cancelRefresh();
        this._cancelItemHover();
        this._cancelHoverLeave();
        this._hideEnrichedPreview();
        this._windowPeek.restore();

        this._app = null;
        this._sourceActor = null;

        if (this._actor.visible && this._actor.opacity > 0) {
            this._animateHide(() => {
                this._actor.hide();
                this._clearChildren();
            });
        } else {
            this._actor.hide();
            this._clearChildren();
        }
    }

    destroy() {
        this._cancelRefresh();
        this._cancelItemHover();
        this._cancelHoverLeave();
        this._hideEnrichedPreview(true);
        this._windowPeek.destroy();
        this._windowPeek = null;

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
            reactive: true,
            track_hover: true,
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
            this._connectMiddleClick(button, item, metaWindow);

        item.add_child(button);

        if (this._showCloseButton)
            item.add_child(this._createCloseButtonRow(item, metaWindow));

        if (this._enrichedPreviewEnabled || this._peekEnabled) {
            item.connect('notify::hover', () => {
                if (item.hover)
                    this._onItemHoverEnter(item, metaWindow, app);
                else
                    this._onItemHoverLeave();
            });
        }

        return item;
    }

    _onItemHoverEnter(item, metaWindow, app) {
        if (!this._enrichedPreviewEnabled && !this._peekEnabled)
            return;

        this._cancelItemHover();
        this._cancelHoverLeave();
        this._hoveredItem = item;
        const hoverId = ++this._hoverIdentity;

        if (this._peekEnabled)
            this._windowPeek.show(metaWindow);
        if (!this._enrichedPreviewEnabled)
            return;

        if (this._enrichedPreviewSkipFocused && metaWindow.has_focus()) {
            this._hideEnrichedPreview();
            return;
        }

        const showEnrichedPreview = () => {
            this._hoveredItemTimeoutId = 0;

            if (this._hoverIdentity !== hoverId || this._hoveredItem !== item)
                return GLib.SOURCE_REMOVE;

            if (!this._enrichedPreview) {
                this._enrichedPreview = new EnrichedPreview(
                    this._actor,
                    this._enrichedPreviewFadeDurationMs,
                    this._enrichedPreviewSizePercent
                );
            }

            this._enrichedPreview.show(item, metaWindow, app);
            return GLib.SOURCE_REMOVE;
        };

        if (this._enrichedPreview && this._enrichedPreview.active)
            showEnrichedPreview();
        else
            this._hoveredItemTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this._enrichedPreviewDelayMs,
                showEnrichedPreview
            );
    }

    _onItemHoverLeave() {
        this._cancelItemHover();
        this._scheduleHoverLeave();
    }

    _scheduleHoverLeave() {
        this._cancelHoverLeave();
        this._hoverLeaveTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOVER_LEAVE_DELAY_MS,
            () => {
                this._hoverLeaveTimeoutId = 0;
                if (this._enrichedPreview)
                    this._enrichedPreview.hide();
                this._windowPeek.restore();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelItemHover() {
        if (this._hoveredItemTimeoutId) {
            GLib.source_remove(this._hoveredItemTimeoutId);
            this._hoveredItemTimeoutId = 0;
        }
        this._hoveredItem = null;
        this._hoverIdentity++;
    }

    _cancelHoverLeave() {
        if (this._hoverLeaveTimeoutId) {
            GLib.source_remove(this._hoverLeaveTimeoutId);
            this._hoverLeaveTimeoutId = 0;
        }
    }

    _hideEnrichedPreview(destroy = false) {
        this._cancelHoverLeave();
        if (this._enrichedPreview) {
            this._enrichedPreview.hide();
            if (destroy) {
                this._enrichedPreview.destroy();
                this._enrichedPreview = null;
            }
        }
    }

    _connectMiddleClick(button, item, metaWindow) {
        button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_MIDDLE)
                return Clutter.EVENT_PROPAGATE;
            this._closeWindow(item, metaWindow);
            return Clutter.EVENT_STOP;
        });
    }

    _closeWindow(item, metaWindow) {
        this._animateWindowClose(item);
        metaWindow.delete(global.get_current_time());
        this._queueRefresh();
    }

    _createCloseButtonRow(item, metaWindow) {
        const row = new St.BoxLayout({
            style_class: 'dock-preview-item-controls',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
        });
        const spacer = new St.Widget({x_expand: true});
        const closeButton = this._createCloseButton(item, metaWindow);

        if (this._closeButtonPosition === 'left') {
            row.add_child(closeButton);
            row.add_child(spacer);
        } else {
            row.add_child(spacer);
            row.add_child(closeButton);
        }
        return row;
    }

    _createCloseButton(item, metaWindow) {
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
        closeButton.connect('clicked', () => this._closeWindow(item, metaWindow));
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
            const icon = app.create_icon_texture(72);
            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            thumbnail.add_child(icon);
        }
        return thumbnail;
    }

    _positionNearSource() {
        const monitor =
            Main.layoutManager.findMonitorForActor(this._sourceActor) ??
            Main.layoutManager.primaryMonitor;

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

        x = clamp(x, monitor.x + POPUP_MARGIN, monitor.x + monitor.width - popupWidth - POPUP_MARGIN);
        y = clamp(y, monitor.y + POPUP_MARGIN, monitor.y + monitor.height - popupHeight - POPUP_MARGIN);

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
        item.reactive = false;
        item.can_focus = false;
        item.ease({
            opacity: 0,
            duration: CLOSE_FADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _animateShow() {
        this._actor.remove_all_transitions();
        this._actor.opacity = 0;
        this._actor.ease({
            opacity: 255,
            duration: this._popupFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _animateHide(onComplete) {
        this._actor.remove_all_transitions();
        this._actor.ease({
            opacity: 0,
            duration: this._popupFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete,
        });
    }
}
