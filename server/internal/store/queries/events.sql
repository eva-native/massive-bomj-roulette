-- name: CreateEvent :one
INSERT INTO events (slug, title, settings, created_by, rules_version)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetEventBySlug :one
SELECT * FROM events WHERE slug = $1;

-- name: ListEvents :many
-- All events, newest first, with member counts and the given user's roles.
SELECT
    e.id, e.slug, e.title, e.status, e.created_at,
    (SELECT count(*) FROM event_members c WHERE c.event_id = e.id AND c.is_participant)::bigint AS participants,
    coalesce(m.is_participant, false)::boolean AS is_participant,
    coalesce(m.is_judge, false)::boolean AS is_judge
FROM events e
LEFT JOIN event_members m ON m.event_id = e.id AND m.user_id = sqlc.arg(user_id)
ORDER BY e.created_at DESC, e.id DESC;

-- name: UpdateEvent :one
UPDATE events
SET title = $2, settings = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpsertMember :one
-- Adds roles to a member; existing roles are kept.
INSERT INTO event_members (event_id, user_id, is_participant, is_judge)
VALUES ($1, $2, $3, $4)
ON CONFLICT (event_id, user_id) DO UPDATE
SET is_participant = event_members.is_participant OR EXCLUDED.is_participant,
    is_judge = event_members.is_judge OR EXCLUDED.is_judge
RETURNING *;

-- name: GetMember :one
SELECT * FROM event_members WHERE event_id = $1 AND user_id = $2;

-- name: ListMembers :many
SELECT m.user_id, m.is_participant, m.is_judge, m.joined_at, u.name, u.avatar_url
FROM event_members m
JOIN users u ON u.id = m.user_id
WHERE m.event_id = $1
ORDER BY m.joined_at, m.user_id;

-- name: SetMemberRoles :one
UPDATE event_members
SET is_participant = $3, is_judge = $4
WHERE event_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteMember :execrows
DELETE FROM event_members WHERE event_id = $1 AND user_id = $2;

-- name: CountJudges :one
SELECT count(*) FROM event_members WHERE event_id = $1 AND is_judge;
