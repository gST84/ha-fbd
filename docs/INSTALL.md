# Installation

## Requirements
- Home Assistant OS (or Supervised).
- The add-on builds its Docker image on your Home Assistant, so installing and updating need internet access there (npm packages).

## Install from the add-on repository

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add `https://github.com/gST84/ha-fbd` and close the dialog.
3. **FBD Automation** now appears in the store (use *⋮ → Check for updates* if it does not). Open it → **Install** (the image is built; this takes a few minutes), then **Start**.
4. Enable **Show in sidebar** (and optionally *Start on boot*).

### Coming from the local add-on

The store add-on is a different add-on than the *local* one (other slug, own `/data` folder), so your automations do not move along automatically. Move them with export / import: update the local add-on to 0.5.2 or newer, click **Export all** on its automations page, install the store add-on and **Import** the file there. Imported automations are stopped; start them after you have stopped (or uninstalled) the local add-on, otherwise both add-ons drive the same entities.

## Install as a local add-on (development builds)

1. **Package** (on your PC):
   ```
   cd ha_fbd
   npm install
   npm run package:addon          # → dist-addon/ha_fbd
   ```
2. **Copy** the folder `ha_fbd` to the Samba share **addons**: `\\homeassistant.local\addons\ha_fbd` (macOS: `smb://homeassistant.local/addons`). With SSH: `scp -r dist-addon/ha_fbd root@homeassistant.local:/addons/`.
3. **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**, then install **FBD Automation** under *Local add-ons*.

## Options

| Option | Default | Meaning |
|---|---|---|
| `scan_ms` | 100 | PLC scan cycle in milliseconds (20–1000) |
| `write_on_first_scan` | true | Write the computed output state when a program starts (otherwise the first scan only reads) |
| `log_level` | info | debug, info, warning, error |

## Updating
- **Repository install:** Home Assistant offers the update when a new version is published (*Check for updates* forces a refresh) → **Update**.
- **Local add-on:** copy the new `ha_fbd` folder over the old one and use *Check for updates* → **Update**, or run `ha addons rebuild local_ha_fbd` over SSH.
- Your automations live in the add-on's `/data` folder and survive updates and rebuilds. A program saved by the very first single-program version is migrated automatically into an automation called “My first automation”.

## Logs and troubleshooting
- Add-on page → **Log** tab, or over SSH: `ha addons logs <slug>` (`ha addons` lists the slugs; the local add-on is `local_ha_fbd`).
- **"No Home Assistant credentials"** – only happens outside the add-on; set `HA_URL` and `HA_TOKEN` (see [DEVELOPMENT.md](DEVELOPMENT.md)).
- **Add-on not listed** – check the repository URL under *⋮ → Repositories* and press *Check for updates* again (local add-on: `config.yaml` must be directly inside `addons/ha_fbd/`).
- **Rooms list is empty in the editor** – the editor falls back to typing the area id (e.g. `living_room`); make sure areas exist under *Settings → Areas*.
- **Time of day is off** – the block uses Home Assistant's configured time zone (*Settings → System → General*).
- The UI is only reachable through Home Assistant (Ingress); direct access from other hosts is refused on purpose.
