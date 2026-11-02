# Revit exporter (pyRevit)

`RTSAirflow.extension` adds one button, **RTSAirflow → Export → Export Rooms**. It writes a JSON file (`rts-airflow-revit`, version 1) that the web app reads with **Import from Revit**. Schema and import rules: `docs/revit-import-schema.md`.

## Install (once)

1. pyRevit → Settings → Custom Extension Directories → add this folder: `…\tools\revit`
2. Save Settings and Reload. The **RTSAirflow** tab appears.

## Use

1. Open the MEP host model with the architectural link loaded.
2. Click **Export Rooms**. If the host and a link both have rooms, pick where the rooms come from (normally the architectural link).
3. Save the JSON. In the app: **Import from Revit**, pick the file, choose the level and the rooms on the AHU, map the Revit types, Import.

The button only reads the model: no transaction, nothing changes.

For constructions and glazing to fill in by themselves, the Revit types need thermal properties (Type Properties → Analytical Properties: Heat Transfer Coefficient (U), and Solar Heat Gain Coefficient for windows). For roofs, the host model needs a 3D view (any, not a template): the exporter looks straight up from each room through it.

## Files

- `lib/rts_airflow_export.py` — the export (`export(doc, source_index)` returns the data). Runs in IronPython 2.7 and CPython 3.
- `RTSAirflow.tab/Export.panel/Export Rooms.pushbutton/script.py` — the button: source picker, save dialog.
