SHELL := /usr/bin/env bash

UUID := dock-window-preview@quivio
INSTALL_DIR ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
DIST_DIR ?= dist
ZIP_FILE := $(DIST_DIR)/$(UUID).zip
SCHEMA_DIR := schemas
SCHEMA_XML := $(SCHEMA_DIR)/org.gnome.shell.extensions.dock-window-preview.gschema.xml
SCHEMA_COMPILED := $(SCHEMA_DIR)/gschemas.compiled
PACKAGE_FILES := metadata.json extension.js stylesheet.css prefs.js README.md $(SCHEMA_XML) $(SCHEMA_COMPILED)

.PHONY: install zip uninstall clean

install: $(PACKAGE_FILES)
	@mkdir -p "$(INSTALL_DIR)"
	@install -m 644 metadata.json "$(INSTALL_DIR)/metadata.json"
	@install -m 644 extension.js "$(INSTALL_DIR)/extension.js"
	@install -m 644 stylesheet.css "$(INSTALL_DIR)/stylesheet.css"
	@install -m 644 prefs.js "$(INSTALL_DIR)/prefs.js"
	@if [[ -d "$(SCHEMA_DIR)" ]]; then mkdir -p "$(INSTALL_DIR)/$(SCHEMA_DIR)" && cp -R "$(SCHEMA_DIR)"/. "$(INSTALL_DIR)/$(SCHEMA_DIR)/"; fi
	@if [[ -d "$(INSTALL_DIR)/$(SCHEMA_DIR)" ]]; then glib-compile-schemas "$(INSTALL_DIR)/$(SCHEMA_DIR)"; fi
	@echo "Installed extension to $(INSTALL_DIR)"
	@echo "Reload GNOME Shell (X11: Alt+F2 then r, Wayland: log out/in)."

zip: $(PACKAGE_FILES)
	@mkdir -p "$(DIST_DIR)"
	@rm -f "$(ZIP_FILE)"
	@zip -r "$(ZIP_FILE)" metadata.json extension.js stylesheet.css prefs.js README.md "$(SCHEMA_DIR)" >/dev/null
	@echo "Created $(ZIP_FILE)"

uninstall:
	@UUID="$(UUID)" INSTALL_DIR="$(INSTALL_DIR)" ./uninstall.sh

clean:
	@rm -f "$(ZIP_FILE)" "$(SCHEMA_COMPILED)"

$(SCHEMA_COMPILED): $(SCHEMA_XML)
	@glib-compile-schemas "$(SCHEMA_DIR)"