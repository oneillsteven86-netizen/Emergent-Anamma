from fastapi import FastAPI, APIRouter, HTTPException, Depends, BackgroundTasks, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date as date_cls
from pwdlib import PasswordHash
import jwt
import os
import io
import csv
import uuid
import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = os.environ['JWT_ALGORITHM']
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', '')

pwd = PasswordHash.recommended()
security = HTTPBearer(auto_error=False)

app = FastAPI(title="ANAM MMA API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anam")

WAIVER_VERSION = "1.0"
WAIVER_TEXT = (
    "ANAM MMA LIABILITY WAIVER (v1.0)\n\n"
    "I acknowledge that participation in mixed martial arts, boxing, K1, judo and related training at ANAM MMA "
    "involves inherent risks of injury. I voluntarily assume all risks associated with training. I release ANAM MMA, "
    "its coaches and staff from liability for injuries sustained during normal training activities, except where caused "
    "by gross negligence. I confirm I am physically fit to participate and have disclosed any relevant medical conditions. "
    "I consent to receive first aid / emergency treatment if required. This waiver is governed by the laws of Ireland."
)

# ---------------- helpers ----------------

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def new_id():
    return str(uuid.uuid4())

def today_str():
    return datetime.now(timezone.utc).date().isoformat()


def send_email_task(to: str, subject: str, body_html: str, reply_to: Optional[str] = None):
    if not SENDGRID_API_KEY or not SENDER_EMAIL or not to:
        return
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, ReplyTo
        msg = Mail(from_email=SENDER_EMAIL, to_emails=to, subject=subject, html_content=body_html)
        if reply_to:
            msg.reply_to = ReplyTo(reply_to)
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(msg)
        logger.info(f"Email to {to}: {resp.status_code}")
    except Exception as e:
        logger.error(f"SendGrid error: {e}")


async def get_settings_doc():
    s = await db.settings.find_one({"id": "club"}, {"_id": 0})
    return s


async def notify(user_id: str, title: str, body: str, ntype: str = "general"):
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user_id, "title": title, "body": body,
        "type": ntype, "read": False, "created_at": now_iso()
    })


async def notify_admins(title: str, body: str, ntype: str = "admin"):
    admins = await db.users.find({"role": "admin"}, {"_id": 0, "id": 1}).to_list(50)
    for a in admins:
        await notify(a["id"], title, body, ntype)

# ---------------- auth ----------------

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def require_perm(perm: str):
    async def checker(user=Depends(get_current_user)):
        if user["role"] == "admin":
            return user
        if user["role"] == "coach" and user.get("permissions", {}).get(perm):
            return user
        raise HTTPException(403, "Not permitted")
    return checker


def make_token(user_id: str, role: str):
    payload = {"sub": user_id, "role": role, "exp": datetime.now(timezone.utc) + timedelta(days=14)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

# ---------------- models ----------------

class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    phone: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class WaiverIn(BaseModel):
    version: str

class ProfileIn(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    medical_notes: Optional[str] = None

class CoachIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    bio: Optional[str] = ""
    photo: Optional[str] = ""
    permissions: Dict[str, bool] = {}

class MemberCreateIn(BaseModel):
    name: str
    email: EmailStr
    password: Optional[str] = None
    phone: Optional[str] = None
    plan_id: Optional[str] = None
    mark_paid: bool = False

class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None
    admin_notes: Optional[str] = None
    bio: Optional[str] = None
    photo: Optional[str] = None
    permissions: Optional[Dict[str, bool]] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    medical_notes: Optional[str] = None

class PlanIn(BaseModel):
    name: str
    price: float
    type: str  # monthly | trial | class_pack
    duration_days: int = 30
    sessions: Optional[int] = None
    description: Optional[str] = ""

class SubscriptionIn(BaseModel):
    user_id: str
    plan_id: str
    start_date: Optional[str] = None
    mark_paid: bool = False

class ClassIn(BaseModel):
    name: str
    description: Optional[str] = ""
    day_of_week: int  # 0=Mon
    start_time: str   # "18:00"
    duration_min: int = 60
    room: str = "Main Mat"
    capacity: int = 20
    coach_id: Optional[str] = None
    image: Optional[str] = ""

class BookingIn(BaseModel):
    class_id: str
    date: str

class GuestBookingIn(BaseModel):
    class_id: str
    date: str
    name: str
    email: EmailStr

class PrivateSessionIn(BaseModel):
    coach_id: str
    date: str
    time: str
    notes: Optional[str] = ""

class PrivateSessionUpdate(BaseModel):
    status: str  # confirmed | declined | cancelled

class AnnouncementIn(BaseModel):
    title: str
    body: str
    audience: str = "all"  # all | class
    class_id: Optional[str] = None

class SettingsIn(BaseModel):
    open_registration: Optional[bool] = None
    cancellation_window_hours: Optional[int] = None
    private_session_policy: Optional[str] = None
    club_email: Optional[str] = None

class MediaIn(BaseModel):
    key: str  # login_bg | logo | banner
    image: str  # base64 data uri or url

class CancelDateIn(BaseModel):
    date: str
    reason: Optional[str] = "Class cancelled"

# ---------------- auth routes ----------------

@api.post("/auth/register")
async def register(body: RegisterIn, bg: BackgroundTasks):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(400, "Email already registered")
    settings = await get_settings_doc()
    open_reg = settings.get("open_registration", True) if settings else True
    user = {
        "id": new_id(), "name": body.name, "email": body.email.lower(),
        "password_hash": pwd.hash(body.password), "phone": body.phone or "",
        "role": "member", "status": "active" if open_reg else "pending",
        "waiver_accepted": False, "waiver_version": None, "waiver_accepted_at": None,
        "emergency_contact_name": "", "emergency_contact_phone": "", "medical_notes": "",
        "admin_notes": "", "permissions": {}, "bio": "", "photo": "",
        "deletion_requested": False, "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    await notify_admins("New signup", f"{body.name} ({body.email}) just registered" + ("" if open_reg else " and awaits approval"), "signup")
    bg.add_task(send_email_task, body.email, "Welcome to ANAM MMA",
                f"<h2>Welcome to ANAM MMA, {body.name}!</h2><p>Your account has been created."
                + ("" if open_reg else " It is pending admin approval — you'll be notified once approved.")
                + "</p><p>Train hard. See you on the mats.</p>")
    token = make_token(user["id"], "member")
    user.pop("password_hash")
    user.pop("_id", None)
    return {"token": token, "user": user}


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(400, "Incorrect email or password")
    if user.get("status") == "removed":
        raise HTTPException(403, "Account deactivated")
    token = make_token(user["id"], user["role"])
    user.pop("password_hash")
    user.pop("_id", None)
    return {"token": token, "user": user}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api.post("/auth/accept-waiver")
async def accept_waiver(body: WaiverIn, user=Depends(get_current_user)):
    ts = now_iso()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "waiver_accepted": True, "waiver_version": body.version, "waiver_accepted_at": ts}})
    await db.waiver_log.insert_one({"id": new_id(), "user_id": user["id"], "user_email": user["email"],
                                    "version": body.version, "accepted_at": ts})
    return {"ok": True, "accepted_at": ts}


