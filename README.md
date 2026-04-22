# dock-window-preview
# Dock Window Preview (GNOME 49/50)

This GNOME Shell extension shows open-window previews when you hover a dock icon.
Clicking a preview activates that window.

## Install locally

1. Run:
   `make install`
2. Reload GNOME Shell:
   - GNOME 50 / Wayland: log out and back in
   - GNOME 49 / X11: press `Alt+F2`, run `r`
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

- Supports GNOME Shell 49 and 50 (`shell-version: ["49", "50"]`).
- GNOME Shell 50 is Wayland-only, so a full log out / log in cycle is required after install.
- Includes a preferences panel for:
  - Hover delay (ms)
  - Vertical or horizontal preview layout
  - Preview thumbnail width/height
  - Title overflow behavior (truncate or wrap)
- The hover detector is tuned for dash/dock icons and uses the same app-window model as dock menu entries (including the "All Windows" behavior).
