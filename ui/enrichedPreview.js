import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SWITCH_DURATION_MS = 180;

export default class EnrichedPreview {
    constructor(mainPopupActor, fadeDurationMs, sizePercent) {
        this._mainPopupActor = mainPopupActor;
        this._fadeDurationMs = fadeDurationMs;
        this._sizePercent = sizePercent;
        this._actor = null;
        this._sourceItem = null;
        this._sourceWindow = null;
        this._sourceApp = null;
        this._requestId = 0;
        this._contentDirty = true;
    }

    get active() {
        return this._actor !== null && this._actor.visible;
    }

    show(sourceItem, metaWindow, app) {
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
            actor.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: Math.min(SWITCH_DURATION_MS, this._fadeDurationMs),
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }

        const swapping = actor.visible && actor.opacity > 50;
        this._replaceContent(swapping);
        this._reveal(requestId, swapping);
    }

    hide() {
        if (!this._actor || !this._actor.visible)
            return;

        const actor = this._actor;
        const requestId = ++this._requestId;
        actor.remove_all_transitions();
        actor.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            duration: this._fadeDurationMs,
            mode: Clutter.AnimationMode.EASE_IN_QUINT,
            onComplete: () => {
                if (this._requestId === requestId)
                    actor.visible = false;
            },
        });
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
        this._mainPopupActor = null;
    }

    updateConfig(fadeDurationMs, sizePercent) {
        if (sizePercent !== this._sizePercent)
            this._contentDirty = true;
        this._fadeDurationMs = fadeDurationMs;
        this._sizePercent = sizePercent;
    }

    _ensureActor() {
        if (this._actor)
            return this._actor;

        this._actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            visible: false,
            opacity: 0,
        });
        Main.layoutManager.addTopChrome(this._actor);

        const parent = this._actor.get_parent();
        if (parent && this._mainPopupActor.get_parent() === parent)
            parent.set_child_below_sibling(this._actor, this._mainPopupActor);

        return this._actor;
    }

    _replaceContent(crossfade) {
        const oldContents = this._actor.get_children();
        const newContent = this._createContent();
        newContent.opacity = crossfade ? 0 : 255;
        this._actor.set_size(newContent.width, newContent.height);
        this._actor.add_child(newContent);

        if (!crossfade) {
            for (const oldContent of oldContents)
                oldContent.destroy();
            this._contentDirty = false;
            return;
        }

        const duration = Math.min(SWITCH_DURATION_MS, this._fadeDurationMs);
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
        this._contentDirty = false;
    }

    _reveal(requestId, swapping) {
        const actor = this._actor;
        actor.visible = true;
        const position = this._positionOnMonitor();
        const startScale = swapping ? 0.98 : 0.94;

        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(startScale, startScale);
        actor.y = position.y + (swapping ? 6 : 22);
        if (!swapping)
            actor.opacity = 0;

        actor.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            y: position.y,
            duration: swapping
                ? Math.min(SWITCH_DURATION_MS, this._fadeDurationMs)
                : this._fadeDurationMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => {
                if (this._requestId !== requestId)
                    return;
                actor.set_scale(1, 1);
            },
        });
    }

    _createContent() {
        const monitor = Main.layoutManager.findMonitorForActor(this._sourceItem) ??
            Main.layoutManager.primaryMonitor;
        const frame = this._sourceWindow.get_frame_rect();
        const sourceWidth = Math.max(1, frame.width);
        const sourceHeight = Math.max(1, frame.height);
        const ratio = this._sizePercent / 100;
        const scale = Math.min(
            monitor.width * ratio / sourceWidth,
            monitor.height * ratio / sourceHeight,
            1
        );
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const windowActor = this._sourceWindow.get_compositor_private();
        const child = windowActor
            ? new Clutter.Clone({
                source: windowActor,
                reactive: false,
                width,
                height,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            })
            : this._sourceApp.create_icon_texture(96);

        child.x_align = Clutter.ActorAlign.CENTER;
        child.y_align = Clutter.ActorAlign.CENTER;

        return new St.Bin({
            style_class: 'dock-enriched-preview',
            reactive: false,
            child,
            width,
            height,
        });
    }

    _positionOnMonitor() {
        const monitor = Main.layoutManager.findMonitorForActor(this._sourceItem) ??
            Main.layoutManager.primaryMonitor;
        const [, , width, height] = this._actor.get_preferred_size();
        const position = {
            x: Math.round(monitor.x + (monitor.width - width) / 2),
            y: Math.round(monitor.y + (monitor.height - height) / 2),
        };
        this._actor.set_position(position.x, position.y);
        return position;
    }
}
