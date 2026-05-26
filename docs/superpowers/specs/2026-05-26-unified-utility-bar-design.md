# Unified Utility Bar & User Dropdown

**Date:** 2026-05-26
**Status:** Design (approved)
**Author:** TobeChukwu278

## Problem

Pages in the app have inconsistent top-of-page treatments:

| Page | Header/Layout | Issue |
|---|---|---|
| Post detail, Browse, Login, Register | `default.ejs` → `header.ejs` (big logo + Explore/Write/Reward nav + CTA) | Works for public pages |
| Achievements, Withdraw | `dashboard-header.ejs` (smaller logo + Home/Dashboard/Logout) | Different styling, different nav links |
| Dashboard/Home (logged-in) | Inline brand logo + sidebar | No top header at all |
| Activity | Sidebar only | No top header, no brand, content flush to browser edge |

The core UX problem: pages without any top header have content too close to the browser's top edge, creating a cramped feel. Pages with `dashboard-header.ejs` are inconsistent with the rest of the app.

## Solution: Thin Utility Bar + User Dropdown

A lightweight, consistent utility bar across all logged-in pages, paired with a feature-rich user dropdown menu.

### Scope

- **Bar appears on:** Dashboard/Home, Explore/Browse, Activity (Reading History), Profile, Withdraw, Achievements
- **Bar does NOT appear on:** Post detail page (keeps existing `header.ejs` — it has its own hero layout with a back button), Login/Register pages (keep existing layout)

### Utility Bar Design

```
┌──────────────────────────────────────────────────────────┐
│  n  │  Activity                  🔔  [JD]                │
└──────────────────────────────────────────────────────────┘
```

- **Logo:** Tiny "n" in Zen Tokyo Zoo font, `font-size: 22px`, `letter-spacing: -4px`, color `#6d0a0a`
- **Separator:** Thin vertical line (`|`) after logo
- **Page title:** Dynamic — reflects the current page (e.g., "Activity", "Dashboard", "Withdraw", "Achievements", "Explore", "Profile", "Home")
- **Notification bell:** Bell icon with red dot indicator for unread notifications. Clicking navigates to `/activity`
- **User avatar:** Circular avatar (first letter(s) of display name), maroon background. Clicking opens the dropdown

The bar is `position: sticky; top: 0` with `z-index: 50`, giving pages a consistent visual anchor and pushing content down from the browser edge.

### User Dropdown Menu

```
┌─────────────────────────────┐
│  [JD]  John Doe             │
│        @johndoe             │
│        📖 12 reads this week│
├─────────────────────────────┤
│  ⚙️  Settings               │
│  ✍️  Apply to Write   Earn  │  ← dynamic
│  🔗  Refer a Friend  +₦50  │  ← interactive copy
│  🌙  Dark Mode     [🔘]    │  ← toggle
├─────────────────────────────┤
│  🚪  Logout                 │  ← red/danger
└─────────────────────────────┘
```

#### User Info Card
- User avatar (larger, 42px), display name, `@username`
- Reading stats snapshot: e.g., "📖 12 reads this week" — calculated from `ReadSession` data (reads in the last 7 days)

#### Dropdown Items

| Item | Behavior | Dynamic? |
|---|---|---|
| **Settings** | Links to `/settings` (page may not exist yet — link points to it as placeholder) | No |
| **Publisher link** | If user role is `reader`: shows "✍️ Apply to Write" → links to `/apply-publisher` with "Earn" badge. If user role is `publisher`: shows "📝 Publisher Dashboard" → links to `/publisher` | Yes — checks `user.role` |
| **Refer a Friend** | Shows user's referral code/link. On click: copies `/register?ref=CODE` to clipboard, text changes to "✅ Copied!" for 2 seconds, then reverts. Shows "+₦50" badge | The link text is dynamic (switches between "Refer a Friend" and "Copied!") |
| **Theme Toggle** | Toggle switch for light/dark mode. Persists preference via `localStorage` + cookie. Shows current mode icon (🌙 for dark, ☀️ for light) | Yes — reflects current theme |
| **Logout** | Red/danger color, separated by divider, font-weight 600. Links to `/logout` | No |

#### Divider
A `<hr>` or border separates the main items from Logout, giving visual distinction.

### Implementation Plan (Issue Breakdown)

The work is split into 5 dependent issues:

```
[#1] Utility Bar Partial
     ├── [#2] Wire Utility Bar Into All Pages
     └── [#3] User Dropdown Menu
              ├── [#4] Referral Copy Interaction
              └── [#5] Theme Toggle
```

### Open Questions
- Settings page (`/settings`) does not exist yet. The link points there as a placeholder with a "Soon" badge so users aren't surprised by a 404
- Notification bell dot count should reflect actual unread count from the server (future enhancement — initial implementation just shows red dot if `unreadCount > 0`)
- Reading stats snapshot in the user info card is static text for now. Can be enhanced to fetch real-time data later

## Files to Create/Modify

### New Files
- `src/views/partials/app-utility-bar.ejs` — The utility bar + dropdown partial

### Modified Files
- `src/views/pages/home-logged-in.ejs` — Replace inline brand with utility bar
- `src/views/pages/activity.ejs` — Add utility bar, remove old sidebar-only header
- `src/views/pages/achievements.ejs` — Replace `dashboard-header.ejs` with utility bar
- `src/views/pages/withdraw.ejs` — Replace `dashboard-header.ejs` with utility bar
- `src/views/pages/explore.ejs` — Add utility bar (currently uses `default.ejs` layout — may need layout override)
- `src/views/partials/dashboard-header.ejs` — Remove or repurpose (no longer used)
- `src/views/partials/home-side-nav.ejs` — Verify it still works without a brand header above it
- `src/routes/pages.js` — Pass `pageTitle` and `unreadCount` to templates
