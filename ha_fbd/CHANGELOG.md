# Changelog

## 0.7.2
- **Export / import** on the automations page: export one or all automations as a `.fbd.json` file and import them again (also on another installation). The export is also shown as text to copy and import accepts pasted text, because the Home Assistant apps ignore file downloads from an add-on panel. Imported automations are added as new, stopped automations.
- The GitHub repository is now a Home Assistant add-on repository: add `https://github.com/gST84/ha-fbd` to the add-on store to install and update, no more copying folders.

## 0.7.0
- New **PID** block (palette section *Control*): setpoint, process value, KP, integral time TI, derivative time TD, output limits and enable. Anti-windup, derivative on the measurement, time-step independent, negative KP for reverse (cooling) action.

## 0.6.0
- SET / RESET with target *Room* can now also switch a whole **zone** (Home Assistant floor): the dropdown lists each zone with its rooms indented below it, followed by rooms that have no zone. Uses `floor_id` as the service target.

## 0.5.1
- Add-on icon in the top bar of the automations page and the editor, and as browser tab icon.

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
