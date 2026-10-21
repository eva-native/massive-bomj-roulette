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

-- name: GetFrozen :one
SELECT frozen FROM event_states WHERE event_id = $1;

-- name: FreezeEvent :exec
UPDATE event_states SET frozen = $2 WHERE event_id = $1;

-- name: SetEventStatus :exec
UPDATE events SET status = $2, updated_at = now() WHERE id = $1;

-- name: ListActiveEvents :many
SELECT id, slug, rules_version FROM events WHERE status = 'active' ORDER BY id;

-- name: SetRulesVersion :exec
UPDATE events SET rules_version = $2 WHERE id = $1;

-- name: ListPlaySessions :many
SELECT * FROM play_sessions
WHERE event_id = $1 AND playthrough_id = $2
ORDER BY started_at, id;

-- name: PlaySessionTotals :many
-- Time per playthrough of the event, for the judge's queue.
SELECT playthrough_id, sum(duration_ms)::bigint AS total_ms
FROM play_sessions
WHERE event_id = $1
GROUP BY playthrough_id;

-- name: GetPlaySession :one
SELECT * FROM play_sessions WHERE id = $1 AND event_id = $2;

-- name: AddPlaySession :one
INSERT INTO play_sessions (event_id, user_id, playthrough_id, started_at, duration_ms)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdatePlaySession :one
UPDATE play_sessions SET duration_ms = $3, updated_at = now()
WHERE id = $1 AND event_id = $2
RETURNING *;

-- name: DeletePlaySession :exec
DELETE FROM play_sessions WHERE id = $1 AND event_id = $2;
