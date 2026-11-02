# -*- coding: utf-8 -*-
"""Revit export for the RTS airflow web app (format rts-airflow-revit, version 1).

Writes raw facts only: levels, rooms with finish-boundary segments and what lies beyond each segment, walls,
windows and doors. Coordinates are the host model's internal coordinates in feet (a linked model's transform
is applied). The app turns this into spaces, surfaces and a plan (src/model/revitImport.ts); no load rules
live here. Schema: docs/revit-import-schema.md.

Works in IronPython 2.7 and CPython 3 (pyRevit engines). Read-only: no transaction, nothing in the model changes.
"""
from __future__ import print_function

import datetime
import math

from Autodesk.Revit.DB import (
    BuiltInCategory,
    BuiltInParameter,
    ElementId,
    ElementMulticategoryFilter,
    FilteredElementCollector,
    FindReferenceTarget,
    Line,
    ReferenceIntersector,
    RevitLinkInstance,
    SpatialElementBoundaryLocation,
    SpatialElementBoundaryOptions,
    Transform,
    View3D,
    Wall,
    XYZ,
)
from System.Collections.Generic import List

EXPORTER = "rts_airflow_export.py 1.1"
# Revit keeps heat transfer coefficients in W/(m²·K) internally (no length in the unit); → Btu/(h·ft²·°F)
W_M2K_TO_BTU = 0.176110
WALL_FUNCTION = {0: "Interior", 1: "Exterior", 2: "Foundation", 3: "Retaining", 4: "Soffit", 5: "CoreShaft"}
PROBE_Z = 1.0  # ft above the level, for room look-ups
PROBE_PAST = 0.5  # ft past the far face of the bounding wall
PROBE_NO_WALL = 1.0  # ft past a column face or separation line


def eid(i):
    """ElementId as text (Revit 2024+ .Value, older .IntegerValue)."""
    try:
        return str(i.Value)
    except AttributeError:
        return str(i.IntegerValue)


def r4(v):
    return round(v, 4)


def type_name(doc, e):
    t = doc.GetElement(e.GetTypeId())
    if t is None:
        return None
    p = t.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM) or t.get_Parameter(BuiltInParameter.ALL_MODEL_TYPE_NAME)
    return p.AsString() if p else None


def wall_function(w):
    p = w.WallType.get_Parameter(BuiltInParameter.FUNCTION_PARAM)
    return WALL_FUNCTION.get(p.AsInteger(), str(p.AsInteger())) if p else None


def category(e):
    return e.Category.Name if e is not None and e.Category is not None else None


def rooms_in(doc):
    return [
        r
        for r in FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
        if r.Area > 0 and r.Location is not None
    ]


def room_sources(doc):
    """[(label, source doc, transform to host)]: the host model first if it has rooms, then each loaded link that does."""
    out = []
    if rooms_in(doc):
        out.append((doc.Title + " (this model)", doc, Transform.Identity))
    for li in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        ld = li.GetLinkDocument()
        if ld is not None and rooms_in(ld):
            out.append((ld.Title + " (link)", ld, li.GetTotalTransform()))
    return out


def last_phase(doc):
    ps = doc.Phases
    return ps.get_Item(ps.Size - 1) if ps.Size else None


def room_phase(doc, room):
    p = room.get_Parameter(BuiltInParameter.ROOM_PHASE)
    ph = doc.GetElement(p.AsElementId()) if p else None
    return ph or last_phase(doc)


def first_length(e, doc, params):
    """First positive length among these parameters, on the instance, then on its type."""
    for owner in (e, doc.GetElement(e.GetTypeId())):
        if owner is None:
            continue
        for bip in params:
            p = owner.get_Parameter(bip)
            if p is not None and p.HasValue and p.AsDouble() > 0:
                return r4(p.AsDouble())
    return None


def chords(curve):
    """A boundary curve as straight pieces (lines as is, arcs tessellated)."""
    if isinstance(curve, Line):
        return [(curve.GetEndPoint(0), curve.GetEndPoint(1))]
    ps = list(curve.Tessellate())
    return [(ps[i], ps[i + 1]) for i in range(len(ps) - 1)]


def type_thermal(t):
    """(U in Btu/h·ft²·°F, SHGC) from a type's analytical properties, None where Revit has no value."""
    out = []
    for name, conv in (("ANALYTICAL_HEAT_TRANSFER_COEFFICIENT", W_M2K_TO_BTU), ("ANALYTICAL_SOLAR_HEAT_GAIN_COEFFICIENT", 1.0)):
        v = None
        try:
            p = t.get_Parameter(getattr(BuiltInParameter, name))
            if p is not None and p.HasValue and p.AsDouble() > 0:
                v = r4(p.AsDouble() * conv)
        except Exception:
            v = None
        out.append(v)
    return out[0], out[1]


