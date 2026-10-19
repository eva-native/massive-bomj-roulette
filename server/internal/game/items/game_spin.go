package items

import (
	"slices"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// TieRule says what «две крутки» does when both games are equally long.
type TieRule int

const (
	TieChoose TieRule = iota // the player picks («ГЕРАЛЬТ»)
	TieSecond                // the second game wins («ДЖОННИ»)
)

// doubleGameSpin spins the game wheel twice and keeps the longer game.
// The hook runs after every game spin and looks at how many there were.
type doubleGameSpin struct{ tie TieRule }

func (d doubleGameSpin) ShapeGameWheel(c *game.Ctx, w *game.GameWheel, _ *game.Self) {
	// The second spin cannot land on the first game again.
	for _, g := range c.GameSpins() {
		w.Exclude(g.ID)
	}
}

func (d doubleGameSpin) OnGameSpun(c *game.Ctx, t *game.TurnOps, _ *game.Self) {
	spins := c.GameSpins()
	switch len(spins) {
	case 1:
		t.AddStep(game.StepSpinGame)
	case 2:
		a, b := spins[0], spins[1]
		switch {
		case a.HLTB > b.HLTB:
			t.SetGame(a.ID)
		case b.HLTB > a.HLTB:
			t.SetGame(b.ID)
		case d.tie == TieChoose:
			t.ChooseGame([]int64{a.ID, b.ID})
		default:
			t.SetGame(b.ID)
		}
	}
}

// borrowGame: the player picks a participant and spins only their games.
type borrowGame struct{}

type borrowState struct {
	Friend game.PlayerID `json:"friend"`
}

func (borrowGame) Roll(_ *game.Ctx, t *game.TurnOps, _ *game.Self) {
	t.AddStepBeforeGameSpin(game.StepChoosePlayer)
}

func (borrowGame) OnStepDone(_ *game.Ctx, step game.Step, self *game.Self) {
	if step.Kind == game.StepChoosePlayer {
		self.SetState(borrowState{Friend: game.PlayerID(step.Result)})
	}
}

func (borrowGame) ShapeGameWheel(_ *game.Ctx, w *game.GameWheel, self *game.Self) {
	var st borrowState
	if self.LoadState(&st) && st.Friend != 0 {
		w.OnlyAddedBy(st.Friend)
	}
}

// deal is «Сделка с пиксельным дьяволом»: one free reroll of the game, but
// every finished game comes back to the player's wheel.
type deal struct{}

type dealState struct {
	Used bool `json:"used"`
}

func (deal) CanUse(c *game.Ctx, self *game.Self) error {
	var st dealState
	if self.LoadState(&st) && st.Used {
		return errAlreadyUsed
	}
	if len(c.GameSpins()) == 0 {
		return errNoGameYet
	}
	return nil
}

func (deal) OnUse(_ *game.Ctx, u *game.UseOps, self *game.Self) error {
	if err := u.RedoGameSpin(); err != nil {
		return err
	}
	u.ResetWheel()
	self.SetState(dealState{Used: true})
	return nil
}

// luckyWheel is «Колесо удачи»: choose the game instead of spinning.
type luckyWheel struct{}

func (luckyWheel) OnUse(_ *game.Ctx, u *game.UseOps, _ *game.Self) error {
	return u.ReplaceGameSpinWithChoice()
}

// reroll is «Реролл»: the last spin never happened.
type reroll struct{}

func (reroll) OnUse(_ *game.Ctx, u *game.UseOps, _ *game.Self) error {
	return u.RedoLastSpin()
}

// replaceGame swaps the rolled game for a special one («Внезапный ДЭБ»).
type replaceGame struct{ key string }

func (r replaceGame) OnGameSpun(c *game.Ctx, t *game.TurnOps, _ *game.Self) {
	if g, ok := c.SpecialGame(r.key); ok && !slices.ContainsFunc(c.GameSpins(), func(x game.Game) bool { return x.ID == g.ID }) {
		t.SetGame(g.ID)
	}
}

func (borrowGame) Note(c *game.Ctx, self *game.Self) string {
	var st borrowState
	if self.LoadState(&st) && st.Friend != 0 {
		return "Друг: " + c.PlayerName(st.Friend)
	}
	return ""
}
