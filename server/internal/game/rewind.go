package game

import (
	"fmt"
	"slices"
)

// rewindTo undoes a done step and everything that happened because of it, so
// the step can be taken again:
//
//   - steps added by hooks after the step was done are removed;
//   - spins of the step and of removed steps are voided, and so are the items
//     they produced;
//   - a playthrough created after the step is deleted, and its items wait
//     for the next game again.
//
// It fails if a step that existed before (for example "play") is already done.
func (r *run) rewindTo(t *Turn, anchor *Step) error {
	i, _ := t.step(anchor.ID)
	if i < 0 || !anchor.Done {
		return fmt.Errorf("%w: the step is not done", ErrNotAllowed)
	}
	since := anchor.DoneSeq

	removed := map[int64]bool{}
	for _, st := range t.Steps[i+1:] {
		switch {
		case st.CreatedSeq > since:
			removed[st.ID] = true
		case st.Done:
			return ErrTooLate
		}
	}

	undo := map[int64]bool{anchor.ID: true}
	for id := range removed {
		undo[id] = true
	}
	for _, sp := range r.s.Spins {
		if sp.TurnID == t.ID && undo[sp.StepID] && !sp.Voided {
			sp.Voided = true
			for _, it := range r.s.Items {
				if it.SpinID == sp.ID && it.Placement != PlaceVoided {
					r.voidItem(it)
				}
			}
		}
	}

	if pt := r.s.Playthrough(t.Playthrough); pt != nil && pt.Seq > since {
		r.deletePlaythrough(t, pt)
	}

	t.Steps = slices.DeleteFunc(t.Steps, func(st *Step) bool { return removed[st.ID] })
	anchor.Done, anchor.DoneSeq, anchor.Result, anchor.SpinID = false, 0, 0, 0

	t.Game = 0
	for _, sp := range r.s.Spins {
		if sp.TurnID == t.ID && sp.Wheel == WheelGames && !sp.Voided {
			t.Game = sp.Picked().ID
		}
	}
	return nil
}

func (r *run) deletePlaythrough(t *Turn, pt *Playthrough) {
	r.s.Playthroughs = slices.DeleteFunc(r.s.Playthroughs, func(p *Playthrough) bool { return p == pt })
	t.Playthrough = 0
	for _, it := range r.s.Items {
		if !slices.Contains(it.Chain, pt.ID) {
			continue
		}
		it.Chain = slices.DeleteFunc(it.Chain, func(id int64) bool { return id == pt.ID })
		if len(it.Chain) > 0 || it.Placement != PlaceAttached {
			continue
		}
		if r.def(it).Kind == KindBonus && !it.Forced {
			it.Placement = PlacePocket // a bonus spent on this game goes back
		} else {
			it.Placement = PlacePending
		}
	}
}
