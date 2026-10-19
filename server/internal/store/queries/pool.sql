-- name: ListGames :many
SELECT g.*, u.name AS added_by_name
FROM games g
JOIN users u ON u.id = g.added_by
WHERE g.event_id = $1
ORDER BY g.title, g.id;

-- name: GetGame :one
SELECT * FROM games WHERE id = $1 AND event_id = $2;

-- name: CreateGame :one
INSERT INTO games (event_id, added_by, title, hltb_hours, rating, year, special_key)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateGame :one
UPDATE games
SET title = $3, hltb_hours = $4, rating = $5, year = $6, special_key = $7, updated_at = now()
WHERE id = $1 AND event_id = $2
RETURNING *;

-- name: DeleteGame :execrows
DELETE FROM games WHERE id = $1 AND event_id = $2;

-- name: ListMovies :many
SELECT mv.*, u.name AS added_by_name
FROM movies mv
JOIN users u ON u.id = mv.added_by
WHERE mv.event_id = $1
ORDER BY mv.title, mv.id;

-- name: GetMovie :one
SELECT * FROM movies WHERE id = $1 AND event_id = $2;

-- name: CreateMovie :one
INSERT INTO movies (event_id, added_by, title)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateMovie :one
UPDATE movies SET title = $3 WHERE id = $1 AND event_id = $2
RETURNING *;

-- name: DeleteMovie :execrows
DELETE FROM movies WHERE id = $1 AND event_id = $2;
