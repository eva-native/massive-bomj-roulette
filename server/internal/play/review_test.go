package play

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
)

func TestEditOwnReview(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "G", 10, 80, 2015)
	for i := 0; i < 3; i++ {
		f.spin(f.alice, "opaaa")
	}
	f.spin(f.alice, "G")
	id := f.view(f.alice).Turn.Playthrough.ID
	if err := f.play.EditReview(f.ctx, "lbr", f.alice, id, api.EditReviewRequest{Review: "Рано"}); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("editing unfinished game: %v", err)
	}
	if _, err := f.play.Finish(f.ctx, "lbr", f.alice, f.view(f.alice).Turn.Current.ID, api.FinishRequest{Outcome: "completed", Hours: 8, Proof: "https://proof.test", Review: "Обзор"}); err != nil {
		t.Fatal(err)
	}
	if err := f.play.EditReview(f.ctx, "lbr", f.alice, id, api.EditReviewRequest{Review: "До подтверждения"}); err != nil {
		t.Fatal(err)
	}
	if err := f.play.ConfirmGame(f.ctx, "lbr", f.admin, id, true, ""); err != nil {
		t.Fatal(err)
	}
	before := f.view(f.alice)
	ss, err := f.play.read(f.ctx, "lbr", f.alice)
	if err != nil {
		t.Fatal(err)
	}
	stream, unsubscribe := f.broker.Subscribe(ss.ev.ID)
	defer unsubscribe()
	if err := f.play.EditReview(f.ctx, "lbr", f.alice, id, api.EditReviewRequest{Review: "  После подтверждения  "}); err != nil {
		t.Fatal(err)
	}
	after := f.view(f.alice)
	if after.History[0].Review != "После подтверждения" {
		t.Fatalf("review = %q", after.History[0].Review)
	}
	after.History[0].Review = before.History[0].Review
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("review edit changed scoring, confirmation or turn: before=%+v after=%+v", before, after)
	}
	select {
	case msg := <-stream:
		if msg.Kind != "review" {
			t.Fatalf("SSE kind = %q", msg.Kind)
		}
	default:
		t.Fatal("review edit did not publish an update")
	}
	acts, err := f.play.Activity(f.ctx, "lbr", 1)
	if err != nil || len(acts) != 1 || acts[0].Kind != "review" {
		t.Fatalf("review activity: %v %v", acts, err)
	}
	for _, tc := range []struct {
		name   string
		review string
	}{
		{"empty", "  "},
		{"too long", strings.Repeat("я", api.MaxReview+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var invalid *events.InvalidError
			if err := f.play.EditReview(f.ctx, "lbr", f.alice, id, api.EditReviewRequest{Review: tc.review}); !errors.As(err, &invalid) {
				t.Fatalf("invalid review: %v", err)
			}
		})
	}
	if err := f.play.EditReview(f.ctx, "lbr", f.bob, id, api.EditReviewRequest{Review: "Чужой"}); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("editing another player's review: %v", err)
	}
	if err := f.play.EditReview(f.ctx, "lbr", nil, id, api.EditReviewRequest{Review: "Без входа"}); !errors.Is(err, events.ErrUnauthenticated) {
		t.Fatalf("anonymous edit: %v", err)
	}
	if err := f.play.EditReview(f.ctx, "lbr", f.alice, -1, api.EditReviewRequest{Review: "Нет игры"}); !errors.Is(err, events.ErrNotFound) {
		t.Fatalf("missing game: %v", err)
	}
	if err := f.play.FinishEvent(f.ctx, "lbr", f.admin); err != nil {
		t.Fatal(err)
	}
	if err := f.play.EditReview(f.ctx, "lbr", f.alice, id, api.EditReviewRequest{Review: "Поздно"}); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("editing frozen event: %v", err)
	}
}
