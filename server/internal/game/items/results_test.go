package items_test

import (
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func (sc *scenario) input(actor game.PlayerID, it *game.Item, values map[string]any) {
	sc.t.Helper()
	if err := sc.e.SetInput(sc.s, actor, it.ID, values); err != nil {
		sc.t.Fatalf("input %s: %v", it.DefID, err)
	}
}

func (sc *scenario) confirmItem(it *game.Item) {
	sc.t.Helper()
	if err := sc.e.ConfirmItem(sc.s, sc.judge, it.ID, true); err != nil {
		sc.t.Fatalf("confirm %s: %v", it.DefID, err)
	}
}

// startGame spins three effects (the first given ones, then reflex) and a game.
func startGame(sc *scenario, p game.PlayerID, gameTitle string, effects ...string) {
	sc.t.Helper()
	for len(effects) < 3 {
		effects = append(effects, "reflex")
	}
	spinItems(sc, p, effects...)
	sc.spin(p, gameTitle)
}

func TestDuelMovesPointsBetweenPlayers(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "sto_k_odnomu")
	duel := sc.item(a, "sto_k_odnomu")

	sc.input(a, duel, map[string]any{"opponent": int(b), "won": false})
	sc.expectTotal(b, 0) // waits for the judge
	sc.confirmItem(duel)
	sc.expectTotal(a, -5)
	sc.expectTotal(b, 5) // points count before the game ends
}

func TestRPSWinnerTakesAll(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "rps")
	rps := sc.item(a, "rps")
	sc.input(a, rps, map[string]any{"opponent": int(b), "won": true})
	sc.confirmItem(rps)
	sc.expectTotal(a, 5)
	sc.expectTotal(b, 0)
}

func TestJesterNeedsTheJudge(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "jester")
	j := sc.item(a, "jester")

	sc.input(a, j, map[string]any{"meme": "https://imgur.com/meme"})
	expectErr(t, sc.e.SetInput(sc.s, a, j.ID, map[string]any{"liked": true}), game.ErrNotAllowed) // the judge decides
	sc.input(sc.judge, j, map[string]any{"liked": true})
	sc.confirmItem(j)
	sc.expectTotal(a, 3)
}

func TestDendyAndDocumentary(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "dendy", "documentary")
	d, doc := sc.item(a, "dendy"), sc.item(a, "documentary")
	sc.input(a, d, map[string]any{"levels": float64(7)}) // as it arrives from JSON
	sc.input(a, doc, map[string]any{"watched": true})
	sc.confirmItem(d)
	sc.confirmItem(doc)
	sc.expectTotal(a, 7+10)
}

func TestGroupBowFinesEveryLatePlayer(t *testing.T) {
	sc := newScenario(t)
	a, b, c := sc.player("Алиса"), sc.player("Боб"), sc.player("Вика")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "group_bow")
	g := sc.item(a, "group_bow")
	sc.input(sc.judge, g, map[string]any{"late": []any{int(a), int(c)}})
	sc.confirmItem(g)
	sc.expectTotal(a, -5)
	sc.expectTotal(b, 0)
	sc.expectTotal(c, -5)
}

func TestFriendAssistSharesTheBase(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G", 10, 80, 2015, a) // base 17
	startGame(sc, a, "G", "friend_assist")
	fa := sc.item(a, "friend_assist")
	if fa.Placement != game.PlacePocket {
		t.Fatal("the bonus waits in the pocket")
	}
	sc.mustUse(a, "friend_assist")
	sc.input(a, fa, map[string]any{"helper": int(b)})
	sc.confirmItem(fa)
	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+1)
	sc.expectTotal(b, 9) // 50% of 17 = 8.5 → 9
}

func TestShrekCountsParts(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	spinItems(sc, a, "shrek", "shrek", "reflex")
	var notes []string
	for _, it := range sc.s.Items {
		if it.DefID == "shrek" {
			notes = append(notes, sc.e.Note(sc.s, it.ID))
		}
	}
	if len(notes) != 2 || notes[0] != "Часть 1" || notes[1] != "Часть 2" {
		t.Fatalf("notes = %v", notes)
	}
}

func TestZemskySoborIsItsOwnSpecialGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	sc.s.AddGame(game.Game{Title: "Смута", HLTB: 12, Rating: 40, Year: 2024, SpecialKey: "smuta"})
	sc.s.AddGame(game.Game{Title: "Земский собор", HLTB: 5, Rating: 30, Year: 2024, SpecialKey: "zemsky_sobor"})
	startGame(sc, a, "G", "zemsky_sobor")
	if got := sc.currentGame(a); got != "Земский собор" {
		t.Fatalf("game = %q", got)
	}
}

func TestProofTasksNeedTheJudge(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "mc_trup")
	mc := sc.item(a, "mc_trup")
	expectErr(t, sc.e.SetInput(sc.s, a, mc.ID, map[string]any{"proof": "not a link"}), game.ErrBadInput)
	sc.input(a, mc, map[string]any{"proof": "https://youtu.be/song"})
	sc.confirmItem(mc)
	if !sc.item(a, "mc_trup").Confirmed {
		t.Fatal("the task should be confirmed")
	}
}

func TestVaultBornBlocksEffectsOnceUsed(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a) // base 17
	startGame(sc, a, "G", "vault_born", "opaaa", "minus6")
	sc.mustUse(a, "vault_born")
	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+1) // neither +4 nor −6
}

func TestLawsuitCanBeUsedAnytime(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G", 10, 80, 2015, a)
	sc.spin(a, "lawsuit")
	sc.mustUse(a, "lawsuit") // in the middle of the item spins
	ls := sc.item(a, "lawsuit")
	if ls.Placement != game.PlaceUsed {
		t.Fatalf("placement = %s", ls.Placement)
	}
	sc.input(a, ls, map[string]any{"target": int(b)})
	sc.input(sc.judge, ls, map[string]any{"verdict": "Компромисс: Боб проходит игру на лёгкой сложности"})
	sc.confirmItem(ls)
}

func TestTextBonusesWorkOnAGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	spinItems(sc, a, "cheater", "nothing", "reflex")
	expectErr(t, sc.use(a, "cheater"), game.ErrNotAllowed) // not before the game
	sc.spin(a, "G")
	sc.mustUse(a, "cheater")
	if it := sc.item(a, "cheater"); it.Placement != game.PlaceAttached {
		t.Fatalf("placement = %s", it.Placement)
	}
}
