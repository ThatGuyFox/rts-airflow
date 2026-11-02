# -*- coding: utf-8 -*-
"""Export rooms, walls, windows and doors for the RTS airflow web app (Import from Revit)."""
__title__ = "Export\nRooms"
__doc__ = "Writes an rts-airflow-revit JSON file for the RTS airflow web app: rooms with boundaries, walls, windows, doors. Read-only."

import io
import json

from pyrevit import forms, revit, script

import rts_airflow_export as rx

doc = revit.doc
sources = rx.room_sources(doc)
if not sources:
    forms.alert("No placed rooms in this model or in any loaded link.", exitscript=True)

index = 0
if len(sources) > 1:
    labels = [s[0] for s in sources]
    pick = forms.SelectFromList.show(labels, title="Take rooms from", multiselect=False, button_name="Use these rooms")
    if not pick:
        script.exit()
    index = labels.index(pick)

data = rx.export(doc, index)
path = forms.save_file(file_ext="json", default_name=doc.Title.replace(".rvt", "") + "_rts-airflow")
if not path:
    script.exit()
text = json.dumps(data, indent=1, ensure_ascii=False)
try:
    text = text.decode("utf-8")  # IronPython 2: bytes → unicode
except (AttributeError, UnicodeDecodeError):
    pass
with io.open(path, "w", encoding="utf-8") as f:
    f.write(text)
forms.alert("Wrote {}\n\n{}\n\nOpen it in the app with “Import from Revit”.".format(path, rx.summary(data)))