@api.put("/auth/profile")
async def update_profile(body: ProfileIn, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "password"}
    if body.email:
        other = await db.users.find_one({"email": body.email.lower(), "id": {"$ne": user["id"]}})
        if other:
            raise HTTPException(400, "Email already in use")
        updates["email"] = body.email.lower()
    if body.password:
        updates["password_hash"] = pwd.hash(body.password)
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return u


@api.post("/auth/request-deletion")
async def request_deletion(user=Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"deletion_requested": True}})
    await notify_admins("GDPR deletion request", f"{user['name']} ({user['email']}) requested account/data deletion", "gdpr")
    return {"ok": True}


@api.get("/legal/waiver")
async def get_waiver():
    return {"version": WAIVER_VERSION, "text": WAIVER_TEXT}

# ---------------- users (admin / manage_members) ----------------

@api.get("/users")
async def list_users(role: Optional[str] = None, status_f: Optional[str] = None,
                     user=Depends(require_perm("manage_members"))):
    q: Dict[str, Any] = {}
    if role:
        q["role"] = role
    if status_f:
        q["status"] = status_f
    users = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
    return users


@api.get("/users/{user_id}")
async def get_user(user_id: str, user=Depends(require_perm("manage_members"))):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "User not found")
    return u


@api.put("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdateIn, bg: BackgroundTasks,
                      user=Depends(require_perm("manage_members"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    updates = body.model_dump(exclude_none=True)
    if "role" in updates and user["role"] != "admin":
        raise HTTPException(403, "Only admin can change roles")
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    if body.status == "active" and target.get("status") == "pending":
        await notify(user_id, "Account approved", "Your ANAM MMA membership request has been approved. Welcome!", "approval")
        bg.add_task(send_email_task, target["email"], "ANAM MMA — Account Approved",
                    f"<p>Hi {target['name']}, your account has been approved. See you at the club!</p>")
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_admin)):
    await db.users.delete_one({"id": user_id})
    await db.bookings.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"user_id": user_id})
    await db.subscriptions.delete_many({"user_id": user_id})
    return {"ok": True}


