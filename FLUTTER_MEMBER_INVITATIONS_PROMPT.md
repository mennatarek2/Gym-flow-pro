# GymFlowPro — Flutter Member App: Invitations

> **Copy everything inside the `PROMPT` fence below** into a Flutter AI session / hand to a Flutter developer.
>
> Staff desk already ships this (Plans “Invitations per membership”, Member 360 Invitations tab, `/dashboard/invitations/`, front-desk create on behalf of a member).
> Design SoT: `Frontend/previews/plan-based-referral-invites.html` (right-side **phone frames**: Summary / Invite / Success / Zero).
> Platform rules: `Frontend/FLUTTER_MEMBER_APP_PROMPT.md`.
>
> Member APIs are **live**:
> - `GET /api/invitation/summary`
> - `GET /api/invitation/history`
> - `POST /api/invitation/send`
>
> Do **not** call staff:
> `GET /api/invitation`, `POST /api/invitation/members/{id}`, `PATCH /api/invitation/{id}/status`.
> Do **not** call retired: `guest-quota`, `pending`, `redeem-visit`, `referral-share`.

---

```
PROMPT — GymFlowPro Member App: Invitations (Flutter)
You are a senior Flutter developer extending the GymFlow Pro Member App (Egypt / MENA).
Arabic primary + English secondary. RTL when locale is Arabic.

This prompt REPLACES Invite Guest + Share Referral Code with ONE feature named Invitations.

It does NOT add staff follow-up, Trial, Sale, or a CRM lead screen.
Staff already follow up on the gym desk. The Member App only submits a friend and shows quota + history.

Read and obey Frontend/FLUTTER_MEMBER_APP_PROMPT.md for stack, STYLE A API_BASE, JWT `sub`,
fonts (Space Grotesk + IBM Plex Sans + IBM Plex Sans Arabic), charcoal #0D0D0D + lime #7ACC00.

Match the Member App phone frames in:
  Frontend/previews/plan-based-referral-invites.html
  (tabs: Summary / Invite / Success / Zero)

═══════════════════════════════════════════════════════════════════
0) PRODUCT (BINDING)
═══════════════════════════════════════════════════════════════════

The member gives the gym a friend's NAME + PHONE. Gym staff call them later.
Quota comes from the member's current covering membership (plan field ReferralInviteQuota).
Quota is consumed ON CREATE (when Send succeeds with alreadyExisted == false).
Unused invitations do NOT carry to the next membership / renew.
Frozen, expired, cancelled, pending, or no membership → remaining = 0.

It is NOT:
- a Guest Pass / gym visit
- a Trial
- a Referral Code / share link
- a Lead / Prospect table the member manages

UI words (EN / AR) — use these, do not invent synonyms:
- Invitations / الدعوات
- Invite a Friend / ادعُ صديق
- available / متاح
- used / مستخدم
- total / الإجمالي
- Invitation sent / تم إرسال الدعوة
- 0 Invitations available / لا توجد دعوات متاحة
- You've used all Invitations included in your current Membership.
  / لقد استخدمت كل الدعوات في عضويتك الحالية
- Name / الاسم
- Phone number / رقم الموبايل
- National ID (optional) / الرقم القومي (اختياري)
- Notes (optional) / ملاحظات (اختياري)
- Send invitation / إرسال الدعوة
- Sent / المرسل
- New / جديد
- Contacted / تم التواصل
- Interested / مهتم
- Not Interested / غير مهتم
- Converted / انضم

Status chips (history only — member cannot change them):
  new | contacted | interested | not_interested | converted

JWT `sub` is Identity ApplicationUser.Id — NOT GymMember.Id.
The server resolves the member. Never send memberId / tenantId / quota in the POST body.

FORBIDDEN:
- Words: Referral Lead, Guest Pass, Prospect, Referral Code, Share code, Invite Guest
- visitDate / visit date picker
- Consuming or decrementing quota on the client before a 200
- Sending memberId, tenantId, total, used, remaining in the create body
- Staff APIs: GET /invitation  GET /invitation/members/{id}  PATCH /invitation/{id}/status
              POST /invitation/members/{id}
- Retired: GET /invitation/guest-quota
           GET /invitation/referral-share
           GET /invitation/pending
           POST /invitation/{id}/redeem-visit
- Letting the member set status (Contacted / Converted etc.)
- A new visual language — reuse existing cards, buttons, spacing, RTL
- Fake remaining (e.g. hardcode 15). Always GET /invitation/summary.

═══════════════════════════════════════════════════════════════════
1) LIVE APIs (STYLE A)
═══════════════════════════════════════════════════════════════════

API_BASE already ends with `/api`. Paths must NOT repeat `/api`.
Authorization: Bearer <member JWT>
Header: ngrok-skip-browser-warning: true

WRONG:  API_BASE ".../api" + path "/api/invitation/summary"
RIGHT:  path "/invitation/summary"

--- Summary (quota meter) ---
GET {API_BASE}/invitation/summary
Policy: AuthenticatedMember
200:
{
  "memberId": "...",
  "membershipId": "...",
  "planId": "...",
  "planName": "Growth",
  "total": 15,
  "used": 4,
  "remaining": 11,
  "membershipStatus": "active"
}
Accept PascalCase too (MemberId, Remaining, …).

remaining is the ONLY number that enables Invite.
If remaining is 0 OR membershipStatus is frozen | expired | cancelled | none | pending
  → Zero state, Invite disabled.
Do not invent remaining from used/total on the client if remaining is present — display remaining as-is.

--- History ---
GET {API_BASE}/invitation/history
200: array (not a paged envelope)
[
  {
    "id": "...",
    "name": "Ahmed Mohamed",
    "phoneNumber": "+201012345678",
    "nationalId": null,
    "notes": null,
    "status": "new",
    "createdAtUtc": "...",
    "contactedAtUtc": null,
    "convertedAtUtc": null,
    "invitedByMemberId": "...",
    "invitedByName": "..."
  }
]
Also accept guestName / guestPhoneNumber / sentAtUtc aliases.
status: new | contacted | interested | not_interested | converted
Newest first if the API already sorts; otherwise sort createdAtUtc descending.

--- Send ---
POST {API_BASE}/invitation/send
Body (JSON):
{
  "name": "Ahmed Mohamed",
  "phoneNumber": "01012345678",
  "nationalId": null,
  "notes": "Interested in bodybuilding"
}
Rules:
- name + phoneNumber required
- nationalId optional; omit or null; NEVER block send when empty
- if nationalId is provided it must be 14 digits (client check); else let the API 400
- notes optional
- do NOT send visitDate
- do NOT send guestName unless you also send name (API accepts aliases; prefer name / phoneNumber)

200:
{
  "invitationId": "...",
  "name": "...",
  "phoneNumber": "...",
  "status": "new",
  "alreadyExisted": false,
  "quotaTotal": 15,
  "quotaUsed": 5,
  "quotaRemaining": 10,
  "message": "Invitation sent",
  "messageAr": "تم إرسال الدعوة"
}

alreadyExisted == true → this phone already has an invitation. Quota was NOT spent again.
Treat as SUCCESS (not an error). Show message / messageAr. Refresh summary + history.

400 { "error": "..." } — show the bilingual string as-is. Typical:
- This person is already a member. / هذا الشخص عضو بالفعل
- You've used all Invitations included in your current Membership.
- No active membership / لا توجد عضوية نشطة
- Invalid phone / رقم الهاتف غير صالح
- Member not found

401 → existing refresh / re-activate flow.
After 200: pop success, then immediately GET summary + GET history (do not wait for a manual reload).

Egyptian mobile: send 01xxxxxxxxx or +20… ; backend normalizes. Client: non-empty + looks like an Egyptian mobile (same helper as other phone fields if one exists).

═══════════════════════════════════════════════════════════════════
2) DART MODELS + REPOSITORY
═══════════════════════════════════════════════════════════════════

class InvitationQuota {
  final String memberId;
  final String? membershipId;
  final String? planId;
  final String? planName;
  final int total;
  final int used;
  final int remaining;
  final String membershipStatus;
  bool get canInvite => remaining > 0 && membershipStatus.toLowerCase() == 'active';
}

class InvitationItem {
  final String id;
  final String name;
  final String phoneNumber;
  final String status; // new|contacted|interested|not_interested|converted
  final DateTime? createdAtUtc;
}

class SendInvitationResult {
  final String invitationId;
  final bool alreadyExisted;
  final int quotaRemaining;
  final String message;
  final String messageAr;
}

fromJson: read camelCase AND PascalCase (name / Name, remaining / Remaining).
For history rows: name ?? guestName, phoneNumber ?? guestPhoneNumber.

InvitationRepository (authenticated Dio — same client as occupancy / store):
- getSummary() → GET /invitation/summary
- getHistory() → GET /invitation/history
- send({required name, required phoneNumber, String? nationalId, String? notes})
    → POST /invitation/send
- On 401: existing refresh flow
- On 400: surface error string (do not swallow)
- Never keep a mock that invents remaining = 15

═══════════════════════════════════════════════════════════════════
3) SCREENS (match the preview phone)
═══════════════════════════════════════════════════════════════════

Dark cards: background #1C1C1C, border #2A2A2A, radius 16.
Lime CTA #7ACC00, label #0D0D0D, Space Grotesk on titles/numbers.

Place:
- Home: existing Invite CTA → opens InvitationsScreen (or Invite form if remaining > 0)
- InvitationsScreen: summary card + history (“Sent”)
- InviteFriendScreen / sheet: the form

--- A) Summary (preview tab Summary) ---
  Title: Invitations / الدعوات
  Big number: "{remaining} available"   e.g. 11 available
  Sub: "{used} used · {total} total"    e.g. 4 used · 15 total
  Full-width CTA: + Invite a Friend     enabled iff canInvite

  Below: card “Sent”
    rows: friend name  |  status chip
    empty: “No invitations yet” / “لسه مفيش دعوات”

--- B) Zero remaining (preview tab Zero) ---
  Big number: 0 available
  Sub: You've used all Invitations included in your current Membership.
       (also when frozen/expired/cancelled — same disabled CTA; you may use the API 400 text)
  CTA disabled (opacity ~0.4). Backend also rejects.

--- C) Invite a Friend (preview tab Invite) ---
  Name *           required
  Phone number *   required, placeholder 01012345678
  National ID      OPTIONAL — label must include (optional) / (اختياري)
                   hint: You can send without a National ID.
  Notes            OPTIONAL
  CTA: Send invitation
  Disable CTA while in-flight (one tap).

--- D) Success (preview tab Success) ---
  Title: Invitation sent / تم إرسال الدعوة
  Body: Your friend has been added to your Invitations.
        / تمت إضافة صاحبك للدعوات.
  Show updated remaining from the POST body (quotaRemaining) then refresh GET summary.
  Example: 10 available · 5 used · 15 total

History chips:
  new            blue     New
  contacted      amber    Contacted
  interested     purple   Interested
  not_interested red      Not Interested
  converted      green    Converted

Member cannot PATCH status. Display only.

Delete / hide from the app:
- InviteGuestScreen / visit date
- ReferralShareScreen / share code / R#######
- Any “guest quota this month” meter

═══════════════════════════════════════════════════════════════════
4) IMPLEMENTATION STEPS
═══════════════════════════════════════════════════════════════════

1) Models + repository + Cubit/Bloc (load summary+history when opening Invitations).
2) InvitationsScreen matching Summary + Zero + Sent list.
3) Invite form; POST /invitation/send; handle alreadyExisted as success.
4) Wire Home Invite CTA. Do not add a 6th bottom-nav item unless Home already has Invites.
5) arb: invitation_* strings EN + AR. RTL.
6) Remove Invite Guest + Share Referral Code entry points and routes.
7) Pull-to-refresh on InvitationsScreen reloads summary + history.

═══════════════════════════════════════════════════════════════════
5) DONE WHEN
═══════════════════════════════════════════════════════════════════

[ ] Feature is named Invitations (not Referrals / Guest Pass)
[ ] Quota comes only from GET /invitation/summary (remaining enables Invite)
[ ] Invite disabled when remaining is 0 (and when membership is not active)
[ ] Form: Name + Phone required; National ID optional; Notes optional
[ ] Missing National ID still creates the invitation
[ ] Success refreshes quota without restarting the app
[ ] Duplicate phone (alreadyExisted) does not look like a failure
[ ] Existing-member 400 shows “already a member”
[ ] No guest-quota / referral-share / visitDate / staff invitation APIs
[ ] Invite Guest + Share code screens gone
[ ] Existing theme, RTL, error handling
[ ] Matches preview phone frames (Summary / Invite / Success / Zero)
```
