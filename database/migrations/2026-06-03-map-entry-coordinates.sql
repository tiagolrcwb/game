ALTER TABLE maps
  ADD COLUMN entry_column INT UNSIGNED NOT NULL DEFAULT 1 AFTER character_size;

ALTER TABLE maps
  ADD COLUMN entry_row INT UNSIGNED NOT NULL DEFAULT 1 AFTER entry_column;

UPDATE maps
SET entry_column = GREATEST(1, FLOOR(width_cells / 2)),
    entry_row = GREATEST(1, FLOOR(height_cells / 2))
WHERE entry_column = 1
  AND entry_row = 1;
