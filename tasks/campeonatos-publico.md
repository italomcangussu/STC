# Task: Public Championships Page Viewer (`/campeonatos-publico`)

## Objective

Allow guests/public users to view the current active championship details (games, brackets, standings) without logging in, under the path `/campeonatos-publico` using a minimalist, read-only layout.

## Implementation Steps

1. **Routing in `App.tsx`**:
   - Check if path is `/campeonatos-publico`.
   - Fetch the active current championship (first priority: status = 'ongoing', second: registration_open = true, fallback: latest).
   - Retrieve its slug.
   - Render the existing public view component `PublicChampionshipPage.tsx` with that slug.

2. **Minimalist UI Validation**:
   - Verify that `PublicChampionshipPage.tsx` functions correctly without a user session (no edit/join actions visible).
   - Ensure it matches the requested minimalist layout without standard sidebars.

3. **Verification**:
   - Run compilation and linting scripts to ensure clean state.
