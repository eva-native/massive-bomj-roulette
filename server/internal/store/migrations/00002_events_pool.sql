-- +goose Up
CREATE TABLE events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        text        NOT NULL UNIQUE,
    title       text        NOT NULL,
    status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    -- Rule parameters of the event; mirrors game.Settings.
    settings    jsonb       NOT NULL DEFAULT '{}',
    created_by  bigint      NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Roles are flags and can be combined: a judge may also play.
CREATE TABLE event_members (
    event_id        bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    is_participant  boolean     NOT NULL DEFAULT false,
    is_judge        boolean     NOT NULL DEFAULT false,
    joined_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX event_members_user_id_idx ON event_members (user_id);

CREATE TABLE games (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id     bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    added_by     bigint      NOT NULL REFERENCES users (id),
    title        text        NOT NULL,
    hltb_hours   integer     NOT NULL CHECK (hltb_hours >= 0),
    rating       integer     NOT NULL CHECK (rating BETWEEN 0 AND 100),
    year         integer     NOT NULL,
    -- Set for games provided by items («Смута», «Земский собор»); they never
    -- appear on the regular game wheel.
    special_key  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX games_event_id_idx ON games (event_id);
CREATE UNIQUE INDEX games_special_key_idx ON games (event_id, special_key) WHERE special_key IS NOT NULL;

CREATE TABLE movies (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    added_by    bigint      NOT NULL REFERENCES users (id),
    title       text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX movies_event_id_idx ON movies (event_id);

-- +goose Down
DROP TABLE movies;
DROP TABLE games;
DROP TABLE event_members;
DROP TABLE events;
