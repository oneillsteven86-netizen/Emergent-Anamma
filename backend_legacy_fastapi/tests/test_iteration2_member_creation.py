"""Iteration 2 tests: cash-friendly front-desk member creation flow.

Tests:
- POST /api/users/member with plan_id + mark_paid=true => user + active sub + payment + temp_password
- POST /api/users/member without plan => just user
- POST /api/users/member duplicate email => 400
- POST /api/users/member with member token => 403
- POST /api/subscriptions with mark_paid=true => immediately active + payment record created
"""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://anam-management.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("stevie@aipnua.com", "AnamAdmin2026!")

state = {}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()


# ------------------------------ Setup ------------------------------
class TestSetup:
    def test_admin_login_and_pick_plan(self):
        d = login(*ADMIN)
        state["admin_token"] = d["token"]
        # pick first available plan
        plans = requests.get(f"{API}/plans", timeout=10).json()
        assert len(plans) > 0, "no plans seeded"
        state["plan_id"] = plans[0]["id"]
        state["plan_name"] = plans[0]["name"]
        state["plan_price"] = plans[0]["price"]

    def test_register_member_for_rbac(self):
        email = f"test_member_rbac_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "name": "TEST RBAC Member", "email": email, "password": "Pass1234!"
        }, timeout=15)
        assert r.status_code == 200, r.text
        state["member_token"] = r.json()["token"]


# ------------------------------ POST /api/users/member ------------------------------
class TestCreateMember:
    def test_create_member_with_plan_and_cash(self):
        """Front-desk happy path: create member + plan + mark_paid=true in one call."""
        email = f"test_cash_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users/member", json={
            "name": "TEST Cash Walkin",
            "email": email,
            "phone": "+353000000",
            "plan_id": state["plan_id"],
            "mark_paid": True,
        }, headers=auth(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # user payload
        assert body["user"]["email"] == email
        assert body["user"]["role"] == "member"
        assert body["user"]["status"] == "active"
        assert "password_hash" not in body["user"]
        assert "_id" not in body["user"]
        # temp password issued
        assert body["temp_password"] and len(body["temp_password"]) >= 6
        # subscription is ACTIVE (mark_paid worked)
        assert body["subscription"] is not None
        assert body["subscription"]["status"] == "active", body["subscription"]
        assert body["subscription"]["plan_id"] == state["plan_id"]
        state["cash_member_id"] = body["user"]["id"]
        state["cash_member_email"] = email
        state["cash_temp_password"] = body["temp_password"]
        state["cash_sub_id"] = body["subscription"]["id"]

        # verify payment created
        pays = requests.get(f"{API}/payments",
                            params={"user_id": state["cash_member_id"]},
                            headers=auth(state["admin_token"]), timeout=10)
        assert pays.status_code == 200
        matches = [p for p in pays.json() if p["subscription_id"] == state["cash_sub_id"]]
        assert len(matches) == 1, f"expected 1 payment, got {matches}"
        assert matches[0]["method"] == "cash"
        assert matches[0]["amount"] == state["plan_price"]
        assert matches[0]["receipt_no"].startswith("ANAM-")

    def test_temp_password_lets_member_login(self):
        """Sanity: the temp_password returned actually works for login."""
        r = requests.post(f"{API}/auth/login", json={
            "email": state["cash_member_email"],
            "password": state["cash_temp_password"],
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == state["cash_member_email"]

    def test_create_member_without_plan(self):
        """No plan => user only, no subscription."""
        email = f"test_noplan_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users/member", json={
            "name": "TEST NoPlan",
            "email": email,
        }, headers=auth(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == email
        assert body["subscription"] is None
        assert body["temp_password"]
        state["noplan_member_id"] = body["user"]["id"]
        state["noplan_email"] = email

    def test_duplicate_email_rejected(self):
        r = requests.post(f"{API}/users/member", json={
            "name": "Dup",
            "email": state["cash_member_email"],
        }, headers=auth(state["admin_token"]), timeout=10)
        assert r.status_code == 400, r.text
        assert "already" in r.text.lower() or "registered" in r.text.lower()

    def test_member_token_forbidden(self):
        r = requests.post(f"{API}/users/member", json={
            "name": "X",
            "email": f"test_block_{uuid.uuid4().hex[:6]}@example.com",
        }, headers=auth(state["member_token"]), timeout=10)
        assert r.status_code == 403

    def test_create_member_plan_no_cash(self):
        """plan_id but mark_paid=false => sub pending_payment (€ due badge case)."""
        email = f"test_due_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users/member", json={
            "name": "TEST Due Member",
            "email": email,
            "plan_id": state["plan_id"],
            "mark_paid": False,
        }, headers=auth(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["subscription"] is not None
        assert body["subscription"]["status"] == "pending_payment"
        state["due_member_id"] = body["user"]["id"]
        state["due_sub_id"] = body["subscription"]["id"]


# ------------------------------ POST /api/subscriptions mark_paid ------------------------------
class TestSubscriptionMarkPaidFlag:
    def test_create_subscription_with_mark_paid_true(self):
        """POST /api/subscriptions with mark_paid=true should return active sub + record payment."""
        # use the no-plan member from above
        r = requests.post(f"{API}/subscriptions", json={
            "user_id": state["noplan_member_id"],
            "plan_id": state["plan_id"],
            "mark_paid": True,
        }, headers=auth(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        sub = r.json()
        assert sub["status"] == "active", sub
        assert sub["user_id"] == state["noplan_member_id"]
        sub_id = sub["id"]
        # verify payment row created
        pays = requests.get(f"{API}/payments",
                            params={"user_id": state["noplan_member_id"]},
                            headers=auth(state["admin_token"]), timeout=10).json()
        matches = [p for p in pays if p["subscription_id"] == sub_id]
        assert len(matches) == 1
        assert matches[0]["method"] == "cash"

    def test_create_subscription_mark_paid_false_default(self):
        """Without mark_paid (default false), sub stays pending_payment."""
        # create a fresh member with no plan
        email = f"test_subdefault_{uuid.uuid4().hex[:6]}@example.com"
        m = requests.post(f"{API}/users/member", json={"name": "TEST Default Sub", "email": email},
                          headers=auth(state["admin_token"]), timeout=15).json()
        r = requests.post(f"{API}/subscriptions", json={
            "user_id": m["user"]["id"],
            "plan_id": state["plan_id"],
        }, headers=auth(state["admin_token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending_payment"


# ------------------------------ Member booking sanity ------------------------------
class TestMemberBookingSanity:
    def test_cash_member_can_view_schedule(self):
        """Cash-created member with active sub should be able to fetch schedule."""
        # login as the cash member
        login_r = requests.post(f"{API}/auth/login", json={
            "email": state["cash_member_email"],
            "password": state["cash_temp_password"],
        }, timeout=10)
        assert login_r.status_code == 200
        token = login_r.json()["token"]
        # accept waiver (required to book typically)
        requests.post(f"{API}/auth/accept-waiver", json={"version": "1.0"},
                      headers=auth(token), timeout=10)
        # fetch upcoming schedule
        from datetime import datetime, timezone, timedelta
        d = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
        r = requests.get(f"{API}/schedule", params={"date": d},
                         headers=auth(token), timeout=10)
        assert r.status_code == 200
        # don't strictly require classes on that day
