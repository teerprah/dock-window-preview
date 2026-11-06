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
const DEFAULT_POPUP_FADE_DURATION_MS = 150;
const DEFAULT_ENRICHED_PREVIEW_ENABLED = true;
const DEFAULT_ENRICHED_PREVIEW_DELAY_MS = 120;
const DEFAULT_ENRICHED_PREVIEW_FADE_DURATION_MS = 240;
const DEFAULT_ENRICHED_PREVIEW_SIZE_PERCENT = 85;
const DEFAULT_PEEK_ENABLED = false;
const HOVER_LEAVE_DELAY_MS = 80;
const PEEKED_WINDOW_OPACITY = 32;
const PEEK_FADE_DURATION_MS = 160;
const PEEK_RESTORE_DURATION_MS = 120;
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

class EnrichedPreview {
    constructor(config) {
        this._config = config;
        this._actor = null;
        this._sourceItem = null;
        this._sourceWindow = null;
        this._sourceApp = null;
        this._isVisible = false;
        this._isAnimating = false;
        this._requestId = 0;
        this._contentDirty = true;
    }

    get actor() { return this._actor; }
    get visible() { return this._isVisible; }
    get active() { return Boolean(this._actor?.visible); }

    show(sourceItem, metaWindow, app) {
        if (!sourceItem || !metaWindow || !app)
            return;

        const sameWindow = this._sourceWindow === metaWindow;
        this._sourceItem = sourceItem;
        this._sourceWindow = metaWindow;
        this._sourceApp = app;
        const requestId = ++this._requestId;
        const actor = this._ensureActor();
        actor.remove_all_transitions();

        if (sameWindow && actor.get_children().length > 0 && !this._contentDirty) {
            actor.visible = true;
            this._positionOnMonitor();
            this._isAnimating = true;
            actor.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: Math.min(180, this._config.enrichedPreviewFadeDurationMs),
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._requestId !== requestId || this._actor !== actor)
                        return;
                    this._isAnimating = false;
                    this._isVisible = true;
                },
            });
            return;
        }

        if (actor.visible && actor.opacity > 50) {
            this._replaceContent(true);
            this._reveal(requestId, true);
        } else {
            this._replaceContent();
            this._reveal(requestId, false);
        }
    }

    hide() {
        if (!this._actor?.visible)
            return;
        this._requestId++;
        this._animateHide();
    }

    destroy() {
        this._requestId++;
        if (this._actor) {
            this._actor.remove_all_transitions();
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
        this._sourceItem = null;
        this._sourceWindow = null;
        this._sourceApp = null;
        this._isVisible = false;
        this._isAnimating = false;
    }

    containsActor(actor) {
        if (!this._actor)
            return false;
        for (let current = actor; current; current = current.get_parent()) {
            if (current === this._actor)
                return true;
        }
        return false;
    }

    updateConfig(config) {
        if (config.enrichedPreviewSizePercent !== undefined &&
            config.enrichedPreviewSizePercent !== this._config.enrichedPreviewSizePercent)
            this._contentDirty = true;
        this._config = {...this._config, ...config};
    }

    _ensureActor() {
        if (this._actor)
            return this._actor;

        const actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            visible: false,
            opacity: 0,
        });
        this._actor = actor;

        Main.layoutManager.addTopChrome(actor);
        const sibling = this._config.mainPopupActor;
        const parent = actor.get_parent();
        if (parent && sibling?.get_parent() === parent)
            parent.set_child_below_sibling(actor, sibling);
        return actor;
    }

    _replaceContent(crossfade = false) {
        const oldContents = this._actor.get_children();
        const newContent = this._createEnrichedPreview();
        newContent.opacity = crossfade ? 0 : 255;
        this._actor.set_size(newContent.width, newContent.height);
        this._actor.add_child(newContent);

        if (crossfade) {
            const duration = Math.min(
                180,
                this._config.enrichedPreviewFadeDurationMs
            );
            for (const oldContent of oldContents) {
                oldContent.remove_all_transitions();
                oldContent.ease({
                    opacity: 0,
                    duration: Math.min(110, duration),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => oldContent.destroy(),
                });
            }
            newContent.ease({
                opacity: 255,
                duration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            for (const oldContent of oldContents)
                oldContent.destroy();
        }
        this._contentDirty = false;
    }

    _reveal(requestId, swapping) {
        const actor = this._actor;
        actor.visible = true;
        const targetPosition = this._positionOnMonitor();

        this._isAnimating = true;
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(swapping ? 0.98 : 0.94, swapping ? 0.98 : 0.94);
        if (!swapping)
            actor.opacity = 0;
        if (targetPosition)
            actor.y = targetPosition.y + (swapping ? 6 : 22);
        actor.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            ...(targetPosition ? {y: targetPosition.y} : {}),
            duration: swapping
                ? Math.min(180, this._config.enrichedPreviewFadeDurationMs)
                : this._config.enrichedPreviewFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => {
                if (this._requestId !== requestId || this._actor !== actor)
                    return;
                this._isAnimating = false;
                this._isVisible = true;
            },
        });
    }

    _animateHide() {
        if (!this._actor)
            return;

        const actor = this._actor;
        const requestId = this._requestId;
        actor.remove_all_transitions();
        this._isAnimating = true;
        this._isVisible = false;

        actor.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            duration: this._config.enrichedPreviewFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_IN_QUINT,
            onComplete: () => {
                if (this._requestId !== requestId || this._actor !== actor)
                    return;
                this._isAnimating = false;
                actor.visible = false;
            },
        });
    }

    _createEnrichedPreview() {
        const monitor =
            Main.layoutManager.findMonitorForActor(this._sourceItem) ??
            Main.layoutManager.primaryMonitor;
        const frame = this._sourceWindow.get_frame_rect();
        const sourceWidth = Math.max(1, frame.width);
        const sourceHeight = Math.max(1, frame.height);
        const sizeRatio = this._config.enrichedPreviewSizePercent / 100;
        const maxWidth = Math.max(1, monitor.width * sizeRatio);
        const maxHeight = Math.max(1, monitor.height * sizeRatio);
        const previewScale = Math.min(
            maxWidth / sourceWidth,
            maxHeight / sourceHeight,
            1
        );
        const previewWidth = Math.max(1, Math.round(sourceWidth * previewScale));
        const previewHeight = Math.max(1, Math.round(sourceHeight * previewScale));

        const windowActor = this._sourceWindow.get_compositor_private();
        let content;
        if (windowActor) {
            content = new Clutter.Clone({
                source: windowActor,
                reactive: false,
                width: previewWidth,
                height: previewHeight,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
        } else {
            if (typeof this._sourceApp.create_icon_texture === 'function')
                content = this._sourceApp.create_icon_texture(96);
            if (!content) {
                content = new St.Icon({
                    icon_name: 'application-x-executable-symbolic',
                    icon_size: 96,
                });
            }
            content.x_align = Clutter.ActorAlign.CENTER;
            content.y_align = Clutter.ActorAlign.CENTER;
        }

        return new St.Bin({
            style_class: 'dock-enriched-preview',
            reactive: false,
            child: content,
            width: previewWidth,
            height: previewHeight,
        });
    }

    _positionOnMonitor() {
        if (!this._actor || !this._sourceItem)
            return null;

        const monitor =
            Main.layoutManager.findMonitorForActor(this._sourceItem) ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;

        const [, , popupWidth, popupHeight] = this._actor.get_preferred_size();
        const x = monitor.x + (monitor.width - popupWidth) / 2;
        const y = monitor.y + (monitor.height - popupHeight) / 2;
        const position = {x: Math.round(x), y: Math.round(y)};

        this._actor.set_position(position.x, position.y);
        return position;
    }
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
        this._peekedWindows = new Map();
        this._peekRestoreTimeoutId = 0;

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
        this._showCloseButton = config.showCloseButton ?? DEFAULT_SHOW_CLOSE_BUTTON;
        this._closeButtonPosition = config.closeButtonPosition === 'left' ? 'left' : 'right';
        this._middleClickClose = config.middleClickClose ?? DEFAULT_MIDDLE_CLICK_CLOSE;
        this._popupFadeDurationMs = clamp(config.popupFadeDurationMs ?? DEFAULT_POPUP_FADE_DURATION_MS, 0, 1000);
        this._enrichedPreviewEnabled = config.enrichedPreviewEnabled ?? DEFAULT_ENRICHED_PREVIEW_ENABLED;
        this._enrichedPreviewDelayMs = clamp(config.enrichedPreviewDelayMs ?? DEFAULT_ENRICHED_PREVIEW_DELAY_MS, 100, 3000);
        this._enrichedPreviewFadeDurationMs = clamp(config.enrichedPreviewFadeDurationMs ?? DEFAULT_ENRICHED_PREVIEW_FADE_DURATION_MS, 0, 1000);
        this._enrichedPreviewSizePercent = clamp(
            config.enrichedPreviewSizePercent ?? DEFAULT_ENRICHED_PREVIEW_SIZE_PERCENT,
            40,
            95
        );
        const peekWasEnabled = this._peekEnabled;
        this._peekEnabled = config.peekEnabled ?? DEFAULT_PEEK_ENABLED;
        if (peekWasEnabled && !this._peekEnabled)
            this._restorePeek();

        if (this._enrichedPreview) {
            this._enrichedPreview.updateConfig({
                enrichedPreviewFadeDurationMs: this._enrichedPreviewFadeDurationMs,
                enrichedPreviewSizePercent: this._enrichedPreviewSizePercent,
            });
        }
    }

    containsActor(actor) {
        if (!this._actor)
            return false;
        for (let current = actor; current; current = current.get_parent()) {
            if (current === this._actor)
                return true;
        }
        if (this._enrichedPreview && this._enrichedPreview.containsActor(actor))
            return true;
        return false;
    }

    show(app, windows, sourceActor) {
        if (!sourceActor || windows.length === 0)
            return;

        this._app = app;
        this._sourceActor = sourceActor;
        this._clearChildren();
        this._hideEnrichedPreview();
        this._restorePeek();

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
        this._restorePeek();

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
        this._restorePeek(true);

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
            this._connectMiddleClick(button, item, metaWindow, app);

        item.add_child(button);

        if (this._showCloseButton)
            item.add_child(this._createCloseButtonRow(item, metaWindow, app));

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
            this._showPeek(metaWindow);
        if (!this._enrichedPreviewEnabled)
            return;

        const showEnrichedPreview = () => {
            this._hoveredItemTimeoutId = 0;

            if (this._hoverIdentity !== hoverId || this._hoveredItem !== item)
                return GLib.SOURCE_REMOVE;

            if (!this._enrichedPreview) {
                this._enrichedPreview = new EnrichedPreview({
                    enrichedPreviewFadeDurationMs: this._enrichedPreviewFadeDurationMs,
                    enrichedPreviewSizePercent: this._enrichedPreviewSizePercent,
                    mainPopupActor: this._actor,
                });
            }

            this._enrichedPreview.show(item, metaWindow, app);
            return GLib.SOURCE_REMOVE;
        };

        if (this._enrichedPreview?.active)
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
                this._enrichedPreview?.hide();
                this._restorePeek();
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

    _showPeek(metaWindow) {
        if (this._peekRestoreTimeoutId) {
            GLib.source_remove(this._peekRestoreTimeoutId);
            this._peekRestoreTimeoutId = 0;
        }

        for (const windowActor of global.get_window_actors()) {
            try {
                const actorWindow = windowActor.get_meta_window();
                if (!actorWindow)
                    continue;
                if (!this._peekedWindows.has(windowActor))
                    this._peekedWindows.set(windowActor, windowActor.opacity);

                const originalOpacity = this._peekedWindows.get(windowActor);
                windowActor.ease({
                    opacity: actorWindow === metaWindow
                        ? originalOpacity
                        : PEEKED_WINDOW_OPACITY,
                    duration: PEEK_FADE_DURATION_MS,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                });
            } catch (error) {
                this._peekedWindows.delete(windowActor);
            }
        }
    }

    _restorePeek(immediate = false) {
        if (this._peekRestoreTimeoutId) {
            GLib.source_remove(this._peekRestoreTimeoutId);
            this._peekRestoreTimeoutId = 0;
        }
        if (this._peekedWindows.size === 0)
            return;

        const duration = immediate ? 0 : PEEK_RESTORE_DURATION_MS;
        for (const [windowActor, opacity] of this._peekedWindows) {
            try {
                if (immediate) {
                    windowActor.remove_transition('opacity');
                    windowActor.opacity = opacity;
                } else {
                    windowActor.ease({
                        opacity,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_SINE,
                    });
                }
            } catch (error) {
                this._peekedWindows.delete(windowActor);
            }
        }

        if (immediate) {
            this._peekedWindows.clear();
            return;
        }

        this._peekRestoreTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            duration + 32,
            () => {
                this._peekRestoreTimeoutId = 0;
                this._peekedWindows.clear();
                return GLib.SOURCE_REMOVE;
            }
        );
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
        closeButton.connect('clicked', () => this._closeWindow(item, metaWindow, app));
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

    _animateShow() {
        if (!this._actor)
            return;
        this._actor.remove_all_transitions();
        this._actor.opacity = 0;
        this._actor.ease({
            opacity: 255,
            duration: this._popupFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _animateHide(onComplete) {
        if (!this._actor)
            return;
        this._actor.remove_all_transitions();
        this._actor.ease({
            opacity: 0,
            duration: this._popupFadeDurationMs,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (onComplete)
                    onComplete();
            }
        });
    }
}
