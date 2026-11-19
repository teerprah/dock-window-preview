const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

class Signals {
    constructor() {
        this.handlers = new Map();
        this.nextId = 1;
    }

    connect(name, callback) {
        const id = this.nextId++;
        this.handlers.set(id, {name, callback});
        return id;
    }

    disconnect(id) {
        assert.ok(this.handlers.delete(id));
    }

    emit(name) {
        for (const [id, handler] of [...this.handlers]) {
            if (this.handlers.has(id) && handler.name === name)
                handler.callback(this);
        }
    }
}

async function loadModule(file, mocks, globals = {}) {
    const context = vm.createContext(globals);
    const root = process.env.DOCK_PREVIEW_SOURCE_DIR ?? path.resolve(__dirname, '..');
    const module = new vm.SourceTextModule(await readFile(path.join(root, file), 'utf8'), {context});
    await module.link(async name => {
        assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
        return new vm.SyntheticModule(['default'], function () {
            this.setExport('default', mocks[name]);
        }, {context});
    });
    await module.evaluate();
    return module.namespace.default;
}

test('preferences open without Shell helpers and release settings callbacks on close', async () => {
    const widgets = [];
    class Widget extends Signals {
        constructor(properties = {}) {
            super();
            Object.assign(this, properties);
            this.children = [];
            widgets.push(this);
        }

        add(child) { this.children.push(child); }
        add_suffix(child) { this.children.push(child); }
        set_default_size() {}
    }
    const settings = new Signals();
    const values = new Map([
        ['enriched-preview-enabled', true],
        ['show-close-button', false],
        ['preview-layout', 'vertical'],
        ['title-overflow-mode', 'truncate'],
        ['close-button-position', 'right'],
    ]);
    settings.get_int = () => 120;
    settings.get_boolean = key => values.get(key) ?? false;
    settings.get_string = key => values.get(key);
    settings.set_string = (key, value) => {
        values.set(key, value);
        settings.emit(`changed::${key}`);
    };
    settings.bind = () => {};
    // Named exports are required by prefs.js's ExtensionPreferences import.
    const context = vm.createContext({});
    const root = process.env.DOCK_PREVIEW_SOURCE_DIR ?? path.resolve(__dirname, '..');
    const module = new vm.SourceTextModule(await readFile(path.join(root, 'prefs.js'), 'utf8'), {context});
    const mocks = {
        'gi://Adw': {default: {
            ActionRow: Widget, PreferencesPage: Widget, PreferencesGroup: Widget, SwitchRow: Widget,
        }},
        'gi://Gtk': {default: {
            Adjustment: Widget, SpinButton: Widget, DropDown: Widget,
            StringList: {new: labels => labels}, Align: {CENTER: 0},
        }},
        'gi://Gio': {default: {SettingsBindFlags: {DEFAULT: 0}}},
        'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js': {
            ExtensionPreferences: class { getSettings() { return settings; } },
        },
    };
    await module.link(async name => new vm.SyntheticModule(Object.keys(mocks[name]), function () {
        for (const [key, value] of Object.entries(mocks[name]))
            this.setExport(key, value);
    }, {context}));
    await module.evaluate();
    const preferences = new module.namespace.default();
    for (let session = 0; session < 2; session++) {
        const window = new Widget();
        preferences.fillPreferencesWindow(window);
        assert.equal(window.children.length, 1);
        assert.equal(settings.handlers.size, 5);
        const closePositionRow = widgets.findLast(widget => widget.title === 'Close Button Position');
        assert.equal(closePositionRow.sensitive, false);
        values.set('show-close-button', true);
        settings.emit('changed::show-close-button');
        assert.equal(closePositionRow.sensitive, true);
        const layoutRow = widgets.findLast(widget => widget.title === 'Preview Layout');
        settings.set_string('preview-layout', 'horizontal');
        assert.equal(layoutRow.children[0].selected, 1);
        window.emit('close-request');
        assert.equal(settings.handlers.size, 0);
        values.set('show-close-button', false);
        settings.emit('changed::show-close-button');
        assert.equal(closePositionRow.sensitive, true);
    }
});

test('unmanaged windows disconnect all handlers before tracker destruction', async () => {
    const sources = new Map();
    let nextSourceId = 1;
    const GLib = {
        idle_add(_priority, callback) {
            const id = nextSourceId++;
            sources.set(id, callback);
            return id;
        },
        Source: {remove: id => assert.ok(sources.delete(id))},
    };
    const display = new Signals();
    const Tracker = await loadModule('trackers/maximizeWorkspaceTracker.js', {
        'gi://GLib': GLib, 'gi://Meta': {},
    }, {global: {display, get_window_actors: () => []}});
    const settings = new Signals();
    settings.get_boolean = () => false;
    const tracker = new Tracker(settings);
    tracker.enable();
    const window = new Signals();
    tracker._trackWindow(window);
    assert.equal(window.handlers.size, 3);
    assert.equal(sources.size, 1);
    window.emit('unmanaged');
    assert.equal(window.handlers.size, 0);
    assert.equal(sources.size, 0);
    window.emit('notify::maximized-horizontally');
    assert.equal(sources.size, 0);
    tracker.destroy();
    assert.equal(settings.handlers.size, 0);
    assert.equal(display.handlers.size, 0);
    assert.equal(sources.size, 0);
});
