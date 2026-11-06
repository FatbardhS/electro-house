# Phase 7: Team invites and roles

Status: **implemented** (2026-11-06) with copy-link delivery (no email). "Copy link again" is "New link": only the token hash is stored, so a new link replaces the old one.

Goal: a company can have several users (office staff, electricians on site), each with a role, and pays one seat per
user. Today every company has exactly one user (the owner who signed up).

---

## 1. Roles

The `OWNER / ADMIN / MEMBER` roles already exist in the database; this phase makes them manageable.

| | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| Work on clients, projects, plans, circuits, exports | ✓ | ✓ | ✓ |
| Change prices, material rules, company settings | ✓ | ✓ | – |
| Invite and remove members, change their role | ✓ | ✓ (not the owner) | – |
| Manage billing | ✓ | ✓ | – |
| Transfer ownership, delete the company | ✓ | – | – |

- There is always **exactly one owner**. The owner can hand ownership to an admin (the old owner becomes admin).
- Nobody can remove themselves if they are the owner; others can **leave** a company.

## 2. Invitations

- An owner or admin enters an **email address and a role** (Admin or Member).
- The app creates a single-use invitation: a random 32-byte token (only its hash is stored, like session tokens),
  valid for **7 days**, and shows an **invitation link** with a *Copy* button.
- **Delivery (needs your decision, see §7):** the link is shared by the inviter (copy link) and, if an email service is
  configured, also sent by email.
- The invitee opens `/invite/<token>` and sees the company name, the role and who invited them:
  - **No account yet** → a short sign-up form with the email pre-filled and locked.
  - **Already has an account** → sign in, then *Join*.
  - The account email must **match the invited email** (case-insensitive), so a forwarded link does not work for
    someone else.
- On joining, a membership is created and the user lands in that company.
- Pending invitations are listed with *Copy link again*, *Resend* (if email is configured) and *Revoke*.
  Inviting the same email again replaces the old invitation.
- Limits: at most 50 pending invitations per company; invitation endpoints are rate-limited.

## 3. One person, several companies

An electrician may work for two companies (or own one and be invited to another). Since a user can then have several
memberships:

- Sign-in opens the company used last; a **company switcher** in the top bar lists the user's companies.
- The session already stores the active `organizationId`; switching updates it (and checks the membership).
- Everything else keeps working unchanged: every query is already scoped to the active company.

## 4. Removing members

- Owner/admin can remove a member (not the owner). Their **sessions for that company are ended immediately**; their
  user account and other companies are untouched.
- Work they created stays in the company (projects belong to the company, not to the person).
- Changing someone's role takes effect on their next request.

## 5. Seats and billing

- Seats = members of the company. Pending invitations are **not** counted.
- During the trial nothing is charged. With an active subscription, joining or removing a member updates the
  subscription quantity at the provider (Paddle: `PATCH /subscriptions/{id}` with the new quantity, prorated to the next
  bill). The development provider simulates it through the normal webhook path.
- The invite dialog shows the cost change before sending, e.g. "This adds 1 seat: +EUR 29/month from the next bill".
- While the company is **read-only** (subscription inactive), new invitations are refused, like other changes;
  existing members can still sign in, view and export.

## 6. Screens

- **Settings → Team** (new tab): members (name, email, role, joined), role dropdown, *Remove*, *Leave company*;
  pending invitations; *Invite* button. Members see the list read-only.
- **Invitation page** `/invite/<token>`: company, role, inviter; join / sign up / sign in; clear messages for
  expired, revoked, used or wrong-email links.
- **Top bar**: company switcher when the user belongs to more than one company.

## 7. Decision needed: email delivery

| Option | What it means |
|---|---|
| **A. Copy link only (now), email later** *(recommended to start)* | Works today with no account anywhere. The inviter sends the link by WhatsApp, email, etc. Email is added later behind the same screens. |
| B. Email via a provider (Resend, Postmark, Amazon SES) | Invitations arrive by email automatically. Needs your provider account, an API key and a verified sender domain (DNS records). |
| C. Email via SMTP | Uses an existing mailbox (e.g. your company email). Needs SMTP host, user and password; deliverability is lower. |

With B or C, the same email setup can later send password-reset emails (not built yet: today a forgotten password
cannot be reset — worth doing together).

## 8. Data changes (migration `team`)

```prisma
model Invitation {
  id             String    @id @default(uuid()) @db.Uuid
  organizationId String    @db.Uuid
  email          String
  role           MemberRole
  tokenHash      String    @unique
  invitedById    String    @db.Uuid
  expiresAt      DateTime
  acceptedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())
  @@index([organizationId])
}
```

- `User.lastOrganizationId` (nullable) for "open the company used last".
- No change to `Membership` or `Session`.

## 9. Testing

- API e2e: invite → accept (new and existing account), wrong email refused, expired / revoked / reused links refused,
  role permissions for every endpoint, owner cannot be removed, ownership transfer, removed member's sessions end,
  company switching only to own memberships, isolation between companies, seat updates with the dev provider,
  invites refused while read-only.
- Browser: invite flow end to end with a second test account, company switcher, Team tab as owner and as member.
