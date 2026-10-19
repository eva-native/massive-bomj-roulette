-- name: UpsertUserByDiscordID :one
INSERT INTO users (discord_id, name, avatar_url)
VALUES ($1, $2, $3)
ON CONFLICT (discord_id) DO UPDATE
SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = now()
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;
