const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

// Load production GJS modules without a desktop session. Transitions remain
// pending until finish() or cancellation, including synchronous onStopped calls.
module.exports = async function createShell() {
    class Signals {
        constructor() {
            this.signals = new Map();
            this.nextSignal = 1;
        }

        connect(name, callback) {
            const id = this.nextSignal++;
            this.signals.set(id, {name, callback});
            return id;
        }

        disconnect(id) { assert.ok(this.signals.delete(id)); }

        emit(name) {
            for (const {name: signal, callback} of [...this.signals.values()]) {
                if (signal === name)
                    callback(this);
            }
        }
    }

    class Actor extends Signals {
        static find_property() { return {}; }

        constructor({child, ...properties} = {}) {
            super();
            Object.assign(this, {visible: true, opacity: 255}, properties);
            this.children = [];
            this.clutter_text = {};
            this.animation = null;
            if (child)
                this.add_child(child);
        }

        add_child(child) { this.children.push(child); child.parent = this; }
        set_child(child) { this.add_child(child); }
        get_children() { return [...this.children]; }
        get_parent() { return this.parent ?? null; }
        get_size() { return [1000, 700]; }
        get_transformed_position() { return [500, 1000]; }
        get_transformed_size() { return [48, 48]; }
        get_preferred_size() { return [0, 0, this.width ?? 260, this.height ?? 300]; }
        set_position(x, y) { Object.assign(this, {x, y}); }
        set_size(width, height) { Object.assign(this, {width, height}); }
        set_width(width) { this.width = width; }
        set_scale(scale_x, scale_y) { Object.assign(this, {scale_x, scale_y}); }
        set_style() {}
        set_pivot_point() {}
        set_child_below_sibling() {}

        setHover(hover) {
            if (this.hover === hover)
                return;
            this.hover = hover;
            this.emit('notify::hover');
        }

        hide() {
            this.visible = false;
            for (const child of this.children)
                child.hide();
            if (this.track_hover && this.hover)
                this.setHover(false);
        }

        ease({duration, mode, onStopped, onComplete, ...values}) {
            this.remove_all_transitions();
            const animation = {duration, values, onStopped, onComplete};
            this.animation = animation;
            if (duration === 0 || Object.entries(values).every(([key, value]) => this[key] === value))
                this.finish();
        }

        finish() {
            const animation = this.animation;
            if (!animation)
                return;
            this.animation = null;
            Object.assign(this, animation.values);
            animation.onStopped?.(true);
            animation.onComplete?.();
        }

        remove_all_transitions() {
            const animation = this.animation;
            this.animation = null;
            animation?.onStopped?.(false);
        }

        remove_transition() { this.remove_all_transitions(); }

        destroy() {
            this.hide(); // St unmapping clears hover before disposal.
            this.remove_all_transitions();
            for (const child of this.get_children())
                child.destroy();
            this.emit('destroy');
            this.signals.clear();
            if (this.parent)
                this.parent.children = this.parent.children.filter(child => child !== this);
            this.destroyed = true;
        }
    }

    let nextTimer = 1;
    const timers = new Map();
    const GLib = {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        timeout_add(_priority, delay, callback) {
            const id = nextTimer++;
            timers.set(id, {delay, callback});
            return id;
        },
        Source: {remove: id => assert.ok(timers.delete(id))},
    };
    const chrome = new Actor();
    const layoutManager = {
        primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080},
        findMonitorForActor: () => null,
        addTopChrome: actor => chrome.add_child(actor),
        removeChrome(actor) {
            chrome.children = chrome.children.filter(child => child !== actor);
            actor.parent = null;
        },
    };
    const actors = [new Actor(), new Actor({opacity: 210}), new Actor({opacity: 190})];
    const windows = actors.map((actor, index) => ({
        is_skip_taskbar: () => false,
        has_focus: () => index === 0,
        get_title: () => `Window ${index}`,
        get_frame_rect: () => ({width: 1000, height: 700}),
        get_compositor_private: () => actor,
    }));
    actors.forEach((actor, index) => {
        actor.get_meta_window = () => windows[index];
    });
    const app = {get_name: () => 'Application', get_windows: () => windows};
    const settings = new Signals();
    settings.get_int = key => ({
        'hover-delay-ms': 180, 'preview-width': 260, 'preview-height': 160,
        'popup-fade-duration-ms': 150, 'enriched-preview-delay-ms': 300,
        'enriched-preview-fade-duration-ms': 240, 'enriched-preview-size-percent': 85,
    })[key];
    settings.get_string = key => key === 'preview-layout' ? 'vertical' : 'truncate';
    settings.get_boolean = key => ['peek-enabled', 'enriched-preview-enabled', 'middle-click-close'].includes(key);
    const activations = [];
    const shellGlobal = {get_window_actors: () => actors};
    const context = vm.createContext({global: shellGlobal});
    const root = process.env.DOCK_PREVIEW_SOURCE_DIR ?? path.resolve(__dirname, '..');
    const modules = new Map();
    const mocks = {
        'gi://GLib': {default: GLib},
        'gi://Clutter': {default: {
            Actor, Clone: Actor, BinLayout: class {}, AnimationMode: {},
            ActorAlign: {}, Orientation: {},
        }},
        'gi://St': {default: {
            BoxLayout: Actor, Widget: Actor, Bin: Actor, Button: Actor, Label: Actor, Icon: Actor,
            Side: {LEFT: 0, RIGHT: 1, TOP: 2, BOTTOM: 3},
        }},
        'gi://Pango': {default: {EllipsizeMode: {}, WrapMode: {}}},
        'resource:///org/gnome/shell/ui/main.js': {
            layoutManager,
            activateWindow: window => activations.push({
                window,
                visibleChrome: chrome.children.filter(actor => actor.visible).length,
                opacities: actors.map(actor => actor.opacity),
                timers: timers.size,
            }),
        },
    };

    async function load(specifier, parent = path.join(root, 'extension.js')) {
        const id = mocks[specifier] ? specifier : path.resolve(path.dirname(parent), specifier);
        if (modules.has(id))
            return modules.get(id);
        const module = mocks[id]
            ? new vm.SyntheticModule(Object.keys(mocks[id]), function () {
                for (const [key, value] of Object.entries(mocks[id]))
                    this.setExport(key, value);
            }, {context, identifier: id})
            : new vm.SourceTextModule(await readFile(id, 'utf8'), {context, identifier: id});
        modules.set(id, module);
        await module.link((dependency, reference) => load(dependency, reference.identifier));
        return module;
    }

    const entry = await load('./trackers/dockHoverTracker.js');
    await entry.evaluate();
    return {
        Actor, actors, windows, app, settings, chrome, timers, activations,
        Tracker: entry.namespace.default,
        Popup: modules.get(path.join(root, 'windowPreviewPopup.js')).namespace.default,
        Peek: modules.get(path.join(root, 'effects/windowPeek.js')).namespace.default,
        runTimer(id) {
            const timer = timers.get(id);
            assert.ok(timer, `Timer ${id} must exist`);
            timers.delete(id);
            if (timer.callback())
                timers.set(id, timer);
        },
    };
};
