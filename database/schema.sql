CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename VARCHAR(190) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY schema_migrations_filename_unique (filename)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_settings (
  id TINYINT UNSIGNED NOT NULL,
  game_name VARCHAR(80) NOT NULL DEFAULT 'Vigilia dos Portoes',
  default_map_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maps (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  width_cells INT UNSIGNED NOT NULL DEFAULT 1000,
  height_cells INT UNSIGNED NOT NULL DEFAULT 1000,
  cell_size INT UNSIGNED NOT NULL DEFAULT 32,
  character_size INT UNSIGNED NOT NULL DEFAULT 64,
  movement_speed DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  entry_column INT UNSIGNED NOT NULL DEFAULT 1,
  entry_row INT UNSIGNED NOT NULL DEFAULT 1,
  background_color VARCHAR(20) NOT NULL DEFAULT '#15161d',
  background_image_path VARCHAR(255) NULL,
  map_data_path VARCHAR(255) NULL,
  grid_color VARCHAR(40) NOT NULL DEFAULT 'rgba(185, 139, 87, 0.08)',
  show_grid TINYINT(1) NOT NULL DEFAULT 1,
  show_coordinates TINYINT(1) NOT NULL DEFAULT 1,
  north_map_id INT UNSIGNED NULL,
  east_map_id INT UNSIGNED NULL,
  south_map_id INT UNSIGNED NULL,
  west_map_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY maps_north_map_id_index (north_map_id),
  KEY maps_east_map_id_index (east_map_id),
  KEY maps_south_map_id_index (south_map_id),
  KEY maps_west_map_id_index (west_map_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS races (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY races_name_unique (name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS character_classes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY character_classes_name_unique (name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

INSERT INTO maps (id, name, width_cells, height_cells, cell_size, character_size, movement_speed, entry_column, entry_row)
VALUES (1, 'Mapa Inicial', 1000, 1000, 32, 64, 5.00, 500, 500)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO game_settings (id, game_name, default_map_id)
VALUES (1, 'Vigilia dos Portoes', 1)
ON DUPLICATE KEY UPDATE id = id;
