-- +goose Up
-- What the rules engine creates during play (turns, steps, spins, items,
-- playthroughs) is kept as one document per event. Players, games, movies
-- and settings live in their own tables and are joined in when loading.
CREATE TABLE event_states (
    event_id    bigint      PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
    state       jsonb       NOT NULL,
    version     bigint      NOT NULL DEFAULT 1,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The event journal: the live feed, history and audit of every action.
CREATE TABLE activity (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    actor_id    bigint      REFERENCES users (id),
    kind        text        NOT NULL,
    message     text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_event_id_idx ON activity (event_id, id DESC);

-- +goose Down
DROP TABLE activity;
DROP TABLE event_states;
