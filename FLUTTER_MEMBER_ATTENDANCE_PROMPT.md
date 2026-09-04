# HyMotion — Flutter Member App: Attendance History Fix Prompt

> **Copy everything inside the `PROMPT` fence below** into a Flutter AI session / hand to a Flutter developer.
>
> Platform rules: `Frontend/FLUTTER_MEMBER_APP_PROMPT.md`  
> Profile hub: `Frontend/FLUTTER_MEMBER_PROFILE_PROMPT.md`  
> Machine SoT: `docs/api/FRONTEND_API_CONTRACTS.ts` § Attendance + Members attendance  
> Live controllers: `AttendanceController` (`api/attendance`), `MembersController` (`api/members/{id}/attendance`)
>
> **Incident (2026-09-02):** Dio **404** on  
> `GET .../api/attendance/history?page=1&pageSize=20`  
> Root cause: **that route does not exist** on the backend. Fix the client path/auth — do not wait for a server “repair” of `/attendance/history`.

---

```
PROMPT — HyMotion Member App: Attendance History 404 Fix (Flutter)
You are a senior Flutter developer fixing HyMotion Member App attendance.
Arabic primary + English secondary. RTL when locale is Arabic.

This prompt FIXES Profile → Attendance (and any “visit history” screen) only.
It does NOT replace auth, QR check-in success UI, occupancy, classes, or orders.

Read and obey Frontend/FLUTTER_MEMBER_APP_PROMPT.md for stack, STYLE A API_BASE
(API_BASE ends with `/api`; paths must NOT repeat `/api`), JWT Bearer,
fonts (Cairo), charcoal #0D0D0D + lime #7ACC00.

═══════════════════════════════════════════════════════════════════
0) INCIDENT — DO NOT CALL THIS PATH
═══════════════════════════════════════════════════════════════════

BROKEN (causes HTTP 404 Not Found):
  GET /attendance/history?page=1&pageSize=20
  GET /api/attendance/history?...   ← only if you wrongly double-prefix /api

There is NO AttendanceController action named "history".
ASP.NET returns 404 because the route was never shipped.

Also FORBIDDEN from the Member App (staff / HR — never call):
  GET /attendance/today
  GET /attendance/search-members
  POST /attendance/manual-checkin
  POST /attendance/barcode-checkin
  GET /members/{id}/attendance          ← staff MembersView; IDOR risk if you guess id
  GET /members/me/attendance             ← does NOT exist (legacy Flutter guide is wrong)
  GET /hr/employee-attendance
  GET /hr/employee-attendance/me         ← staff work-hours, NOT gym visits
  GET /reports/attendance-summary

═══════════════════════════════════════════════════════════════════
1) PRODUCT BOUNDARY — WHICH APP ARE YOU BUILDING?
═══════════════════════════════════════════════════════════════════

A) MEMBER APP (this product) — gym visit check-in + Profile attendance
   Auth: POST /auth/member-activate → Member JWT (role Member).
   Visits: POST /attendance/qr-checkin { gymCode }
   Live floor: GET /member/occupancy
   Visit history list: NOT LIVE YET as a member-scoped route.
   Planned (backend Phase 2 — do not invent until backend confirms live):
     GET /member/attendance?page=1&pageSize=20
   Until then: honest empty / “history coming soon” UI — see §3.

B) STAFF WEB / DESK — not this Flutter app
   Today list: GET /attendance/today?filter=all
   One member history: GET /members/{gymMemberId}/attendance?page=&pageSize=
   Requires staff JWT + members.view / attendance.view.

C) HR EMPLOYEE APP (work hours) — different product
   GET /hr/employee-attendance/me?from=YYYY-MM-DD&to=YYYY-MM-DD
   FeatureFlag("hr"). This is staff clock-in, NOT member gym visits.

If the JWT roles include Manager (or other staff roles) AND you are building
the Member App: STOP. Re-login with member-activate. Do not use a Manager token
to “force” staff attendance APIs from the Member UI.

═══════════════════════════════════════════════════════════════════
2) LIVE MEMBER ATTENDANCE APIs (STYLE A)
═══════════════════════════════════════════════════════════════════

API_BASE example:
  https://reach-lullaby-tighten.ngrok-free.dev/api

Auth on every call:
  Authorization: Bearer <member JWT>
  Accept: application/json
  ngrok-skip-browser-warning: true   (when using ngrok)

── QR check-in (ALLOWED — keep using) ──
POST {API_BASE}/attendance/qr-checkin
Body: { "gymCode": "<from static gym QR>" }
Policy: AuthenticatedMember
→ QrCheckinResponse {
     attendanceId, memberName, memberNameAr,
     checkInAtUtc, planName, planNameAr,
     sessionsRemaining?, message, messageAr
   }

Optional local cache: after successful check-in, store the last N responses
in memory (or secure storage) to show “Recent visits” until /member/attendance ships.
Never invent rows for other members.

── Occupancy (ALLOWED — Home card; not a history list) ──
GET {API_BASE}/member/occupancy

═══════════════════════════════════════════════════════════════════
3) PROFILE → ATTENDANCE SECTION (UNTIL PHASE 2)
═══════════════════════════════════════════════════════════════════

Remove any Dio/repository method that hits /attendance/history.

UI behavior until GET /member/attendance is confirmed live by backend:

1) AttendanceSection on Profile:
   - Title: Attendance / الحضور
   - If local cache of recent qr-checkin responses is non-empty:
       show those rows (date + check-in time Cairo, entry = QR)
   - Else:
       empty state EN: "No visit history yet. Check in at the gym to see visits here."
       empty state AR: equivalent honest copy (not an error)
   - Do NOT show a spinning forever loader waiting for a 404 path
   - Do NOT call staff /members/{id}/attendance with invitation summary memberId
     (even if you have GymMember.Id from GET /invitation/summary — that staff route
      is forbidden in Member App product policy)

2) Error handling if any old client still hits a missing route:
   - 404 → treat as “history unavailable”; show empty state + optional “Pull to refresh”
   - 401 → re-auth / activate again
   - Never toast raw “DioError Status: 404” to the member

3) When backend ships GET /member/attendance (AuthenticatedMember, own visits only):
   Expected shape (align with staff AttendanceSummaryDto + paging):
   {
     "items": [
       { "id": "guid", "checkInAtUtc": "...", "checkOutAtUtc": null, "entryMethod": "qr|manual|barcode" }
     ],
     "totalCount": n, "page": 1, "pageSize": 20,
     "totalPages": n, "hasNext": bool, "hasPrevious": bool
   }
   Wire ProfileRepository behind an interface so swapping empty→API is one change.
   entryMethod values from API: "qr" | "manual" | "barcode" (and possibly "class").

═══════════════════════════════════════════════════════════════════
4) TIME DISPLAY (Egypt)
═══════════════════════════════════════════════════════════════════

API timestamps are UTC ISO; may omit trailing Z.
Parse as UTC, display Africa/Cairo for checkInAtUtc / checkOutAtUtc.
Show duration only when checkOutAtUtc is non-null.

═══════════════════════════════════════════════════════════════════
5) MIGRATION CHECKLIST (CODE SEARCH)
═══════════════════════════════════════════════════════════════════

In the Flutter repo, search and delete/replace:
  [ ] "attendance/history"
  [ ] "/api/attendance/history"
  [ ] "members/me/attendance"
  [ ] any AttendanceHistoryApi that uses staff /members/{id}/attendance

Replace call sites with:
  - QR: POST /attendance/qr-checkin
  - History UI: empty + local cache OR (when live) GET /member/attendance

═══════════════════════════════════════════════════════════════════
6) AUTH SANITY (FROM THE 404 LOG)
═══════════════════════════════════════════════════════════════════

The failing log used a Bearer token with roles ["Manager","Member"] and a staff email.
Member App screens must use the Member activation JWT only.
If login UI allows email/password staff login into the Member App shell — remove that.

═══════════════════════════════════════════════════════════════════
7) ACCEPTANCE
═══════════════════════════════════════════════════════════════════

[ ] No request is ever sent to /attendance/history (verify in Dio logger)
[ ] Profile → Attendance never 404-spams; empty or cached rows only until Phase 2
[ ] QR check-in still uses POST /attendance/qr-checkin { gymCode }
[ ] No staff /members/{id}/attendance, /attendance/today, or /hr/employee-attendance from Member App
[ ] Member App auth path remains member-activate (not Manager password login)
[ ] flutter analyze clean for touched files
[ ] Manual: open Profile → Attendance with ngrok — no DioError 404 in log
```

---

## Quick reference (for humans)

| Need | Correct call | Status |
|------|----------------|--------|
| Fix 404 | **Stop** `GET /api/attendance/history` | Required now |
| Member QR check-in | `POST /api/attendance/qr-checkin` | Live |
| Member visit history | `GET /api/member/attendance` | **Not live** — Phase 2 |
| Staff one-member history | `GET /api/members/{id}/attendance` | Staff only |
| Desk today | `GET /api/attendance/today` | Staff only |
| Staff work hours | `GET /api/hr/employee-attendance/me` | HR / employee app |

## Task tracking

| ID | Status note |
| -- | ----------- |
| FL (attendance) | Prompt ready — Flutter removes dead path; mark done after app ships |
| BE (optional) | Ship `GET /api/member/attendance` when Product prioritizes Profile history |
