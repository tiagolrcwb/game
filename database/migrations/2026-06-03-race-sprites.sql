ALTER TABLE races
  ADD COLUMN sprite_manifest_path VARCHAR(255) NULL AFTER description,
  ADD COLUMN sprite_base_path VARCHAR(255) NULL AFTER sprite_manifest_path,
  ADD COLUMN idle_animation_key VARCHAR(80) NULL AFTER sprite_base_path,
  ADD COLUMN walk_animation_key VARCHAR(80) NULL AFTER idle_animation_key;

INSERT INTO races
  (name, description, sprite_manifest_path, sprite_base_path, idle_animation_key, walk_animation_key, is_active)
VALUES
  (
    'Humano',
    'Raca inicial padrao dos jogadores.',
    '/assets/6a199e83-bb2e-43a6-80d6-0548eede75a2/metadata.json',
    '/assets/6a199e83-bb2e-43a6-80d6-0548eede75a2',
    'idle',
    'animation-ca9dec37',
    1
  )
ON DUPLICATE KEY UPDATE
  sprite_manifest_path = VALUES(sprite_manifest_path),
  sprite_base_path = VALUES(sprite_base_path),
  idle_animation_key = VALUES(idle_animation_key),
  walk_animation_key = VALUES(walk_animation_key),
  is_active = 1;
