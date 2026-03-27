-- =============================================================================
-- ONE-TIME FIX: Correct crime_burned / fraud_burned column assignments
-- =============================================================================
--
-- Bug: storeCarnageEvent assigned tokensBurned to crime_burned/fraud_burned
-- based on `target` (the BUY target). But burned tokens come from HELD tokens
-- of the PREVIOUS epoch's buy target -- a different token.
--
-- Example: Epoch 467 bought CRIME (target=CRIME). Epoch 468 target=FRAUD,
-- action=Burn. The Burn burns the HELD CRIME from Epoch 467. But the bug
-- stored it as fraud_burned (because target=FRAUD).
--
-- Fix logic:
-- 1. Use LAG() window function to get each event's previous target_token
-- 2. For Burn/BurnAndSell events where burned amount is in the wrong column,
--    swap crime_burned <-> fraud_burned
--
-- SAFETY:
-- - BuyOnly events have crime_burned=0 and fraud_burned=0, so they're unaffected
-- - Events where burned=0 on both sides are unaffected
-- - The script is idempotent: running twice won't corrupt data (second run
--   finds no rows to update because the data is already correct)
--
-- Run against: Railway Postgres (production)
-- =============================================================================

-- Step 1: Preview what will change (DRY RUN -- read-only)
-- Uncomment this SELECT to see affected rows before running the UPDATE.

/*
WITH prev AS (
  SELECT
    id,
    epoch_number,
    path,
    target_token,
    crime_burned,
    fraud_burned,
    LAG(target_token) OVER (ORDER BY epoch_number) AS prev_target
  FROM carnage_events
)
SELECT
  id,
  epoch_number,
  path,
  target_token AS buy_target,
  prev_target AS held_token_from_prev,
  crime_burned AS current_crime_burned,
  fraud_burned AS current_fraud_burned,
  CASE
    WHEN prev_target = 'CRIME' THEN crime_burned + fraud_burned
    ELSE 0
  END AS corrected_crime_burned,
  CASE
    WHEN prev_target = 'FRAUD' THEN crime_burned + fraud_burned
    ELSE 0
  END AS corrected_fraud_burned
FROM prev
WHERE path IN ('Burn', 'BurnAndSell')
  AND (crime_burned > 0 OR fraud_burned > 0)
ORDER BY epoch_number;
*/

-- Step 2: Apply the correction
-- For each Burn/BurnAndSell event, reassign the total burned amount
-- (crime_burned + fraud_burned) to the correct column based on
-- the PREVIOUS event's target_token (= what was held and burned).

BEGIN;

WITH prev AS (
  SELECT
    id,
    path,
    crime_burned,
    fraud_burned,
    LAG(target_token) OVER (ORDER BY epoch_number) AS prev_target
  FROM carnage_events
)
UPDATE carnage_events ce
SET
  crime_burned = CASE
    WHEN p.prev_target = 'CRIME' THEN p.crime_burned + p.fraud_burned
    ELSE 0
  END,
  fraud_burned = CASE
    WHEN p.prev_target = 'FRAUD' THEN p.crime_burned + p.fraud_burned
    ELSE 0
  END
FROM prev p
WHERE ce.id = p.id
  AND p.path IN ('Burn', 'BurnAndSell')
  AND (p.crime_burned > 0 OR p.fraud_burned > 0)
  -- Only update rows where the assignment is actually wrong.
  -- If prev_target = 'CRIME' but crime_burned is already correct, skip.
  -- This makes the script idempotent.
  AND (
    (p.prev_target = 'CRIME' AND p.fraud_burned > 0)
    OR (p.prev_target = 'FRAUD' AND p.crime_burned > 0)
  );

-- Step 3: Verify the results
-- Show all carnage events after correction for manual inspection.
SELECT
  epoch_number,
  path,
  target_token AS buy_target,
  crime_burned,
  fraud_burned,
  crime_bought,
  fraud_bought,
  sol_used_for_buy
FROM carnage_events
ORDER BY epoch_number;

COMMIT;
