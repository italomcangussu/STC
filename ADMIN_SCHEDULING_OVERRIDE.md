# Admin Scheduling Override

**Date:** 2026-02-15
**Feature:** Allow admins to schedule championship matches outside of the official round dates.

## Context
The championship has strict rules regarding match dates (e.g., Round 1 must be played between Feb 5th and Feb 14th). However, due to delays (rain, injuries, etc.), some matches might need to be rescheduled for a later date.

## Requirement
Regular users (socios) must strictly follow the round dates.
Administrators must be able to override this restriction and schedule matches for any date.

## Implementation Details

### 1. `ChampionshipInProgress.tsx`
- Passed the `isAdmin` boolean prop to the `MatchScheduleModal`.
- Derived from `currentUser?.role === 'admin'`.

### 2. `MatchScheduleModal.tsx`
- Added `isAdmin` prop to the interface.
- **Date Input:** 
    - Regular Users: `min` and `max` attributes are set to the round's start and end dates.
    - Admins: `min` and `max` attributes are removed (undefined), allowing selection of any date.
- **Validation:**
    - Regular Users: Attempting to submit a date outside the range results in an error message.
    - Admins: The date range check is skipped.

## Validation
- **Scenario 1 (User):** User tries to schedule a Round 1 match (End 14/02) on 15/02.
    - Result: Blocked involved by UI constraints and validation error.
- **Scenario 2 (Admin):** Admin tries to schedule a Round 1 match (End 14/02) on 15/02.
    - Result: Allowed.