@api.post("/users/{user_id}/promote-admin")
async def promote_admin(user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": user_id}, {"$set": {"role": "admin"}})
    await notify(user_id, "Admin access granted", "You are now an admin of ANAM MMA.", "role")
    return {"ok": True}


@api.post("/users/member")
async def create_member(body: MemberCreateIn, bg: BackgroundTasks, user=Depends(require_perm("manage_members"))):
    """Front-desk (cash-friendly) member creation: account + optional plan + optional cash payment in one go."""
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(400, "Email already registered")
    temp_password = body.password or f"Anam{str(uuid.uuid4())[:6]}"
    member = {
        "id": new_id(), "name": body.name, "email": body.email.lower(),
        "password_hash": pwd.hash(temp_password), "phone": body.phone or "",
        "role": "member", "status": "active",
        "waiver_accepted": False, "waiver_version": None, "waiver_accepted_at": None,
        "emergency_contact_name": "", "emergency_contact_phone": "", "medical_notes": "",
        "admin_notes": "Added at front desk", "permissions": {}, "bio": "", "photo": "",
        "deletion_requested": False, "created_at": now_iso(),
    }
    await db.users.insert_one(member)
    member.pop("password_hash")
    member.pop("_id", None)
    subscription = None
    if body.plan_id:
        plan = await db.plans.find_one({"id": body.plan_id}, {"_id": 0})
        if not plan:
            raise HTTPException(404, "Plan not found")
        start = today_str()
        end = (date_cls.fromisoformat(start) + timedelta(days=plan["duration_days"])).isoformat()
        subscription = {
            "id": new_id(), "user_id": member["id"], "user_name": member["name"], "plan_id": plan["id"],
            "plan_name": plan["name"], "plan_type": plan["type"], "price": plan["price"],
            "start_date": start, "end_date": end, "status": "pending_payment",
            "sessions_remaining": plan.get("sessions"), "reminder_sent": False,
            "frozen_at": None, "created_at": now_iso(),
        }
        await db.subscriptions.insert_one(subscription)
        subscription.pop("_id", None)
        if body.mark_paid:
            subscription = await _mark_paid(subscription["id"], bg)
    bg.add_task(send_email_task, member["email"], "Welcome to ANAM MMA",
                f"<h2>Welcome to ANAM MMA, {body.name}!</h2><p>Your account is ready. "
                f"Log in with this email and your password{' (temporary: ' + temp_password + ')' if not body.password else ''}.</p>")
    return {"user": member, "temp_password": temp_password, "subscription": subscription}


@api.post("/users/coach")
async def create_coach(body: CoachIn, admin=Depends(require_admin)):
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(400, "Email already registered")
    coach = {
        "id": new_id(), "name": body.name, "email": body.email.lower(),
        "password_hash": pwd.hash(body.password), "phone": "", "role": "coach", "status": "active",
        "waiver_accepted": True, "waiver_version": WAIVER_VERSION, "waiver_accepted_at": now_iso(),
        "emergency_contact_name": "", "emergency_contact_phone": "", "medical_notes": "",
        "admin_notes": "", "permissions": body.permissions, "bio": body.bio, "photo": body.photo,
        "deletion_requested": False, "created_at": now_iso(),
    }
    await db.users.insert_one(coach)
    coach.pop("password_hash")
    coach.pop("_id", None)
    return coach


@api.get("/coaches")
async def list_coaches():
    coaches = await db.users.find({"role": {"$in": ["coach", "admin"]}, "status": "active"},
                                  {"_id": 0, "id": 1, "name": 1, "bio": 1, "photo": 1, "role": 1}).to_list(100)
    return coaches


@api.get("/users/{user_id}/attendance")
async def user_attendance(user_id: str, user=Depends(get_current_user)):
    if user["id"] != user_id and user["role"] == "member":
        raise HTTPException(403, "Not permitted")
    bookings = await db.bookings.find({"user_id": user_id, "status": {"$in": ["attended", "booked", "no_show"]}},
                                      {"_id": 0}).sort("date", -1).to_list(500)
    return bookings

# ---------------- exports ----------------

@api.get("/export/members.csv", response_class=PlainTextResponse)
async def export_members(admin=Depends(require_admin)):
    users = await db.users.find({"role": "member"}, {"_id": 0, "password_hash": 0}).to_list(5000)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Name", "Email", "Phone", "Status", "Waiver", "Joined", "Emergency Contact", "Emergency Phone"])
    for u in users:
        w.writerow([u["name"], u["email"], u.get("phone", ""), u["status"],
                    f"v{u.get('waiver_version')}" if u.get("waiver_accepted") else "no",
                    u.get("created_at", "")[:10], u.get("emergency_contact_name", ""), u.get("emergency_contact_phone", "")])
    return out.getvalue()


@api.get("/export/payments.csv", response_class=PlainTextResponse)
async def export_payments(admin=Depends(require_admin)):
    payments = await db.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Receipt", "Date", "Member", "Plan", "Amount", "Method"])
    for p in payments:
        w.writerow([p["receipt_no"], p["created_at"][:10], p["user_name"], p["plan_name"], p["amount"], p["method"]])
    return out.getvalue()

# ---------------- plans ----------------

@api.get("/plans")
async def list_plans():
    return await db.plans.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(100)


@api.post("/plans")
async def create_plan(body: PlanIn, admin=Depends(require_admin)):
    plan = {"id": new_id(), **body.model_dump(), "archived": False, "created_at": now_iso()}
    await db.plans.insert_one(plan)
    plan.pop("_id", None)
    return plan


@api.put("/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanIn, admin=Depends(require_admin)):
    await db.plans.update_one({"id": plan_id}, {"$set": body.model_dump()})
    return await db.plans.find_one({"id": plan_id}, {"_id": 0})


@api.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, admin=Depends(require_admin)):
    await db.plans.update_one({"id": plan_id}, {"$set": {"archived": True}})
    return {"ok": True}

# ---------------- subscriptions & payments ----------------

async def check_expiries():
    today = today_str()
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    expired = await db.subscriptions.find({"status": {"$in": ["active", "frozen"]}, "end_date": {"$lt": today}}).to_list(500)
    for s in expired:
        await db.subscriptions.update_one({"id": s["id"]}, {"$set": {"status": "expired"}})
        await notify(s["user_id"], "Membership expired", "Your membership has expired. Contact the club or renew to keep training.", "membership")
    reminders = await db.subscriptions.find({"status": "active", "end_date": {"$lte": soon, "$gte": today},
                                             "reminder_sent": {"$ne": True}}).to_list(500)
    for s in reminders:
        await db.subscriptions.update_one({"id": s["id"]}, {"$set": {"reminder_sent": True}})
        await notify(s["user_id"], "Membership expiring soon",
                     f"Your membership expires on {s['end_date']}. Renew soon to avoid interruption.", "membership")


@api.post("/subscriptions")
async def create_subscription(body: SubscriptionIn, bg: BackgroundTasks, user=Depends(require_perm("manage_members"))):
    plan = await db.plans.find_one({"id": body.plan_id}, {"_id": 0})
    target = await db.users.find_one({"id": body.user_id}, {"_id": 0, "password_hash": 0})
    if not plan or not target:
        raise HTTPException(404, "Plan or user not found")
    start = body.start_date or today_str()
    end = (date_cls.fromisoformat(start) + timedelta(days=plan["duration_days"])).isoformat()
    sub = {
        "id": new_id(), "user_id": body.user_id, "user_name": target["name"], "plan_id": plan["id"],
        "plan_name": plan["name"], "plan_type": plan["type"], "price": plan["price"],
        "start_date": start, "end_date": end, "status": "pending_payment",
        "sessions_remaining": plan.get("sessions"), "reminder_sent": False,
        "frozen_at": None, "created_at": now_iso(),
    }
    await db.subscriptions.insert_one(sub)
    sub.pop("_id", None)
    if body.mark_paid:
        return await _mark_paid(sub["id"], bg)
    return sub


async def _mark_paid(sub_id: str, bg: BackgroundTasks):
    sub = await db.subscriptions.find_one({"id": sub_id}, {"_id": 0})
    if not sub:
        raise HTTPException(404, "Subscription not found")
    receipt_no = f"ANAM-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"
    payment = {
        "id": new_id(), "subscription_id": sub_id, "user_id": sub["user_id"], "user_name": sub["user_name"],
        "plan_name": sub["plan_name"], "amount": sub["price"], "method": "cash",
        "receipt_no": receipt_no, "created_at": now_iso(),
    }
    await db.payments.insert_one(payment)
    await db.subscriptions.update_one({"id": sub_id}, {"$set": {"status": "active"}})
    await notify(sub["user_id"], "Payment confirmed",
                 f"Your {sub['plan_name']} payment of €{sub['price']:.2f} has been received. Receipt {receipt_no}.", "payment")
    member = await db.users.find_one({"id": sub["user_id"]}, {"_id": 0, "email": 1, "name": 1})
    if member:
        bg.add_task(send_email_task, member["email"], "ANAM MMA — Payment Confirmation",
                    f"<p>Hi {member['name']},</p><p>Payment of <b>€{sub['price']:.2f}</b> for <b>{sub['plan_name']}</b> received."
                    f"<br/>Receipt: {receipt_no}<br/>Valid until {sub['end_date']}</p>")
    sub = await db.subscriptions.find_one({"id": sub_id}, {"_id": 0})
    return sub


@api.post("/subscriptions/{sub_id}/mark-paid")
async def mark_paid(sub_id: str, bg: BackgroundTasks, user=Depends(require_perm("manage_members"))):
    return await _mark_paid(sub_id, bg)


@api.post("/subscriptions/{sub_id}/freeze")
async def freeze_sub(sub_id: str, user=Depends(require_perm("manage_members"))):
    sub = await db.subscriptions.find_one({"id": sub_id})
    if not sub or sub["status"] != "active":
        raise HTTPException(400, "Only active subscriptions can be frozen")
    await db.subscriptions.update_one({"id": sub_id}, {"$set": {"status": "frozen", "frozen_at": today_str()}})
    await notify(sub["user_id"], "Membership frozen", "Your membership has been paused. The end date will be extended when resumed.", "membership")
    return await db.subscriptions.find_one({"id": sub_id}, {"_id": 0})


@api.post("/subscriptions/{sub_id}/resume")
async def resume_sub(sub_id: str, user=Depends(require_perm("manage_members"))):
    sub = await db.subscriptions.find_one({"id": sub_id})
    if not sub or sub["status"] != "frozen":
        raise HTTPException(400, "Subscription is not frozen")
    frozen_days = (date_cls.fromisoformat(today_str()) - date_cls.fromisoformat(sub["frozen_at"])).days
    new_end = (date_cls.fromisoformat(sub["end_date"]) + timedelta(days=max(frozen_days, 0))).isoformat()
    await db.subscriptions.update_one({"id": sub_id}, {"$set": {"status": "active", "frozen_at": None, "end_date": new_end}})
    await notify(sub["user_id"], "Membership resumed", f"Your membership is active again. New end date: {new_end}.", "membership")
    return await db.subscriptions.find_one({"id": sub_id}, {"_id": 0})


@api.get("/subscriptions/me")
async def my_subscriptions(user=Depends(get_current_user)):
    await check_expiries()
    return await db.subscriptions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.get("/subscriptions")
async def list_subscriptions(expiring: bool = False, user_id: Optional[str] = None,
                             user=Depends(require_perm("manage_members"))):
    await check_expiries()
    q: Dict[str, Any] = {}
    if user_id:
        q["user_id"] = user_id
    if expiring:
        soon = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
        q.update({"status": "active", "end_date": {"$lte": soon}})
    return await db.subscriptions.find(q, {"_id": 0}).sort("end_date", 1).to_list(500)


@api.get("/payments/me")
async def my_payments(user=Depends(get_current_user)):
    return await db.payments.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.get("/payments")
async def list_payments(user=Depends(require_perm("manage_members"))):
    return await db.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.get("/payments/{payment_id}/receipt")
async def payment_receipt(payment_id: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Payment not found")
    if user["role"] == "member" and p["user_id"] != user["id"]:
        raise HTTPException(403, "Not permitted")
    settings = await get_settings_doc()
    return {"receipt_no": p["receipt_no"], "date": p["created_at"][:10], "member": p["user_name"],
            "plan": p["plan_name"], "amount": p["amount"], "method": p["method"],
            "club": "ANAM MMA", "club_email": (settings or {}).get("club_email", "")}

# ---------------- classes & schedule ----------------

@api.get("/classes")
async def list_classes():
    classes = await db.classes.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(200)
    coaches = {c["id"]: c for c in await db.users.find({"role": {"$in": ["coach", "admin"]}},
                                                       {"_id": 0, "id": 1, "name": 1, "photo": 1, "bio": 1}).to_list(100)}
    for c in classes:
        coach = coaches.get(c.get("coach_id"))
        c["coach"] = {"id": coach["id"], "name": coach["name"], "photo": coach.get("photo", ""), "bio": coach.get("bio", "")} if coach else None
    return classes


@api.post("/classes")
async def create_class(body: ClassIn, user=Depends(require_perm("manage_timetable"))):
    cls = {"id": new_id(), **body.model_dump(), "archived": False, "created_at": now_iso()}
    await db.classes.insert_one(cls)
    cls.pop("_id", None)
    return cls


@api.put("/classes/{class_id}")
async def update_class(class_id: str, body: ClassIn, user=Depends(require_perm("manage_timetable"))):
    await db.classes.update_one({"id": class_id}, {"$set": body.model_dump()})
    return await db.classes.find_one({"id": class_id}, {"_id": 0})


@api.delete("/classes/{class_id}")
async def delete_class(class_id: str, user=Depends(require_perm("manage_timetable"))):
    await db.classes.update_one({"id": class_id}, {"$set": {"archived": True}})
    return {"ok": True}


@api.post("/classes/{class_id}/cancel-date")
async def cancel_class_date(class_id: str, body: CancelDateIn, user=Depends(require_perm("manage_timetable"))):
    cls = await db.classes.find_one({"id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(404, "Class not found")
    await db.class_overrides.update_one({"class_id": class_id, "date": body.date},
                                        {"$set": {"class_id": class_id, "date": body.date, "status": "cancelled",
                                                  "reason": body.reason}}, upsert=True)
    booked = await db.bookings.find({"class_id": class_id, "date": body.date,
                                     "status": {"$in": ["booked", "waitlist"]}}).to_list(200)
    for b in booked:
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "class_cancelled"}})
        if b.get("user_id"):
            await notify(b["user_id"], "Class cancelled",
                         f"{cls['name']} on {body.date} at {cls['start_time']} has been cancelled. {body.reason or ''}", "class")
    return {"ok": True, "notified": len(booked)}


async def schedule_for_date(date: str, user_id: Optional[str]):
    d = date_cls.fromisoformat(date)
    dow = d.weekday()
    classes = await db.classes.find({"day_of_week": dow, "archived": {"$ne": True}}, {"_id": 0}).to_list(100)
    coaches = {c["id"]: c for c in await db.users.find({"role": {"$in": ["coach", "admin"]}},
                                                       {"_id": 0, "id": 1, "name": 1, "photo": 1, "bio": 1}).to_list(100)}
    result = []
    for c in classes:
        override = await db.class_overrides.find_one({"class_id": c["id"], "date": date}, {"_id": 0})
        booked_count = await db.bookings.count_documents({"class_id": c["id"], "date": date, "status": "booked"})
        waitlist_count = await db.bookings.count_documents({"class_id": c["id"], "date": date, "status": "waitlist"})
        my_booking = None
        if user_id:
            mb = await db.bookings.find_one({"class_id": c["id"], "date": date, "user_id": user_id,
                                             "status": {"$in": ["booked", "waitlist"]}}, {"_id": 0})
            my_booking = mb
        coach = coaches.get(c.get("coach_id"))
        result.append({**c, "date": date,
                       "coach": {"id": coach["id"], "name": coach["name"], "photo": coach.get("photo", ""), "bio": coach.get("bio", "")} if coach else None,
                       "booked_count": booked_count, "waitlist_count": waitlist_count,
                       "cancelled": bool(override and override.get("status") == "cancelled"),
                       "my_booking": my_booking})
    result.sort(key=lambda x: x["start_time"])
    return result


@api.get("/schedule")
async def get_schedule(date: str, creds: HTTPAuthorizationCredentials = Depends(security)):
    user_id = None
    if creds:
        try:
            payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
            user_id = payload.get("sub")
        except jwt.PyJWTError:
            pass
    return await schedule_for_date(date, user_id)


@api.get("/public/classes/{class_id}")
async def public_class(class_id: str):
    cls = await db.classes.find_one({"id": class_id, "archived": {"$ne": True}}, {"_id": 0})
    if not cls:
        raise HTTPException(404, "Class not found")
    coach = await db.users.find_one({"id": cls.get("coach_id")}, {"_id": 0, "name": 1, "photo": 1, "bio": 1})
    cls["coach"] = coach
    # next occurrence
    today = datetime.now(timezone.utc).date()
    delta = (cls["day_of_week"] - today.weekday()) % 7
    cls["next_date"] = (today + timedelta(days=delta)).isoformat()
    return cls

# ---------------- bookings ----------------

async def class_start_dt(cls, date: str):
    h, m = cls["start_time"].split(":")
    d = date_cls.fromisoformat(date)
    return datetime(d.year, d.month, d.day, int(h), int(m), tzinfo=timezone.utc)


@api.post("/bookings")
async def create_booking(body: BookingIn, bg: BackgroundTasks, user=Depends(get_current_user)):
    if user.get("status") == "pending":
        raise HTTPException(403, "Your account is awaiting approval")
    cls = await db.classes.find_one({"id": body.class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(404, "Class not found")
    override = await db.class_overrides.find_one({"class_id": body.class_id, "date": body.date})
    if override and override.get("status") == "cancelled":
        raise HTTPException(400, "This class is cancelled")
    existing = await db.bookings.find_one({"class_id": body.class_id, "date": body.date, "user_id": user["id"],
                                           "status": {"$in": ["booked", "waitlist"]}})
    if existing:
        raise HTTPException(400, "Already booked")
    booked_count = await db.bookings.count_documents({"class_id": body.class_id, "date": body.date, "status": "booked"})
    is_waitlist = booked_count >= cls["capacity"]
    booking = {
        "id": new_id(), "class_id": body.class_id, "class_name": cls["name"], "date": body.date,
        "start_time": cls["start_time"], "room": cls.get("room", ""), "user_id": user["id"],
        "user_name": user["name"], "guest": None,
        "status": "waitlist" if is_waitlist else "booked", "created_at": now_iso(),
    }
    await db.bookings.insert_one(booking)
    booking.pop("_id", None)
    # class pack session decrement
    if not is_waitlist:
        sub = await db.subscriptions.find_one({"user_id": user["id"], "status": "active", "plan_type": "class_pack",
                                               "sessions_remaining": {"$gt": 0}})
        if sub:
            await db.subscriptions.update_one({"id": sub["id"]}, {"$inc": {"sessions_remaining": -1}})
    title = "Waitlist joined" if is_waitlist else "Booking confirmed"
    msg = (f"You're on the waitlist for {cls['name']} on {body.date} at {cls['start_time']}."
           if is_waitlist else f"You're booked into {cls['name']} on {body.date} at {cls['start_time']} ({cls.get('room','')}).")
    await notify(user["id"], title, msg, "booking")
    settings = await get_settings_doc()
    bg.add_task(send_email_task, user["email"], f"ANAM MMA — {title}", f"<p>Hi {user['name']},</p><p>{msg}</p>",
                (settings or {}).get("club_email") or None)
    await notify_admins("New booking", f"{user['name']} booked {cls['name']} on {body.date}", "booking")
    return booking


async def promote_waitlist(class_id: str, date: str, bg: Optional[BackgroundTasks] = None):
    cls = await db.classes.find_one({"id": class_id}, {"_id": 0})
    if not cls:
        return
    booked_count = await db.bookings.count_documents({"class_id": class_id, "date": date, "status": "booked"})
    if booked_count >= cls["capacity"]:
        return
    nxt = await db.bookings.find({"class_id": class_id, "date": date, "status": "waitlist"},
                                 {"_id": 0}).sort("created_at", 1).to_list(1)
    if not nxt:
        return
    b = nxt[0]
    await db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "booked"}})
    if b.get("user_id"):
        await notify(b["user_id"], "You're in! Spot opened",
                     f"A spot opened in {cls['name']} on {date} at {cls['start_time']} — you've been moved off the waitlist.", "waitlist")
        member = await db.users.find_one({"id": b["user_id"]}, {"_id": 0, "email": 1, "name": 1})
        if member and bg:
            bg.add_task(send_email_task, member["email"], "ANAM MMA — Waitlist Promotion",
                        f"<p>Hi {member['name']}, a spot opened in {cls['name']} on {date} at {cls['start_time']}. You're now booked in!</p>")


