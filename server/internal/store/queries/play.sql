-- name: LockEvent :exec
-- Serializes writes to one event until the transaction ends.
SELECT pg_advisory_xact_lock($1);

-- name: GetEventState :one
SELECT state, version FROM event_states WHERE event_id = $1;

-- name: SaveEventState :exec
INSERT INTO event_states (event_id, state)
VALUES ($1, $2)
ON CONFLICT (event_id) DO UPDATE
SET state = EXCLUDED.state, version = event_states.version + 1, updated_at = now();

-- name: AddActivity :one
INSERT INTO activity (event_id, actor_id, kind, message, payload)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListActivity :many
SELECT a.*, coalesce(u.name, '') AS actor_name
FROM activity a
LEFT JOIN users u ON u.id = a.actor_id
WHERE a.event_id = $1
ORDER BY a.id DESC
LIMIT $2;

-- name: GetUsers :many
SELECT * FROM users WHERE id = ANY(sqlc.arg(ids)::bigint[]);
