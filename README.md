# Cooling loads and airflows (RTS, I-P)

A static web app for one designer's workflow: outdoor air (ASHRAE 62.1-2022 Ventilation Rate Procedure),
then cooling loads (Radiant Time Series), then room supply, return, exhaust and transfer airflows per AHU.
It is a port of an Excel RTS workbook. Everything runs in the browser; there is no server and no login.
Projects are saved and opened as JSON files on your own computer.

**Live app:** published to GitHub Pages from this repository (see the repository's About link).

## The library file is not included

The calculation needs library tables (ASHRAE 62.1, ASHRAE Fundamentals / Load Calculation Applications
Manual, 90.1 lighting power densities). These tables are copyrighted, so they are **not** in this repository
and **not** in the published site. The app opens with "libraries missing" until you load a library file
(`rts-airflow-libraries.json`) that you hold yourself. The browser then keeps it in local storage for that
browser and that web address. Nothing is uploaded anywhere.

## Run locally

Requires Node.js.

```
npm ci
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

## Revit exporter

`tools/revit/` holds a pyRevit extension that exports rooms, walls, windows and doors to the JSON the app's
"Import from Revit" reads. See `tools/revit/README.md`.

## Deployment

`.github/workflows/deploy.yml` builds the app and publishes `dist/` to GitHub Pages on every push to `main`.

The engine's tests run against the original workbooks. Those workbooks and the libraries stay with the
author, so the tests are not in this repository.

All rights reserved.