@api.delete("/bookings/{booking_id}")
async def cancel_booking(booking_id: str, bg: BackgroundTasks, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "member" and b["user_id"] != user["id"]:
        raise HTTPException(403, "Not permitted")
    if user["role"] == "member":
        settings = await get_settings_doc()
        window = (settings or {}).get("cancellation_window_hours", 2)
        cls = await db.classes.find_one({"id": b["class_id"]}, {"_id": 0})
        if cls:
            start = await class_start_dt(cls, b["date"])
            if datetime.now(timezone.utc) > start - timedelta(hours=window):
                raise HTTPException(400, f"Cancellations must be made at least {window}h before class starts")
    was_booked = b["status"] == "booked"
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "cancelled"}})
    if was_booked:
        await promote_waitlist(b["class_id"], b["date"], bg)
    return {"ok": True}


@api.get("/bookings/me")
async def my_bookings(user=Depends(get_current_user)):
    return await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).sort([("date", -1), ("start_time", -1)]).to_list(300)


@api.get("/classes/{class_id}/roster")
async def class_roster(class_id: str, date: str, user=Depends(require_perm("mark_attendance"))):
    bookings = await db.bookings.find({"class_id": class_id, "date": date,
                                       "status": {"$in": ["booked", "waitlist", "attended", "no_show"]}},
                                      {"_id": 0}).sort("created_at", 1).to_list(200)
    return bookings


