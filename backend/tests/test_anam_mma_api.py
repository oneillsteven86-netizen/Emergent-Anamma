"""ANAM MMA backend API tests - covers auth, RBAC, plans/subs, schedule/bookings,
guest, private sessions, announcements, dashboard, exports, settings, waiver."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta, date as date_cls

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://anam-management.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("stevie@aipnua.com", "AnamAdmin2026!")
COACH = ("stephen@anammma.com", "Coach2026!")

# shared session-level state
state = {}


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


# --------- Auth / Waiver ---------
class TestAuth:
    def test_admin_login(self):
        data = login(*ADMIN)
        assert data["user"]["role"] == "admin"
        state["admin_token"] = data["token"]
        state["admin_id"] = data["user"]["id"]

    def test_coach_login(self):
        data = login(*COACH)
        assert data["user"]["role"] == "coach"
        state["coach_token"] = data["token"]
        state["coach_id"] = data["user"]["id"]

    def test_register_member_open(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "name": "TEST Member", "email": email, "password": "Pass1234!", "phone": "+353000"
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["role"] == "member"
        assert d["user"]["status"] == "active"  # open_registration default True
        state["member_token"] = d["token"]
        state["member_id"] = d["user"]["id"]
        state["member_email"] = email

    def test_auth_me(self):
        r = requests.get(f"{API}/auth/me", headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == state["member_email"]

    def test_accept_waiver(self):
        r = requests.post(f"{API}/auth/accept-waiver", json={"version": "1.0"},
                          headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        # verify
        me = requests.get(f"{API}/auth/me", headers=auth_header(state["member_token"]), timeout=10).json()
        assert me["waiver_accepted"] is True
        assert me["waiver_version"] == "1.0"
        assert me["waiver_accepted_at"]

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN[0], "password": "wrong"}, timeout=10)
        assert r.status_code == 400

    def test_no_token_401(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 401


# --------- Settings ---------
class TestSettings:
    def test_get_settings_public(self):
        r = requests.get(f"{API}/settings", timeout=10)
        assert r.status_code == 200
        assert "open_registration" in r.json()

    def test_update_settings_admin(self):
        r = requests.put(f"{API}/admin/settings",
                         json={"open_registration": True, "cancellation_window_hours": 2},
                         headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["cancellation_window_hours"] == 2

    def test_settings_forbidden_member(self):
        r = requests.put(f"{API}/admin/settings", json={"open_registration": True},
                         headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 403


# --------- RBAC ---------
class TestRBAC:
    def test_member_cannot_list_users(self):
        r = requests.get(f"{API}/users", headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 403

    def test_member_cannot_dashboard(self):
        r = requests.get(f"{API}/admin/dashboard", headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 403

    def test_member_cannot_create_plan(self):
        r = requests.post(f"{API}/plans",
                          json={"name": "X", "price": 1, "type": "monthly", "duration_days": 30},
                          headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 403

    def test_member_cannot_export(self):
        r = requests.get(f"{API}/export/members.csv", headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 403


# --------- Plans / Subscriptions / Payments ---------
class TestPlansSubs:
    def test_list_plans(self):
        r = requests.get(f"{API}/plans", timeout=10)
        assert r.status_code == 200
        plans = r.json()
        assert len(plans) > 0
        state["plan_id"] = plans[0]["id"]
        state["plan_price"] = plans[0]["price"]

    def test_create_plan_admin(self):
        r = requests.post(f"{API}/plans",
                          json={"name": "TEST Plan", "price": 25.0, "type": "trial",
                                "duration_days": 7, "description": "test"},
                          headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        state["created_plan_id"] = r.json()["id"]

    def test_create_subscription(self):
        r = requests.post(f"{API}/subscriptions",
                          json={"user_id": state["member_id"], "plan_id": state["plan_id"], "mark_paid": False},
                          headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200, r.text
        sub = r.json()
        assert sub["status"] == "pending_payment"
        state["sub_id"] = sub["id"]

    def test_mark_paid_creates_payment(self):
        r = requests.post(f"{API}/subscriptions/{state['sub_id']}/mark-paid",
                          headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "active"
        # verify payment exists
        pays = requests.get(f"{API}/payments/me",
                            headers=auth_header(state["member_token"]), timeout=10).json()
        assert any(p["subscription_id"] == state["sub_id"] for p in pays)
        state["payment_id"] = next(p["id"] for p in pays if p["subscription_id"] == state["sub_id"])

    def test_receipt(self):
        r = requests.get(f"{API}/payments/{state['payment_id']}/receipt",
                         headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["receipt_no"].startswith("ANAM-")

    def test_freeze_resume_extends_end_date(self):
        sub = next(s for s in requests.get(f"{API}/subscriptions/me",
                   headers=auth_header(state["member_token"])).json() if s["id"] == state["sub_id"])
        orig_end = sub["end_date"]
        r = requests.post(f"{API}/subscriptions/{state['sub_id']}/freeze",
                          headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "frozen"
        r2 = requests.post(f"{API}/subscriptions/{state['sub_id']}/resume",
                           headers=auth_header(state["admin_token"]), timeout=10)
        assert r2.status_code == 200
        # frozen same day => extension 0; just confirm not earlier
        assert r2.json()["end_date"] >= orig_end


# --------- Schedule / Bookings ---------
class TestScheduleBookings:
    def _pick_future_date_with_class(self):
        """Find a future date (>=2 days ahead) that has at least one class scheduled.
        Returns (date_str, class_obj)."""
        for offset in range(2, 10):
            d = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
            r = requests.get(f"{API}/schedule", params={"date": d},
                             headers=auth_header(state["member_token"]), timeout=10)
            assert r.status_code == 200
            cls = r.json()
            if cls:
                return d, cls[0]
        pytest.skip("No classes scheduled in 10 days window")

    def test_schedule_returns_seeded_classes(self):
        d, cls = self._pick_future_date_with_class()
        state["book_date"] = d
        state["book_class"] = cls
        assert cls["id"] and cls["name"]

    def test_create_booking(self):
        r = requests.post(f"{API}/bookings",
                          json={"class_id": state["book_class"]["id"], "date": state["book_date"]},
                          headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "booked"
        state["booking_id"] = b["id"]

    def test_duplicate_booking_rejected(self):
        r = requests.post(f"{API}/bookings",
                          json={"class_id": state["book_class"]["id"], "date": state["book_date"]},
                          headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 400

    def test_my_bookings_includes_new(self):
        r = requests.get(f"{API}/bookings/me", headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        assert any(b["id"] == state["booking_id"] for b in r.json())

    def test_coach_roster(self):
        r = requests.get(f"{API}/classes/{state['book_class']['id']}/roster",
                         params={"date": state["book_date"]},
                         headers=auth_header(state["coach_token"]), timeout=10)
        assert r.status_code == 200
        assert any(b["id"] == state["booking_id"] for b in r.json())

    def test_coach_checkin(self):
        r = requests.post(f"{API}/bookings/{state['booking_id']}/checkin",
                          json={"attended": True},
                          headers=auth_header(state["coach_token"]), timeout=10)
        assert r.status_code == 200

    def test_cancel_booking(self):
        # Note: checkin set status to "attended"; cancel will still set "cancelled"
        # create a fresh booking on another date so cancel is meaningful
        # use offset further ahead
        for offset in range(3, 12):
            d = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
            sched = requests.get(f"{API}/schedule", params={"date": d},
                                 headers=auth_header(state["member_token"])).json()
            if sched:
                # pick a class not yet booked
                target = next((c for c in sched if not c.get("my_booking")), None)
                if not target:
                    continue
                br = requests.post(f"{API}/bookings",
                                   json={"class_id": target["id"], "date": d},
                                   headers=auth_header(state["member_token"]), timeout=10)
                if br.status_code != 200:
                    continue
                bid = br.json()["id"]
                cr = requests.delete(f"{API}/bookings/{bid}",
                                     headers=auth_header(state["member_token"]), timeout=10)
                assert cr.status_code == 200
                return
        pytest.skip("Couldn't set up cancel scenario")


# --------- Guest Booking ---------
class TestGuest:
    def test_guest_booking_no_auth(self):
        # find a future date with a class
        for offset in range(2, 10):
            d = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
            sched = requests.get(f"{API}/schedule", params={"date": d}).json()
            if sched:
                cid = sched[0]["id"]
                r = requests.post(f"{API}/guest-bookings",
                                  json={"class_id": cid, "date": d,
                                        "name": "TEST Guest", "email": f"guest_{uuid.uuid4().hex[:6]}@x.com"},
                                  timeout=10)
                assert r.status_code == 200, r.text
                assert r.json()["status"] in ("booked", "waitlist")
                state["guest_class_id"] = cid
                return
        pytest.skip("no class")

    def test_public_class_endpoint(self):
        r = requests.get(f"{API}/public/classes/{state['guest_class_id']}", timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == state["guest_class_id"]


# --------- Private Sessions ---------
class TestPrivateSessions:
    def test_member_creates_request(self):
        d = (datetime.now(timezone.utc).date() + timedelta(days=5)).isoformat()
        r = requests.post(f"{API}/private-sessions",
                          json={"coach_id": state["coach_id"], "date": d, "time": "10:00",
                                "notes": "TEST"},
                          headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "requested"
        state["ps_id"] = r.json()["id"]

    def test_coach_confirms(self):
        r = requests.put(f"{API}/private-sessions/{state['ps_id']}",
                         json={"status": "confirmed"},
                         headers=auth_header(state["coach_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "confirmed"


# --------- Announcements / Notifications ---------
class TestAnnouncements:
    def test_create_announcement_all(self):
        r = requests.post(f"{API}/announcements",
                          json={"title": "TEST Announce", "body": "hello", "audience": "all"},
                          headers=auth_header(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["recipients"] >= 1

    def test_member_notifications_received(self):
        r = requests.get(f"{API}/notifications",
                         headers=auth_header(state["member_token"]), timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any("TEST Announce" in i.get("title", "") for i in items)


# --------- Admin Dashboard / Exports / Users ---------
class TestAdmin:
    def test_dashboard(self):
        r = requests.get(f"{API}/admin/dashboard", headers=auth_header(state["admin_token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("active_members", "pending_approvals", "new_signups", "revenue_month",
                  "expiring", "todays_classes", "attendance_today"):
            assert k in d

    def test_export_members(self):
        r = requests.get(f"{API}/export/members.csv", headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert "Name" in r.text.splitlines()[0]

    def test_export_payments(self):
        r = requests.get(f"{API}/export/payments.csv", headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert "Receipt" in r.text.splitlines()[0]

    def test_list_users(self):
        r = requests.get(f"{API}/users", headers=auth_header(state["admin_token"]), timeout=10)
        assert r.status_code == 200
        assert any(u["id"] == state["member_id"] for u in r.json())

    def test_class_cancel_date_notifies(self):
        # Book first, then cancel that class for that date
        for offset in range(2, 10):
            d = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
            sched = requests.get(f"{API}/schedule", params={"date": d}).json()
            if sched:
                # create a fresh member to book
                email = f"cxlt_{uuid.uuid4().hex[:6]}@x.com"
                reg = requests.post(f"{API}/auth/register",
                                    json={"name": "Cancel Test", "email": email, "password": "Pass1234!"},
                                    timeout=10).json()
                tok = reg["token"]
                # pick class not booked
                target = next((c for c in sched), None)
                br = requests.post(f"{API}/bookings",
                                   json={"class_id": target["id"], "date": d},
                                   headers=auth_header(tok), timeout=10)
                if br.status_code != 200:
                    continue
                cr = requests.post(f"{API}/classes/{target['id']}/cancel-date",
                                   json={"date": d, "reason": "TEST cancel"},
                                   headers=auth_header(state["admin_token"]), timeout=10)
                assert cr.status_code == 200
                assert cr.json()["notified"] >= 1
                return
        pytest.skip("no class")
