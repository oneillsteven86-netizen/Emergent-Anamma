"""Seed admin + coaches + classes into Supabase Auth + DB.
Run once after migrations. Uses the service_role key against the Auth Admin API
and the Postgres pooler for direct SQL on classes & coach perms.
"""
import os
import sys
import json
import urllib.request
import urllib.error

SUPABASE_URL = "https://wpwrtsaofmzroshmjplu.supabase.co"
SERVICE_KEY  = os.environ["SB_SERVICE_KEY"]
ANON_KEY     = os.environ.get("SB_ANON_KEY", "")

ADMIN_EMAIL = "stevie@aipnua.com"
ADMIN_PASS  = "AnamAdmin2026!"
SENDGRID_KEY = "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"
SENDER_EMAIL = "Anam@aipnua.ie"

# Coach seed
COACHES = [
    ("Stephen", "stephen@anammma.com", "Coach2026!",
     "Head Coach — MMA & Grappling. 15+ years experience leading fighters at all levels.",
     "https://static.wixstatic.com/media/ec6808_4d7a3ca0e31f46b38f28088561a863ec~mv2.jpg",
     {"manage_timetable": True, "manage_members": True, "mark_attendance": True,
      "manage_private_sessions": True, "send_announcements": True}),
    ("Danny", "danny@anammma.com", "Coach2026!",
     "K1 & Kickboxing Coach. Precision striking, footwork and fight IQ.",
     "https://static.wixstatic.com/media/ec6808_9cf6de1ee5254aa3ad572c0d58983ee5~mv2.png",
     {"manage_timetable": True, "mark_attendance": True}),
    ("Ciaran", "ciaran@anammma.com", "Coach2026!",
     "Judo Coach. National-level competitor, specialist in throws and groundwork.",
     "https://static.wixstatic.com/media/3f6c3b18c0a646da9ac9cb2c50995106.jpg",
     {"mark_attendance": True}),
]

K1_IMG  = "https://static.wixstatic.com/media/ec6808_eadc786c13cf4d698c7600012ac1f087~mv2.png"
BOX_IMG = "https://static.wixstatic.com/media/ec6808_3839340dc8f64b548cb617ff2d3f44e5~mv2.png"
SCHEDULE = [
    ("MMA Fundamentals", "Striking, takedowns and ground basics for all levels.", 0, "18:00", 60, "Main Mat", 20, "Stephen", ""),
    ("K1 Kickboxing",    "High-intensity K1 striking — pads, bag work and sparring drills.", 0, "19:15", 60, "Ring Room", 16, "Danny", K1_IMG),
    ("Boxing",           "Footwork, combinations and conditioning.", 1, "18:30", 60, "Ring Room", 16, "Danny", BOX_IMG),
    ("Judo",             "Throws, grips and groundwork.", 1, "19:45", 75, "Main Mat", 18, "Ciaran", ""),
    ("MMA Sparring",     "Supervised sparring rounds. Intermediate+.", 2, "19:00", 90, "Main Mat", 14, "Stephen", ""),
    ("K1 Kickboxing",    "High-intensity K1 striking session.", 3, "18:00", 60, "Ring Room", 16, "Danny", K1_IMG),
    ("No-Gi Grappling",  "Wrestling and submission grappling.", 3, "19:15", 75, "Main Mat", 18, "Stephen", ""),
    ("Boxing",           "Technical boxing and pad work.", 4, "18:30", 60, "Ring Room", 16, "Danny", BOX_IMG),
    ("Open Mat",         "Free training, all disciplines welcome.", 5, "11:00", 120, "Main Mat", 30, "Stephen", ""),
    ("Judo",             "Competition-style randori.", 5, "13:30", 90, "Main Mat", 18, "Ciaran", ""),
]


def req(method, path, body=None, headers=None):
    hh = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
          "Content-Type": "application/json", "Accept": "application/json"}
    if headers: hh.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(SUPABASE_URL + path, method=method, data=data, headers=hh)
    try:
        with urllib.request.urlopen(request, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}") if e.read else {"error": str(e)}


def create_user(email, password, name, role):
    payload = {
        "email": email, "password": password, "email_confirm": True,
        "user_metadata": {"name": name},
        "app_metadata": {"role": role},
    }
    code, data = req("POST", "/auth/v1/admin/users", payload)
    if code in (200, 201):
        print(f"  + Created {role} {email}: {data.get('id')}")
        return data.get("id")
    if code == 422 or (isinstance(data, dict) and ("already" in (data.get("msg","") + data.get("message","")).lower() or data.get("code") == "email_exists")):
        # Look up existing
        code2, data2 = req("GET", f"/auth/v1/admin/users?filter=email.eq.{email}")
        users = (data2 or {}).get("users", [])
        if users:
            print(f"  = Exists {role} {email}: {users[0]['id']}")
            return users[0]["id"]
    print(f"  ! Failed {email}: {code} {data}")
    return None


def main():
    print("Seeding admin…")
    admin_id = create_user(ADMIN_EMAIL, ADMIN_PASS, "Stevie", "admin")

    print("Seeding coaches…")
    coach_ids = {}
    for name, email, pw, bio, photo, perms in COACHES:
        cid = create_user(email, pw, name, "coach")
        if cid:
            coach_ids[name] = cid
            # PATCH profile with bio/photo/permissions via PostgREST
            code, data = req("PATCH", f"/rest/v1/profiles?id=eq.{cid}",
                {"bio": bio, "photo": photo, "permissions": perms},
                headers={"Prefer": "return=minimal"})
            print(f"    profile patch {email}: {code}")

    # Insert secrets + classes via PostgREST (service_role bypasses RLS)
    print("Storing SendGrid secret…")
    for k, v in [("sendgrid_api_key", SENDGRID_KEY), ("sender_email", SENDER_EMAIL)]:
        req("POST", "/rest/v1/app_secrets?on_conflict=key",
            {"key": k, "value": v},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    print("Seeding classes…")
    # Skip if any class exists
    code, existing = req("GET", "/rest/v1/classes?select=id&limit=1")
    if existing:
        print("  = Classes already present, skipping.")
    else:
        for cname, desc, dow, t, dur, room, cap, coach, img in SCHEDULE:
            req("POST", "/rest/v1/classes", {
                "name": cname, "description": desc, "day_of_week": dow,
                "start_time": t, "duration_min": dur, "room": room,
                "capacity": cap, "coach_id": coach_ids.get(coach), "image": img,
            }, headers={"Prefer": "return=minimal"})
        print(f"  + Inserted {len(SCHEDULE)} classes.")

    print("DONE.")


if __name__ == "__main__":
    main()
