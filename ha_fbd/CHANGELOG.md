# Changelog

## 0.5.2
- **Export / import** on the automations page: download one or all automations as a `.fbd.json` file and import them again (also on another installation). Imported automations are added as new, stopped automations.
- The GitHub repository is now a Home Assistant add-on repository: add `https://github.com/gST84/ha-fbd` to the add-on store to install and update, no more copying folders.

## 0.5.1
- The add-on icon is shown at the top left of the toolbar (automations page and editor).

## 0.5.0
- Room (area) switching is now part of **SET** and **RESET** (target *Room*): SET turns everything on, RESET turns everything off. The separate ROOM OUT block is hidden; existing programs are converted automatically.
- **TIME_OF_DAY** moved to the *Timers* section of the palette.
- Add-on icon and logo; documentation and screenshots.

## 0.4.0
- TIME_OF_DAY block (window, weekdays, current time in Home Assistant's time zone).
- Room block (switch lights / media players / … of a Home Assistant area).
- Right-click context menu (copy, cut, paste here, delete, select all).
- Light / dark theme, *Auto* follows Home Assistant.
- No text selection while dragging wires.

## 0.3.0
- Multiple automations (one page each), resizable side panels, block-type menu (click the name), richer hover documentation.
- Copy / cut / paste, multi-select, events as inputs and outputs, SET and RESET blocks, attribute outputs, brighter live lines.

## 0.1.0 – 0.2.0
- Engine, server, editor and add-on packaging: TIA-style networks, internal variables, 100 ms cyclic scan, live view.
