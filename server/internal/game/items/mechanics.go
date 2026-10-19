package items

import (
	"errors"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

var (
	errAlreadyUsed = errors.New("уже использовано")
	errNoGameYet   = errors.New("игра ещё не выпала")
)

// babina adds a movie wheel spin and gives +10 once the movie is watched and
// the judge confirms it.
type babina struct{}

type babinaState struct {
	Movie int64 `json:"movie"`
}

func (babina) OnAttach(_ *game.Ctx, t *game.TurnOps, _ *game.Self) {
	t.AddStep(game.StepSpinMovie)
}

func (babina) OnStepDone(_ *game.Ctx, step game.Step, self *game.Self) {
	if step.Kind == game.StepSpinMovie {
		self.SetState(babinaState{Movie: step.Result})
	}
}

func (babina) Score(c *game.ScoreCtx, l *game.Ledger) {
	if watched, _ := c.Bool("watched"); watched {
		l.Add(10)
	}
}

// noStepBack is «Ни шагу назад»: three games in a row. A drop costs 100% of
// the base instead of 50% and ends the chain; completing all three adds 30%
// of their combined base.
type noStepBack struct{}

func (noStepBack) Score(c *game.ScoreCtx, l *game.Ledger) {
	switch c.Outcome {
	case game.OutcomeDropped:
		l.Cancel(game.SourceDropPenalty)
		l.AddAs(game.SourceDropPenalty, -c.Base)
	case game.OutcomeCompleted:
		if c.Status.Index != c.Status.Total || len(c.Status.Chain) != c.Status.Total {
			return
		}
		sum := 0
		for _, g := range c.Status.Chain {
			if g.Outcome != game.OutcomeCompleted {
				return
			}
			sum += g.Base
		}
		l.Add(game.Round(0.3 * float64(sum)))
	}
}

// putinVote is «Голосование за Путина»: the next bonus the player rolls is
// activated at once instead of going to the pocket.
type putinVote struct{}

func (putinVote) OnItemRolled(_ *game.Ctx, rolled *game.RolledItem, self *game.Self) {
	if rolled.Kind() == game.KindBonus {
		rolled.ForceActivate()
		self.Finish()
	}
}

// parachute cancels the drop penalty, including «Ни шагу назад».
type parachute struct{}

func (parachute) Score(c *game.ScoreCtx, l *game.Ledger) {
	if c.Outcome == game.OutcomeDropped {
		l.Cancel(game.SourceDropPenalty)
	}
}

// veteran is «Закаленный ветеран»: if the game has no difficulty choice, the
// effect is rerolled.
type veteran struct{}

func (veteran) OnUse(_ *game.Ctx, u *game.UseOps, _ *game.Self) error {
	return u.RerollSelf()
}

func (babina) Note(c *game.Ctx, self *game.Self) string {
	var st babinaState
	if self.LoadState(&st) && st.Movie != 0 {
		if m, ok := c.Movie(st.Movie); ok {
			return "Фильм: " + m.Title
		}
	}
	return ""
}

func (putinVote) Note(_ *game.Ctx, self *game.Self) string {
	if self.Finished() {
		return "Сработало"
	}
	return "Ждёт следующий бонус"
}