class CheckinIn(BaseModel):
    attended: bool

@api.post("/bookings/{booking_id}/checkin")
async def checkin(booking_id: str, body: CheckinIn, user=Depends(require_perm("mark_attendance"))):
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(404, "Booking not found")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "attended" if body.attended else "booked",
                                                               "checked_in_by": user["name"]}})
    return {"ok": True}


@api.post("/guest-bookings")
async def guest_booking(body: GuestBookingIn, bg: BackgroundTasks):
    cls = await db.classes.find_one({"id": body.class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(404, "Class not found")
    booked_count = await db.bookings.count_documents({"class_id": body.class_id, "date": body.date, "status": "booked"})
    is_waitlist = booked_count >= cls["capacity"]
    booking = {
        "id": new_id(), "class_id": body.class_id, "class_name": cls["name"], "date": body.date,
        "start_time": cls["start_time"], "room": cls.get("room", ""), "user_id": None,
        "user_name": body.name, "guest": {"name": body.name, "email": body.email},
        "status": "waitlist" if is_waitlist else "booked", "created_at": now_iso(),
    }
    await db.bookings.insert_one(booking)
    booking.pop("_id", None)
    settings = await get_settings_doc()
    msg = (f"You're on the waitlist for {cls['name']} on {body.date} at {cls['start_time']}."
           if is_waitlist else f"You're booked into {cls['name']} on {body.date} at {cls['start_time']} at ANAM MMA. See you there!")
    bg.add_task(send_email_task, body.email, "ANAM MMA — Class Booking", f"<p>Hi {body.name},</p><p>{msg}</p>",
                (settings or {}).get("club_email") or None)
    await notify_admins("Guest booking", f"Guest {body.name} ({body.email}) booked {cls['name']} on {body.date}", "booking")
    return booking

# ---------------- private sessions ----------------

@api.post("/private-sessions")
async def book_private(body: PrivateSessionIn, user=Depends(get_current_user)):
    coach = await db.users.find_one({"id": body.coach_id}, {"_id": 0, "name": 1, "id": 1})
    if not coach:
        raise HTTPException(404, "Coach not found")
    ps = {"id": new_id(), "member_id": user["id"], "member_name": user["name"], "coach_id": body.coach_id,
          "coach_name": coach["name"], "date": body.date, "time": body.time, "notes": body.notes,
          "status": "requested", "created_at": now_iso()}
    await db.private_sessions.insert_one(ps)
    ps.pop("_id", None)
    await notify(body.coach_id, "Private session request",
                 f"{user['name']} requested a private session on {body.date} at {body.time}.", "private")
    await notify_admins("Private session request", f"{user['name']} → {coach['name']} on {body.date} {body.time}", "private")
    return ps


@api.get("/private-sessions/me")
async def my_private(user=Depends(get_current_user)):
    q = {"coach_id": user["id"]} if user["role"] == "coach" else {"member_id": user["id"]}
    if user["role"] == "admin":
        q = {}
    return await db.private_sessions.find(q, {"_id": 0}).sort("date", -1).to_list(200)


@api.put("/private-sessions/{ps_id}")
async def update_private(ps_id: str, body: PrivateSessionUpdate, user=Depends(get_current_user)):
    ps = await db.private_sessions.find_one({"id": ps_id}, {"_id": 0})
    if not ps:
        raise HTTPException(404, "Not found")
    is_owner = ps["member_id"] == user["id"]
    is_coach_admin = user["role"] == "admin" or (user["role"] == "coach" and (ps["coach_id"] == user["id"] or user.get("permissions", {}).get("manage_private_sessions")))
    if body.status == "cancelled" and not (is_owner or is_coach_admin):
        raise HTTPException(403, "Not permitted")
    if body.status in ("confirmed", "declined") and not is_coach_admin:
        raise HTTPException(403, "Not permitted")
    await db.private_sessions.update_one({"id": ps_id}, {"$set": {"status": body.status}})
    target = ps["member_id"] if not is_owner else ps["coach_id"]
    await notify(target, f"Private session {body.status}",
                 f"Private session on {ps['date']} at {ps['time']} is now {body.status}.", "private")
    return await db.private_sessions.find_one({"id": ps_id}, {"_id": 0})

# ---------------- announcements & notifications ----------------

@api.post("/announcements")
async def create_announcement(body: AnnouncementIn, user=Depends(require_perm("send_announcements"))):
    ann = {"id": new_id(), "title": body.title, "body": body.body, "audience": body.audience,
           "class_id": body.class_id, "author": user["name"], "created_at": now_iso()}
    await db.announcements.insert_one(ann)
    ann.pop("_id", None)
    if body.audience == "class" and body.class_id:
        user_ids = await db.bookings.distinct("user_id", {"class_id": body.class_id, "user_id": {"$ne": None},
                                                          "status": {"$in": ["booked", "attended"]}})
    else:
        members = await db.users.find({"role": "member", "status": "active"}, {"_id": 0, "id": 1}).to_list(2000)
        user_ids = [m["id"] for m in members]
    for uid in user_ids:
        await notify(uid, f"📣 {body.title}", body.body, "announcement")
    return {**ann, "recipients": len(user_ids)}


@api.get("/announcements")
async def list_announcements(user=Depends(get_current_user)):
    return await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)


@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    unread = sum(1 for i in items if not i["read"])
    return {"items": items, "unread": unread}


@api.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}

