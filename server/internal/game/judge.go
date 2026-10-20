package game

import (
	"fmt"
	"strings"
)

// UndoLastStep lets a judge take back the last thing a player did in their
// current turn: a spin (with what it produced), a choice, or a finished game
// that is not confirmed yet. Earlier turns are closed and stay as they are.
func (e *Engine) UndoLastStep(s *State, judge, player PlayerID) (*Step, error) {
	r := e.on(s)
	if err := r.requireJudge(judge); err != nil {
		return nil, err
	}
	t := s.CurrentTurn(player)
	if t == nil {
		return nil, ErrUnknownPlayer
	}
	var last *Step
	for _, st := range t.Steps {
		if st.Done && (last == nil || st.DoneSeq > last.DoneSeq) {
			last = st
		}
	}
	if last == nil {
		return nil, fmt.Errorf("%w: в этом ходе ещё ничего не сделано", ErrNotAllowed)
	}
	if last.Kind == StepPlay {
		pt := s.Playthrough(t.Playthrough)
		pt.Outcome, pt.Hours, pt.Proof = OutcomeNone, 0, ""
		last.Done, last.DoneSeq = false, 0
		return last, nil
	}
	return last, r.rewindTo(t, last)
}

// EditPlaythrough lets a judge correct the hours and proof of a finished
// game, even a confirmed one. The outcome itself is not changed here: the
// next turn already depends on it.
func (e *Engine) EditPlaythrough(s *State, judge PlayerID, playthroughID int64, hours float64, proof string) error {
	if err := e.on(s).requireJudge(judge); err != nil {
		return err
	}
	pt := s.Playthrough(playthroughID)
	if pt == nil || pt.Outcome == OutcomeNone {
		return fmt.Errorf("%w: игра ещё не завершена", ErrNotAllowed)
	}
	switch {
	case pt.Outcome == OutcomeCompleted && hours <= 0:
		return fmt.Errorf("%w: укажите, за сколько часов пройдена игра", ErrBadInput)
	case hours < 0:
		return fmt.Errorf("%w: часы не могут быть отрицательными", ErrBadInput)
	}
	pt.Hours, pt.Proof = hours, strings.TrimSpace(proof)
	return nil
}
