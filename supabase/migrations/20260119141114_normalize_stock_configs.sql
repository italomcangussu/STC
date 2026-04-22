-- Normalize stock_automator_config values
-- Rule: iWill is iWill, others are Sentence Case (First Upper, rest Lower)
UPDATE stock_automator_config
SET 
    value = CASE 
        WHEN LOWER(value) = 'iwill' THEN 'iWill'
        ELSE UPPER(LEFT(value, 1)) || LOWER(RIGHT(value, -1))
    END,
    updated_at = NOW()
WHERE 
    (LOWER(value) = 'iwill' AND value != 'iWill')
    OR (LOWER(value) != 'iwill' AND value != (UPPER(LEFT(value, 1)) || LOWER(RIGHT(value, -1))));

-- Special case for connectives: although Sentence Case mostly handles them, 
-- if a name has multiple words like "Fone de Ouvido", my Sentence Case made it "Fone de ouvido" which is correct.
-- If there are any other connectives like "da", "do", "dos", "das", they are also lowercased by the LOWER(RIGHT(...)) part.
;