def find_3d_view(doc):
    for v in FilteredElementCollector(doc).OfClass(View3D):
        if not v.IsTemplate:
            return v
    return None


def above_room(doc, view3d, origin):
    """What is straight above a host-coordinate point: the nearest roof or floor face (a ray up)."""
    cats = List[BuiltInCategory]()
    cats.Add(BuiltInCategory.OST_Roofs)
    cats.Add(BuiltInCategory.OST_Floors)
    ri = ReferenceIntersector(ElementMulticategoryFilter(cats), FindReferenceTarget.Face, view3d)
    ri.FindReferencesInRevitLinks = True
    ctx = ri.FindNearest(origin, XYZ.BasisZ)
    if ctx is None:
        return {"kind": "none"}
    ref = ctx.GetReference()
    e = doc.GetElement(ref.ElementId)
    tf = Transform.Identity
    edoc, eref = doc, ref
    if isinstance(e, RevitLinkInstance):
        edoc, tf = e.GetLinkDocument(), e.GetTotalTransform()
        e = edoc.GetElement(ref.LinkedElementId)
        eref = ref.CreateReferenceInLink()
    if e is None:
        return {"kind": "none"}
    kind = "roof" if e.Category is not None and e.Category.Id == ElementId(BuiltInCategory.OST_Roofs) else "floor"
    out = {"kind": kind, "type": type_name(edoc, e), "rise": r4(ctx.Proximity)}
    try:
        face = e.GetGeometryObjectFromReference(eref)
        hit = tf.Inverse.OfPoint(ref.GlobalPoint)
        n = tf.OfVector(face.ComputeNormal(face.Project(hit).UVPoint))
        up = XYZ(-n.X, -n.Y, -n.Z) if n.Z < 0 else n  # the hit face is the underside: its outward normal points down
        out["tilt"] = r4(math.degrees(math.acos(max(-1.0, min(1.0, up.Z)))))
        out["az"] = r4(math.degrees(math.atan2(up.X, up.Y)) % 360) if out["tilt"] > 0.5 else 0
    except Exception:
        out["tilt"] = None
        out["az"] = None
    return out


