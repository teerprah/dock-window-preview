import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.dock-window-preview';

function createSpinRow({title, subtitle, settings, key, min, max, step}) {
    const row = new Adw.ActionRow({title, subtitle});

    const adjustment = new Gtk.Adjustment({
        lower: min,
        upper: max,
        step_increment: step,
        page_increment: step * 10,
        value: settings.get_int(key),
    });

    const spin = new Gtk.SpinButton({
        adjustment,
        valign: Gtk.Align.CENTER,
        numeric: true,
        digits: 0,
    });

    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return row;
}

export default class DockWindowPreviewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);

        const page = new Adw.PreferencesPage({
            title: 'Dock Preview',
            icon_name: 'preferences-system-symbolic',
        });

        const hoverGroup = new Adw.PreferencesGroup({
            title: 'Hover Behavior',
            description: 'Control when previews appear.',
        });
        hoverGroup.add(createSpinRow({
            title: 'Hover Delay',
            subtitle: 'Delay before showing previews (milliseconds).',
            settings,
            key: 'hover-delay-ms',
            min: 50,
            max: 5000,
            step: 10,
        }));
        page.add(hoverGroup);

        const previewGroup = new Adw.PreferencesGroup({
            title: 'Preview Appearance',
            description: 'Control preview layout and thumbnail size.',
        });

        const layoutRow = new Adw.ActionRow({
            title: 'Preview Layout',
            subtitle: 'Choose vertical stack or horizontal strip.',
        });

        const layoutModel = Gtk.StringList.new([
            'Vertical stack',
            'Horizontal strip',
        ]);
        const layoutDropdown = new Gtk.DropDown({
            model: layoutModel,
            selected: settings.get_string('preview-layout') === 'horizontal' ? 1 : 0,
            valign: Gtk.Align.CENTER,
        });

        layoutDropdown.connect('notify::selected', () => {
            const layout = layoutDropdown.selected === 1 ? 'horizontal' : 'vertical';
            settings.set_string('preview-layout', layout);
        });

        settings.connect('changed::preview-layout', () => {
            const selected = settings.get_string('preview-layout') === 'horizontal' ? 1 : 0;
            if (layoutDropdown.selected !== selected)
                layoutDropdown.selected = selected;
        });

        layoutRow.add_suffix(layoutDropdown);
        layoutRow.activatable_widget = layoutDropdown;
        previewGroup.add(layoutRow);

        const titleOverflowRow = new Adw.ActionRow({
            title: 'Title Overflow',
            subtitle: 'Choose whether long titles truncate or wrap.',
        });

        const titleOverflowModel = Gtk.StringList.new([
            'Truncate with ellipsis',
            'Wrap to next line',
        ]);
        const titleOverflowDropdown = new Gtk.DropDown({
            model: titleOverflowModel,
            selected: settings.get_string('title-overflow-mode') === 'wrap' ? 1 : 0,
            valign: Gtk.Align.CENTER,
        });

        titleOverflowDropdown.connect('notify::selected', () => {
            const mode = titleOverflowDropdown.selected === 1 ? 'wrap' : 'truncate';
            settings.set_string('title-overflow-mode', mode);
        });

        settings.connect('changed::title-overflow-mode', () => {
            const selected = settings.get_string('title-overflow-mode') === 'wrap' ? 1 : 0;
            if (titleOverflowDropdown.selected !== selected)
                titleOverflowDropdown.selected = selected;
        });

        titleOverflowRow.add_suffix(titleOverflowDropdown);
        titleOverflowRow.activatable_widget = titleOverflowDropdown;
        previewGroup.add(titleOverflowRow);

        previewGroup.add(createSpinRow({
            title: 'Preview Width',
            subtitle: 'Width of each window thumbnail (pixels).',
            settings,
            key: 'preview-width',
            min: 120,
            max: 640,
            step: 10,
        }));

        previewGroup.add(createSpinRow({
            title: 'Preview Height',
            subtitle: 'Height of each window thumbnail (pixels).',
            settings,
            key: 'preview-height',
            min: 80,
            max: 480,
            step: 10,
        }));

        page.add(previewGroup);
        window.add(page);
        window.set_default_size(620, 460);
    }
}
