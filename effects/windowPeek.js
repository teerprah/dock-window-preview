import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

const PEEKED_OPACITY = 32;
const FADE_DURATION_MS = 160;
const RESTORE_DURATION_MS = 120;

export default class WindowPeek {
    constructor() {
        this._originalOpacities = new Map();
        this._clearTimeoutId = 0;
    }

    show(metaWindow) {
        this._cancelClear();

        for (const windowActor of global.get_window_actors()) {
            if (!this._originalOpacities.has(windowActor))
                this._originalOpacities.set(windowActor, windowActor.opacity);

            const opacity = windowActor.get_meta_window() === metaWindow
                ? this._originalOpacities.get(windowActor)
                : PEEKED_OPACITY;
            windowActor.ease({
                opacity,
                duration: FADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
        }
    }

    restore(immediate = false) {
        this._cancelClear();
        if (this._originalOpacities.size === 0)
            return;

        const activeActors = new Set(global.get_window_actors());
        const duration = immediate ? 0 : RESTORE_DURATION_MS;
        for (const [windowActor, opacity] of this._originalOpacities) {
            if (!activeActors.has(windowActor))
                continue;

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
        }

        if (immediate) {
            this._originalOpacities.clear();
            return;
        }

        this._clearTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            duration + 32,
            () => {
                this._clearTimeoutId = 0;
                this._originalOpacities.clear();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    destroy() {
        this.restore(true);
    }

    _cancelClear() {
        if (!this._clearTimeoutId)
            return;
        GLib.source_remove(this._clearTimeoutId);
        this._clearTimeoutId = 0;
    }
}
