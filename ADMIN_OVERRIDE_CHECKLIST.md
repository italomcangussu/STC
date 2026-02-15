# Admin Scheduling Override Checklist

## Verification Steps

1. **Log in as an Admin.**
2. **Navigate to "Campeonatos" (Championships) in the main menu.**
3. **Select an active championship.**
4. **Find a match** that you wish to schedule outside of its round's date limits (e.g., specific match "Bruninho x Moacyr Andrade" in Round 1).
   - *Note: Round 1 limits are generally Feb 5th - Feb 14th.*
5. **Click "Agendar"** (Schedule) on the match card.
6. **In the modal:**
   - Verify that you can select **ANY date** (including dates outside the round limits).
   - Regular users will see date restrictions (min/max attributes on the date picker) and validation errors.
   - As an admin, these restrictions should be lifted.
7. **Select a date outside the round limits** (e.g., Feb 15th for a Round 1 match).
8. **Click "Confirmar e Agendar".**
9. **Success:** The match should be scheduled without errors.

## Troubleshooting

- If you still encounter an error, ensure your user role is strictly set to `admin` in the `profiles` table.
- Refresh the page to ensure the latest code is loaded.
