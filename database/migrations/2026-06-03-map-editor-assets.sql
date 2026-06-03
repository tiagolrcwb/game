ALTER TABLE maps
  ADD COLUMN background_image_path VARCHAR(255) NULL AFTER background_color;

ALTER TABLE maps
  ADD COLUMN map_data_path VARCHAR(255) NULL AFTER background_image_path;
