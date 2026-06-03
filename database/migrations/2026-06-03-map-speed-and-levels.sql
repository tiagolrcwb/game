ALTER TABLE maps
  ADD COLUMN movement_speed DECIMAL(5,2) NOT NULL DEFAULT 5.00 AFTER character_size;
