package items

import (
	"fmt"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// Items whose points depend on a result entered by the player or the judge.
// Their points count once the judge confirms (Confirm in the catalog).

// duel is «100 к 1»: the winner gets the stake, the loser loses it.
type duel struct{}

func (duel) Score(c *game.ScoreCtx, l *game.Ledger) {
	opp, ok := c.InputPlayer("opponent")
	won, decided := c.Bool("won")
	if !ok || !decided {
		return
	}
	p := c.Param("stake")
	if !won {
		p = -p
	}
	l.Add(p)
	l.AddFor(opp, -p)
}

// winnerTakes is «Решим это по-мужски»: the winner gets points, the loser nothing.
type winnerTakes struct{}

func (winnerTakes) Score(c *game.ScoreCtx, l *game.Ledger) {
	opp, ok := c.InputPlayer("opponent")
	won, decided := c.Bool("won")
	switch {
	case !ok || !decided:
	case won:
		l.Add(c.Param("points"))
	default:
		l.AddFor(opp, c.Param("points"))
	}
}

// ifTrue gives points when a yes/no field is ticked («Шут», «Познавательный ЛБР»).
type ifTrue struct{ field string }

func (t ifTrue) Score(c *game.ScoreCtx, l *game.Ledger) {
	if v, _ := c.Bool(t.field); v {
		l.Add(c.Param("points"))
	}
}

// perUnit gives points for each unit of a number field («Денди»: per level).
type perUnit struct{ field string }

func (p perUnit) Score(c *game.ScoreCtx, l *game.Ledger) {
	if n, ok := c.Int(p.field); ok {
		l.Add(n * c.Param("points"))
	}
}

// eachListed takes points from every listed player («Групповая мастурбация»).
type eachListed struct{ field string }

func (e eachListed) Score(c *game.ScoreCtx, l *game.Ledger) {
	for _, p := range c.Players(e.field) {
		l.AddFor(p, c.Param("points"))
	}
}

// helperShare is «Френд-ассистед»: the helper gets a share of the base when
// the game is completed.
type helperShare struct{}

func (helperShare) Score(c *game.ScoreCtx, l *game.Ledger) {
	helper, ok := c.InputPlayer("helper")
	if ok && c.Outcome == game.OutcomeCompleted {
		l.AddFor(helper, game.Round(float64(c.Base)*float64(c.Param("percent"))/100))
	}
}

// shrek is «Я тебя шрекнул!»: every next roll is the next part.
type shrek struct{}

type shrekState struct {
	Part int `json:"part"`
}

func (shrek) Roll(c *game.Ctx, _ *game.TurnOps, self *game.Self) {
	self.SetState(shrekState{Part: c.CountEarlier("shrek") + 1})
}

func (shrek) Note(_ *game.Ctx, self *game.Self) string {
	var st shrekState
	if self.LoadState(&st) && st.Part > 0 {
		return fmt.Sprintf("Часть %d", st.Part)
	}
	return ""
}
