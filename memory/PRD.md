# ANAM MMA — Club Management App PRD

## Original Problem Statement
Build a complete club management mobile app for ANAM MMA (reference anammma.com branding). Dark premium design, mobile first, JWT auth, MongoDB. Roles: member, coach, admin. Full vertical slice: registration/approval, liability waiver with version+timestamp records, membership plans & billing (cash; Stripe-ready later), member management with GDPR + CSV exports, weekly timetable & booking with capacity/waitlist/cancellation window, guest booking links, private sessions, admin dashboard, announcements, media management, in-app notifications, SendGrid emails, ToS/Privacy (Irish GDPR).

## User Choices
- Stripe: SKIPPED for now — cash payments only, structure ready for Stripe later
- SendGrid: real key provided; sender Anam@aipnua.ie; reply-to configurable in Settings (user will add later)
- Admin seeded: stevie@aipnua.com / AnamAdmin2026! — handover supported (promote-admin + email change)
- Branding: agent's judgment — dark premium, gold/bronze accent, Barlow Condensed + Manrope

## Architecture
- Backend: FastAPI single server.py (/api prefix), motor MongoDB, PyJWT + pwdlib(argon2), SendGrid via BackgroundTasks. UUID string ids, _id excluded everywhere.
- Frontend: Expo SDK 54, expo-router. Single (tabs) group with role-conditional tabs (member: Home/Timetable/Bookings/Profile; coach: My Classes/Timetable/Bookings/Profile; admin: Dashboard/Members/Timetable/Manage/Profile). Stack screens: login, waiver, legal, notifications, checkin, guest/[classId].
- Keyboard: react-native-keyboard-controller (KeyboardProvider + KeyboardAwareScrollView).

## Implemented (2026-06-12)
### Iteration 2 (UX revamp per user feedback)
- Timetable: DAY/WEEK toggle. WEEK = concise admin overview grouped Mon–Sun with per-day ADD buttons, tap-row-to-edit. Add/edit form now tap-based: day chips, time-slot chips (06:00–21:30), duration chips, capacity +/- stepper, coach chips — no typing needed.
- Member management revamp: prominent "+ ADD MEMBER (CASH AT DESK)" → one-flow create account + plan + cash payment (POST /api/users/member), auto temp password with share button; "Unpaid" filter; € due badges; member detail with quick APPROVE / MARK CASH PAID actions and SELL/RENEW PLAN (cash) flow; POST /api/subscriptions supports mark_paid.
- Login background switched to generic MMA gym image (admin-replaceable in Manage → Media).
- Test data cleaned from DB after iteration 2 testing.

- JWT auth, roles, granular coach permissions (5 flags), admin seeding, open/approval registration toggle
- Waiver gate with versioned acceptance log (waiver_log collection)
- Plans CRUD (monthly/trial/class_pack), subscriptions: assign → mark cash paid → receipt; freeze/resume with end-date extension; 7-day expiry reminders; expired auto-handling
- Payments history + shareable receipts; CSV exports (members, payments)
- Member management: search/filter, approve, notes, emergency/medical info, attendance history, remove, GDPR deletion requests, promote-to-admin (handover)
- Timetable: weekly classes with rooms/capacity/coach bios/images, 14-day date tape, book/waitlist with auto-promotion + notifications, member cancellation window (settings), per-date class cancellation with member notifications, coach check-in roster
- Guest booking: public /guest/[classId] route + share link per class
- Private sessions: request → coach confirm/decline/cancel, policy in settings
- Admin dashboard: active members, revenue month, signups, pending, attendance today, GDPR count, today's classes, expiring list
- Announcements (all/per-class) → in-app notifications; notifications feed with unread badge
- Media management: admin replaces login bg/logo/banner via image picker (base64)
- SendGrid emails: welcome, approval, payment confirmation, booking confirmation, waitlist promotion, guest booking (reply-to = club_email setting)
- Legal screen (ToS + GDPR privacy policy, Ireland)
- Testing: iteration_1 all pass (38 backend tests + full frontend flows)

## Backlog / Next
- P0: none outstanding
- P1: Stripe payment integration (user will provide key later); reply-to club email value (user to add in Manage → Settings)
- P2: per-class email links/QR for promotion, attendance analytics charts, coach photo upload UI per coach, push notifications (only if user requests), receipt PDF generation
- Known minor: `props.pointerEvents` deprecation console warning (internal lib), server.py is monolithic (could split into routers)
