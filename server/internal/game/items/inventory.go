package items

import (
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

type alphabet struct{}

func (alphabet) CanUse(c *game.Ctx, _ *game.Self) error {
	if len(c.MatchingAlternatives()) == 0 {
		return game.ErrNotAllowed
	}
	return nil
}

func (alphabet) OnUse(c *game.Ctx, u *game.UseOps, _ *game.Self) error {
	return u.RedoWithGames(c.MatchingAlternatives())
}

type pickItem struct{ step game.StepKind }

func (p pickItem) WheelStep() game.StepKind { return p.step }

func (p pickItem) CanUse(c *game.Ctx, _ *game.Self) error {
	if !c.CanChooseItem(p.step) {
		return game.ErrNotAllowed
	}
	return nil
}

func (p pickItem) OnUse(_ *game.Ctx, u *game.UseOps, _ *game.Self) error {
	return u.ChooseItem(p.step)
}

type sharedFate struct{}

func (sharedFate) Roll(_ *game.Ctx, t *game.TurnOps, _ *game.Self) {
	t.AddStepBeforeGameSpin(game.StepChoosePlayer)
}

func (sharedFate) OnStepDone(_ *game.Ctx, step game.Step, self *game.Self) {
	self.SetState(game.PlayerID(step.Result))
}

func (sharedFate) Partner(self *game.Self) game.PlayerID {
	var partner game.PlayerID
	self.LoadState(&partner)
	return partner
}

type pocketAce struct{}

type aceState struct {
	Received time.Time
	Points   int
}

func (pocketAce) Roll(c *game.Ctx, _ *game.TurnOps, self *game.Self) {
	self.SetState(aceState{Received: time.Now().UTC()})
	if c.HeldByAnotherPlayer() {
		pocketAce{}.Activate(self)
	}
}

func (pocketAce) Activate(self *game.Self) {
	var st aceState
	self.LoadState(&st)
	st.Points = 1 + max(0, int(time.Since(st.Received)/(24*time.Hour)))
	self.SetState(st)
	self.SpendPocket()
}

func (pocketAce) OnUse(_ *game.Ctx, _ *game.UseOps, self *game.Self) error {
	pocketAce{}.Activate(self)
	return nil
}

func (pocketAce) Award(self *game.Self) int {
	var st aceState
	self.LoadState(&st)
	return st.Points
}
