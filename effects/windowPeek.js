import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_EFFECT_NAME = 'window-peek-full-blur';
const BLUR_RADIUS = 30;
const BLUR_BRIGHTNESS = 0.85;
const PEEKED_OPACITY = 255;
const FADE_DURATION_MS = 160;
const RESTORE_DURATION_MS = 120;

export default class WindowPeek {
    constructor() {
        this._originalOpacities = new Map();
        this._blurredActors = new Set();
        this._raisedActor = null;
        this._originalNextSibling = null;
        this._clearTimeoutId = 0;
    }

    show(metaWindow) {
        this._cancelClear();
        this._restoreStacking();

        if (Main.layoutManager?._backgroundGroup)
            this._applyBlur(Main.layoutManager._backgroundGroup);

        let targetActor = null;

        for (const windowActor of global.get_window_actors()) {
            const actorMetaWindow = windowActor.get_meta_window();

            if (!this._originalOpacities.has(windowActor))
                this._originalOpacities.set(windowActor, windowActor.opacity);

            const isTarget = actorMetaWindow === metaWindow;
            const opacity = isTarget
                ? this._originalOpacities.get(windowActor)
                : PEEKED_OPACITY;

            windowActor.ease({
                opacity,
                duration: FADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });

            if (isTarget) {
                targetActor = windowActor;
                this._removeBlur(windowActor);
            } else {
                this._applyBlur(windowActor);
            }
        }

        if (targetActor)
            this._raiseActor(targetActor);
    }

    commitSelection() {
        this._raisedActor = null;
        this._originalNextSibling = null;
    }

    restore(immediate = false) {
        this._cancelClear();
        this._clearAllBlurs();
        this._restoreStacking();

        if (this._originalOpacities.size === 0)
            return;

        for (const [windowActor, originalOpacity] of this._originalOpacities.entries()) {
            try {
                if (immediate) {
                    windowActor.remove_all_transitions();
                    windowActor.opacity = originalOpacity;
                } else {
                    windowActor.ease({
                        opacity: originalOpacity,
                        duration: RESTORE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                    });
                }
            } catch (_e) {
            }
        }

        this._originalOpacities.clear();
    }

    scheduleRestore(delayMs) {
        this._cancelClear();
        this._clearTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._clearTimeoutId = 0;
            this.restore(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.restore(true);
    }

    _raiseActor(windowActor) {
        const parent = windowActor.get_parent();
        if (!parent)
            return;

        this._raisedActor = windowActor;
        this._originalNextSibling = windowActor.get_next_sibling();
        parent.set_child_above_sibling(windowActor, null);
    }

    _restoreStacking() {
        if (!this._raisedActor)
            return;

        const activeActors = new Set(global.get_window_actors());
        if (activeActors.has(this._raisedActor)) {
            const parent = this._raisedActor.get_parent();
            if (parent && this._originalNextSibling && this._originalNextSibling.get_parent() === parent)
                parent.set_child_below_sibling(this._raisedActor, this._originalNextSibling);
        }

        this._raisedActor = null;
        this._originalNextSibling = null;
    }

    _applyBlur(actor) {
        if (!actor || this._blurredActors.has(actor))
            return;

        if (!actor.get_effect(BLUR_EFFECT_NAME)) {
            const blurEffect = new Shell.BlurEffect({
                radius: BLUR_RADIUS,
                brightness: BLUR_BRIGHTNESS,
            });
            actor.add_effect_with_name(BLUR_EFFECT_NAME, blurEffect);
        }
        this._blurredActors.add(actor);
    }

    _removeBlur(actor) {
        if (!actor)
            return;
        if (actor.get_effect(BLUR_EFFECT_NAME))
            actor.remove_effect_by_name(BLUR_EFFECT_NAME);
        this._blurredActors.delete(actor);
    }

    _clearAllBlurs() {
        for (const actor of this._blurredActors) {
            try {
                if (actor.get_effect(BLUR_EFFECT_NAME))
                    actor.remove_effect_by_name(BLUR_EFFECT_NAME);
            } catch (_e) {
            }
        }
        this._blurredActors.clear();
    }

    _cancelClear() {
        if (!this._clearTimeoutId)
            return;
        GLib.Source.remove(this._clearTimeoutId);
        this._clearTimeoutId = 0;
    }
}
