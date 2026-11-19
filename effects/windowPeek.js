import Clutter from 'gi://Clutter';

const PEEKED_OPACITY = 32;
const FADE_DURATION_MS = 160;
const RESTORE_DURATION_MS = 120;

export default class WindowPeek {
    constructor() {
        this._originalOpacities = new Map();
        this._destroySignals = new Map();
        this._generation = 0;
    }

    get active() {
        return this._originalOpacities.size > 0;
    }

    show(metaWindow) {
        // Invalidate restore callbacks before replacing their transitions.
        this._generation++;

        for (const windowActor of global.get_window_actors()) {
            if (!this._originalOpacities.has(windowActor)) {
                this._originalOpacities.set(windowActor, windowActor.opacity);
                this._destroySignals.set(windowActor, windowActor.connect(
                    'destroy', () => this._forgetActor(windowActor)
                ));
            }

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
        const generation = ++this._generation;
        if (this._originalOpacities.size === 0)
            return;

        const activeActors = new Set(global.get_window_actors());
        for (const [windowActor, opacity] of [...this._originalOpacities]) {
            if (!activeActors.has(windowActor)) {
                this._forgetActor(windowActor);
                continue;
            }

            if (immediate) {
                windowActor.remove_transition('opacity');
                windowActor.opacity = opacity;
                this._forgetActor(windowActor);
            } else {
                windowActor.ease({
                    opacity,
                    duration: RESTORE_DURATION_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_SINE,
                    onStopped: finished => {
                        // Cancellation retains the original value for a retry.
                        if (finished && this._generation === generation)
                            this._forgetActor(windowActor);
                    },
                });
            }
        }
    }

    destroy() {
        this.restore(true);
    }

    _forgetActor(windowActor) {
        const signalId = this._destroySignals.get(windowActor);
        if (signalId)
            windowActor.disconnect(signalId);
        this._destroySignals.delete(windowActor);
        this._originalOpacities.delete(windowActor);
    }
}
