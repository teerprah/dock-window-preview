<a href="https://www.buymeacoffee.com/serindipity" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-red.png" alt="Buy Me a Coffee" style="height: 60px !important;width: 217px !important;" ></a>
# dock-window-preview
# Dock Window Preview (GNOME 46/48/49/50/51)
This GNOME Shell extension shows open-window previews when you hover a dock icon.
Clicking a preview activates that window; middle-clicking a preview closes that
window, like the Windows taskbar.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Install locally

1. Run:
   `make install`
2. Reload GNOME Shell:
   - GNOME 50/51 / Wayland: log out and back in
   - GNOME 46/48/49 / X11: press `Alt+F2`, run `r`
   - GNOME 46/48 / Wayland: log out and back in
3. Enable the extension:
   `gnome-extensions enable dock-window-preview@quivio`
4. Open settings:
   `gnome-extensions prefs dock-window-preview@quivio`

## Make targets

- `make install`: installs to `~/.local/share/gnome-shell/extensions/dock-window-preview@quivio`
- `make zip`: creates `dist/dock-window-preview@quivio.zip`
- `make uninstall`: runs `./uninstall.sh` to disable (if possible) and remove the local install directory

You can override the install location:
`make install INSTALL_DIR=/path/to/extensions/dock-window-preview@quivio`

Direct script usage:
`UUID=dock-window-preview@quivio INSTALL_DIR=~/.local/share/gnome-shell/extensions/dock-window-preview@quivio ./uninstall.sh`

## Notes

- Supports GNOME Shell 46, 48, 49, 50, and 51 (`shell-version: ["46", "48", "49", "50", "51"]`).
- GNOME Shell 50 and later are Wayland-only, so a full log out / log in cycle is required after install.
- Includes a preferences panel for:
  - Hover delay (ms)
  - Vertical or horizontal preview layout
  - Preview thumbnail width/height
  - Title overflow behavior (truncate or wrap)
  - Optional per-window close button with left/right placement
  - Middle-click on a preview to close the window (enabled by default)
  - Optional centered overview-style preview with configurable delay, size, and animation duration
  - Optional Skip Focused Window setting for enriched previews (off by default)
  - Optional Peek effect that fades other windows while hovering a preview
  - Preview popup animation duration
  - Optional macOS-style dedicated workspace for maximized windows

## Want to contribute?

### Validation

Compile schemas with `glib-compile-schemas --strict schemas` and build the submission ZIP with `make zip`.
Run Shexli on the ZIP and `ego-lint` on its extracted contents.

Shexli 0.2.1 and EGO lint versions with a hardcoded GNOME 50 ceiling flag the declared GNOME 51 support.
[GNOME 51 was released on September 16, 2026](https://release.gnome.org/51/); use validators with an updated release baseline.
The version ceiling is a validator issue and does not require removing GNOME 51 from `metadata.json`.

Please refer to:
- our AI and LLM contribution policy [here](https://github.com/teerprah/dock-window-preview/wiki/Policy-on-AI-and-Large-Language-Model-(LLM)-Contributions)
- Quality and GNOME Extension development guidelines [here](https://github.com/teerprah/dock-window-preview/wiki/Quality-Standards-and-GNOME-Extension-guidelines)