def export(doc, source_index=0):
    """The export as a dict. doc = host document; source_index picks from room_sources(doc)."""
    sources = room_sources(doc)
    if not sources:
        raise Exception("No placed rooms in this model or in any loaded link.")
    label, sdoc, tf = sources[source_index]

    def P(p):
        q = tf.OfPoint(p)
        return [r4(q.X), r4(q.Y)]

    levels = {}
    rooms = []
    types = {}  # (cat, name) → {cat, name, u, shgc}
    view3d = find_3d_view(doc)

    def add_type(cat, name, t):
        if name and (cat, name) not in types and t is not None:
            u, shgc = type_thermal(t)
            types[(cat, name)] = {"cat": cat, "name": name, "u": u, "shgc": shgc if cat == "window" else None}

    opts = SpatialElementBoundaryOptions()
    opts.SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish

    for room in rooms_in(sdoc):
        lvl = sdoc.GetElement(room.LevelId)
        levels[eid(lvl.Id)] = {"id": eid(lvl.Id), "name": lvl.Name, "elevation": r4(lvl.Elevation)}
        z = lvl.Elevation + PROBE_Z
        phase = room_phase(sdoc, room)
        loops = []
        for loop in room.GetBoundarySegments(opts) or []:
            segs = []
            for seg in loop:
                el = sdoc.GetElement(seg.ElementId) if seg.ElementId != ElementId.InvalidElementId else None
                is_wall = isinstance(el, Wall)
                by = {"cat": category(el) or ("Linked element" if seg.LinkElementId != ElementId.InvalidElementId else "None")}
                if is_wall:
                    by["type"] = type_name(sdoc, el)
                    by["function"] = wall_function(el)
                past = (el.Width + PROBE_PAST) if is_wall else PROBE_NO_WALL
                for a, b in chords(seg.GetCurve()):
                    dx, dy = b.X - a.X, b.Y - a.Y
                    L = math.hypot(dx, dy)
                    if L < 1e-6:
                        continue
                    nx, ny = dy / L, -dx / L
                    mx, my = (a.X + b.X) / 2, (a.Y + b.Y) / 2
                    if not room.IsPointInRoom(XYZ(mx - nx * 0.05, my - ny * 0.05, z)):
                        nx, ny = -nx, -ny  # make n point away from the room
                    beyond = sdoc.GetRoomAtPoint(XYZ(mx + nx * past, my + ny * past, z), phase)
                    if beyond is not None:
                        other = {"kind": "room", "uid": beyond.UniqueId}
                    elif is_wall and by.get("function") == "Exterior":
                        other = {"kind": "exterior"}
                    else:
                        other = {"kind": "none"}
                    segs.append({"a": P(a), "b": P(b), "wall": eid(el.Id) if is_wall else None, "by": by, "other": other})
            loops.append(segs)
        h = room.UnboundedHeight
        ff = room.get_Parameter(BuiltInParameter.ROOM_FINISH_FLOOR)
        above = None
        if view3d is not None:
            try:
                rp = room.Location.Point
                above = above_room(doc, view3d, tf.OfPoint(XYZ(rp.X, rp.Y, lvl.Elevation + PROBE_Z)))
            except Exception as ex:
                above = {"kind": "none", "error": str(ex)}
            if above and above.get("kind") == "roof":
                rt = [r for r in FilteredElementCollector(sdoc).OfCategory(BuiltInCategory.OST_Roofs).WhereElementIsNotElementType() if type_name(sdoc, r) == above.get("type")]
                if rt:
                    add_type("roof", above["type"], sdoc.GetElement(rt[0].GetTypeId()))
        rooms.append(
            {
                "uid": room.UniqueId,
                "level": eid(lvl.Id),
                "number": room.Number,
                "name": room.get_Parameter(BuiltInParameter.ROOM_NAME).AsString(),
                "area": r4(room.Area),
                "height": r4(h) if h and h > 0 else None,
                "floorFinish": (ff.AsString() or None) if ff else None,
                "above": above,
                "loops": loops,
            }
        )

    walls = []
    for w in FilteredElementCollector(sdoc).OfClass(Wall):
        lid = eid(w.LevelId)
        loc = w.Location
        if lid not in levels or loc is None or not hasattr(loc, "Curve"):
            continue
        add_type("wall", type_name(sdoc, w), w.WallType)
        for a, b in chords(loc.Curve):
            walls.append(
                {"id": eid(w.Id), "level": lid, "type": type_name(sdoc, w), "function": wall_function(w), "a": P(a), "b": P(b), "width": r4(w.Width)}
            )

    openings = []
    phase = last_phase(sdoc)
    W = [BuiltInParameter.FAMILY_WIDTH_PARAM, BuiltInParameter.WINDOW_WIDTH, BuiltInParameter.DOOR_WIDTH]
    H = [BuiltInParameter.FAMILY_HEIGHT_PARAM, BuiltInParameter.WINDOW_HEIGHT, BuiltInParameter.DOOR_HEIGHT]
    for bic, kind in ((BuiltInCategory.OST_Windows, "window"), (BuiltInCategory.OST_Doors, "door")):
        for fi in FilteredElementCollector(sdoc).OfCategory(bic).WhereElementIsNotElementType():
            lid = eid(fi.LevelId)
            loc = fi.Location
            if lid not in levels or loc is None or not hasattr(loc, "Point"):
                continue
            fam = fi.Symbol.FamilyName if fi.Symbol else ""
            add_type(kind, "{}: {}".format(fam, type_name(sdoc, fi)), fi.Symbol)
            sides = []
            for prop in ("FromRoom", "ToRoom"):
                rm = None
                try:
                    rm = getattr(fi, "get_" + prop)(phase)  # IronPython
                except Exception:
                    try:
                        rm = getattr(fi, prop)[phase]  # CPython (pythonnet)
                    except Exception:
                        rm = None
                sides.append(rm.UniqueId if rm is not None else None)
            openings.append(
                {
                    "id": eid(fi.Id),
                    "level": lid,
                    "kind": kind,
                    "family": fam,
                    "type": type_name(sdoc, fi),
                    "w": first_length(fi, sdoc, W),
                    "h": first_length(fi, sdoc, H),
                    "wall": eid(fi.Host.Id) if isinstance(fi.Host, Wall) else None,
                    "at": P(loc.Point),
                    "rooms": sides,
                    "cased": ("cased" in fam.lower()) or ("opening" in fam.lower()),
                }
            )

    north = None
    try:
        north = r4(math.degrees(doc.ActiveProjectLocation.GetProjectPosition(XYZ.Zero).Angle))
    except Exception:
        pass

    return {
        "format": "rts-airflow-revit",
        "version": 1,
        "exported": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "exporter": EXPORTER,
        "model": {"host": doc.Title + ".rvt" if not doc.Title.lower().endswith(".rvt") else doc.Title, "roomsFrom": label, "revitTrueNorthDeg": north},
        "levels": sorted(levels.values(), key=lambda l: l["elevation"]),
        "rooms": rooms,
        "walls": walls,
        "openings": openings,
        "types": sorted(types.values(), key=lambda t: (t["cat"], t["name"])),
        "notes": [] if view3d is not None else ["No 3D view in the host model: what is above each room (roof / floor) was not checked."],
    }


def summary(data):
    return "{} levels, {} rooms, {} wall pieces, {} windows/doors".format(
        len(data["levels"]), len(data["rooms"]), len(data["walls"]), len(data["openings"])
    )