# ---------------- admin dashboard, settings, media ----------------

@api.get("/admin/dashboard")
async def dashboard(user=Depends(require_perm("manage_members"))):
    await check_expiries()
    today = today_str()
    month_start = today[:8] + "01"
    active_members = await db.users.count_documents({"role": "member", "status": "active"})
    pending = await db.users.count_documents({"role": "member", "status": "pending"})
    new_signups = await db.users.count_documents({"role": "member", "created_at": {"$gte": month_start}})
    payments = await db.payments.find({"created_at": {"$gte": month_start}}, {"_id": 0, "amount": 1}).to_list(2000)
    revenue = sum(p["amount"] for p in payments)
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    expiring = await db.subscriptions.find({"status": "active", "end_date": {"$lte": soon, "$gte": today}},
                                           {"_id": 0}).sort("end_date", 1).to_list(50)
    todays = await schedule_for_date(today, None)
    attendance_today = await db.bookings.count_documents({"date": today, "status": "attended"})
    deletion_requests = await db.users.count_documents({"deletion_requested": True})
    return {"active_members": active_members, "pending_approvals": pending, "new_signups": new_signups,
            "revenue_month": revenue, "expiring": expiring, "todays_classes": todays,
            "attendance_today": attendance_today, "deletion_requests": deletion_requests}


