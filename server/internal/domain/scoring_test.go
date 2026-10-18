package domain_test

import (
	"testing"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/domain"
)

// GTA San Andreas из таблицы: HLTB 30, рейтинг 87, год 2004 → стандартные 39.
func TestStandardPoints(t *testing.T) {
	g := domain.Game{HLTBHours: 30, Rating: 87, Year: 2004}
	if got := domain.BasePoints(g); got != 39 {
		t.Fatalf("base points for GTA SA: 39, expected %d", got)
	}

	// Проверим граничные значения lookup-таблиц.
	cases := []struct {
		rating, year, want int
	}{
		{87, 2004, 2 + 7},  // rating->2, year->7
		{91, 1998, 1 + 10}, // rating->1 (>=90), year->10 (<2001)
		{45, 2024, 7 + 1},  // rating->7 (>=45), year->1 (>=2024)
		{44, 2020, 10 + 2}, // rating->10 (<45), year->2
	}
	for _, c := range cases {
		got := domain.RatingPoints(c.rating) + domain.YearPoints(c.year)
		if got != c.want {
			t.Errorf("rating=%d year=%d: %d, expected %d", c.rating, c.year, c.want, got)
		}
	}
}

// Полное прохождение: стандартные + скорость + эффект + рекорд.
func TestComputeEntries_Completed(t *testing.T) {
	g := domain.Game{ID: 3, HLTBHours: 30, Rating: 87, Year: 2004} // стандартные 39
	p := domain.Playthrough{
		ID:        1,
		PlayerID:  1,
		GameID:    3,
		Status:    domain.StatusCompleted,
		TimeSpent: 25 * time.Hour,                               // быстрее HLTB на 5 → +5
		Effect:    &domain.AppliedEffect{DefID: 6, Resolved: 4}, // ОПАААА +4
		IsRecord:  true,                                         // +1
	}
	entries := domain.ComputeEntries(p, g, domain.ScoringConfig{ParachuteBonusID: 1})
	total := domain.Total(entries, 1)
	want := 39 + 5 + 4 + 1 // = 49
	if total != want {
		t.Fatalf("итог завершённой игры: ждём %d, получили %d (%+v)", want, total, entries)
	}
}

// Дроп без «Парашюта»: −50% стандартных + дроп-дебафф.
func TestComputeEntries_Dropped(t *testing.T) {
	g := domain.Game{ID: 3, HLTBHours: 30, Rating: 87, Year: 2004} // стандартные 39
	p := domain.Playthrough{
		ID:         2,
		PlayerID:   1,
		GameID:     3,
		Status:     domain.StatusDropped,
		DropDebuff: &domain.AppliedEffect{DefID: 100, Resolved: -3},
	}
	total := domain.Total(domain.ComputeEntries(p, g, domain.ScoringConfig{ParachuteBonusID: 1}), 1)
	want := -39/2 + -3 // = -19 + -3 = -22
	if total != want {
		t.Fatalf("итог дропа: ждём %d, получили %d", want, total)
	}
}

// Дроп с «Парашютом»: штраф −50% обнуляется, остаётся только дебафф.
func TestComputeEntries_DroppedWithParachute(t *testing.T) {
	g := domain.Game{ID: 3, HLTBHours: 30, Rating: 87, Year: 2004}
	p := domain.Playthrough{
		ID:         3,
		PlayerID:   1,
		GameID:     3,
		Status:     domain.StatusDropped,
		Bonus:      &domain.AppliedBonus{DefID: 1}, // Парашют
		DropDebuff: &domain.AppliedEffect{DefID: 100, Resolved: -3},
	}
	total := domain.Total(domain.ComputeEntries(p, g, domain.ScoringConfig{ParachuteBonusID: 1}), 1)
	if total != -3 {
		t.Fatalf("дроп с Парашютом: ждём -3, получили %d", total)
	}
}

// Будущий бонус-ассист: доля очков уходит напарнику отдельной строкой.
func TestComputeEntries_AssistFuture(t *testing.T) {
	g := domain.Game{ID: 3, HLTBHours: 30, Rating: 87, Year: 2004} // стандартные 39
	mate := int64(2)
	p := domain.Playthrough{
		ID:        4,
		PlayerID:  1,
		GameID:    3,
		Status:    domain.StatusCompleted,
		TimeSpent: 30 * time.Hour, // ровно HLTB → скорость 0
		Bonus:     &domain.AppliedBonus{DefID: 3, AffectsPlayerID: &mate, AffectShare: 0.5},
	}
	entries := domain.ComputeEntries(p, g, domain.ScoringConfig{ParachuteBonusID: 1})
	if got := domain.Total(entries, 1); got != 39 {
		t.Errorf("очки владельца: ждём 39, получили %d", got)
	}
	if got := domain.Total(entries, mate); got != 20 { // round(39*0.5)=20
		t.Errorf("очки напарника: ждём 20, получили %d", got)
	}
}
