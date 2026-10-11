# Installation

## Requirements
- Home Assistant OS (or Supervised) with the Samba or SSH add-on to reach the `addons` folder.
- The add-on builds its Docker image on your Home Assistant, so the first install needs internet access there (npm packages).

## Install as a local add-on

1. **Package** (on your PC):
   ```
   npm install
   npm run package:addon          # → dist-addon/ha_fbd
   ```
   Or use the ready-made `ha_fbd-addon-folder.zip` if you have one.
2. **Copy** the folder `ha_fbd` to the Samba share **addons**: `\\homeassistant.local\addons\ha_fbd` (macOS: `smb://homeassistant.local/addons`). With SSH: `scp -r dist-addon/ha_fbd root@homeassistant.local:/addons/`.
3. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**. A *Local add-ons* section appears.
4. Open **FBD Automation → Install** (the image is built; this takes a few minutes), then **Start**.
5. Enable **Show in sidebar** (and optionally *Start on boot*).

## Options

| Option | Default | Meaning |
|---|---|---|
| `scan_ms` | 100 | PLC scan cycle in milliseconds (20–1000) |
| `write_on_first_scan` | true | Write the computed output state when a program starts (otherwise the first scan only reads) |
| `log_level` | info | debug, info, warning, error |

## Updating
- Copy the new `ha_fbd` folder over the old one.
- Bump `version` in `addon/ha_fbd/config.yaml` before packaging and use *Check for updates* → **Update**; or run `ha addons rebuild local_ha_fbd` over SSH.
- Your automations live in the add-on's `/data` folder and survive updates and rebuilds. A program saved by the very first single-program version is migrated automatically into an automation called “My first automation”.

## Logs and troubleshooting
- Add-on page → **Log** tab, or over SSH: `ha addons logs local_ha_fbd`.
- **"No Home Assistant credentials"** – only happens outside the add-on; set `HA_URL` and `HA_TOKEN` (see [DEVELOPMENT.md](DEVELOPMENT.md)).
- **Add-on not listed** – check that `config.yaml` is directly inside `addons/ha_fbd/` and press *Check for updates* again.
- **Rooms list is empty in the editor** – the editor falls back to typing the area id (e.g. `living_room`); make sure areas exist under *Settings → Areas*.
- **Time of day is off** – the block uses Home Assistant's configured time zone (*Settings → System → General*).
- The UI is only reachable through Home Assistant (Ingress); direct access from other hosts is refused on purpose.