@api.get("/settings")
async def get_settings():
    s = await get_settings_doc()
    return s or {}


@api.put("/admin/settings")
async def update_settings(body: SettingsIn, admin=Depends(require_admin)):
    updates = body.model_dump(exclude_none=True)
    if updates:
        await db.settings.update_one({"id": "club"}, {"$set": updates}, upsert=True)
    return await get_settings_doc()


@api.post("/admin/media")
async def update_media(body: MediaIn, admin=Depends(require_admin)):
    await db.settings.update_one({"id": "club"}, {"$set": {f"media.{body.key}": body.image}}, upsert=True)
    return {"ok": True}

# ---------------- seed ----------------

async def seed():
    if not await db.settings.find_one({"id": "club"}):
        await db.settings.insert_one({
            "id": "club", "open_registration": True, "cancellation_window_hours": 2,
            "private_session_policy": "Private sessions can be cancelled free of charge up to 24 hours in advance. Late cancellations may be charged in full.",
            "club_email": "", "waiver_version": WAIVER_VERSION,
            "media": {
                "login_bg": "https://images.unsplash.com/photo-1708134028754-5ba43093fedf?crop=entropy&cs=srgb&fm=jpg&q=85",
                "logo": "", "banner": "https://images.unsplash.com/photo-1708134028754-5ba43093fedf?crop=entropy&cs=srgb&fm=jpg&q=85"
            }})
    admin_email = os.environ['ADMIN_EMAIL'].lower()
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "id": new_id(), "name": "Stevie", "email": admin_email,
            "password_hash": pwd.hash(os.environ['ADMIN_PASSWORD']), "phone": "", "role": "admin",
            "status": "active", "waiver_accepted": True, "waiver_version": WAIVER_VERSION,
            "waiver_accepted_at": now_iso(), "emergency_contact_name": "", "emergency_contact_phone": "",
            "medical_notes": "", "admin_notes": "", "permissions": {}, "bio": "Club admin", "photo": "",
            "deletion_requested": False, "created_at": now_iso()})
    coach_seed = [
        ("Stephen", "stephen@anammma.com", "Head Coach — MMA & Grappling. 15+ years experience leading fighters at all levels.",
         "https://static.wixstatic.com/media/ec6808_4d7a3ca0e31f46b38f28088561a863ec~mv2.jpg",
         {"manage_timetable": True, "manage_members": True, "mark_attendance": True, "manage_private_sessions": True, "send_announcements": True}),
        ("Danny", "danny@anammma.com", "K1 & Kickboxing Coach. Precision striking, footwork and fight IQ.",
         "https://static.wixstatic.com/media/ec6808_9cf6de1ee5254aa3ad572c0d58983ee5~mv2.png",
         {"manage_timetable": True, "mark_attendance": True}),
        ("Ciaran", "ciaran@anammma.com", "Judo Coach. National-level competitor, specialist in throws and groundwork.",
         "https://static.wixstatic.com/media/3f6c3b18c0a646da9ac9cb2c50995106.jpg",
         {"mark_attendance": True}),
    ]
    coach_ids = {}
    for name, email, bio, photo, perms in coach_seed:
        existing = await db.users.find_one({"email": email})
        if existing:
            coach_ids[name] = existing["id"]
            continue
        cid = new_id()
        coach_ids[name] = cid
        await db.users.insert_one({
            "id": cid, "name": name, "email": email, "password_hash": pwd.hash("Coach2026!"),
            "phone": "", "role": "coach", "status": "active", "waiver_accepted": True,
            "waiver_version": WAIVER_VERSION, "waiver_accepted_at": now_iso(),
            "emergency_contact_name": "", "emergency_contact_phone": "", "medical_notes": "",
            "admin_notes": "", "permissions": perms, "bio": bio, "photo": photo,
            "deletion_requested": False, "created_at": now_iso()})
    if await db.plans.count_documents({}) == 0:
        for p in [
            {"name": "Unlimited Monthly", "price": 80.0, "type": "monthly", "duration_days": 30, "sessions": None,
             "description": "Unlimited access to all classes."},
            {"name": "10 Class Pack", "price": 100.0, "type": "class_pack", "duration_days": 90, "sessions": 10,
             "description": "10 sessions, valid 90 days."},
            {"name": "1 Week Trial", "price": 15.0, "type": "trial", "duration_days": 7, "sessions": None,
             "description": "Try every class for one week."},
            {"name": "Student Monthly", "price": 60.0, "type": "monthly", "duration_days": 30, "sessions": None,
             "description": "Unlimited classes — valid student ID required."},
        ]:
            await db.plans.insert_one({"id": new_id(), **p, "archived": False, "created_at": now_iso()})
    if await db.classes.count_documents({}) == 0:
        k1_img = "https://static.wixstatic.com/media/ec6808_eadc786c13cf4d698c7600012ac1f087~mv2.png"
        box_img = "https://static.wixstatic.com/media/ec6808_3839340dc8f64b548cb617ff2d3f44e5~mv2.png"
        schedule = [
            ("MMA Fundamentals", "Striking, takedowns and ground basics for all levels.", 0, "18:00", 60, "Main Mat", 20, "Stephen", ""),
            ("K1 Kickboxing", "High-intensity K1 striking — pads, bag work and sparring drills.", 0, "19:15", 60, "Ring Room", 16, "Danny", k1_img),
            ("Boxing", "Footwork, combinations and conditioning.", 1, "18:30", 60, "Ring Room", 16, "Danny", box_img),
            ("Judo", "Throws, grips and groundwork.", 1, "19:45", 75, "Main Mat", 18, "Ciaran", ""),
            ("MMA Sparring", "Supervised sparring rounds. Intermediate+.", 2, "19:00", 90, "Main Mat", 14, "Stephen", ""),
            ("K1 Kickboxing", "High-intensity K1 striking session.", 3, "18:00", 60, "Ring Room", 16, "Danny", k1_img),
            ("No-Gi Grappling", "Wrestling and submission grappling.", 3, "19:15", 75, "Main Mat", 18, "Stephen", ""),
            ("Boxing", "Technical boxing and pad work.", 4, "18:30", 60, "Ring Room", 16, "Danny", box_img),
            ("Open Mat", "Free training, all disciplines welcome.", 5, "11:00", 120, "Main Mat", 30, "Stephen", ""),
            ("Judo", "Competition-style randori.", 5, "13:30", 90, "Main Mat", 18, "Ciaran", ""),
        ]
        for name, desc, dow, t, dur, room, cap, coach, img in schedule:
            await db.classes.insert_one({"id": new_id(), "name": name, "description": desc, "day_of_week": dow,
                                         "start_time": t, "duration_min": dur, "room": room, "capacity": cap,
                                         "coach_id": coach_ids.get(coach), "image": img, "archived": False,
                                         "created_at": now_iso()})


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await seed()
    logger.info("ANAM MMA API ready")


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
