package game

import (
	"math"
	"slices"
)

// Sources of points written by the engine itself.
const (
	SourceCompletion  = "completion"
	SourceSpeed       = "speed"
	SourceRecord      = "record"
	SourceDropPenalty = "drop_penalty"
)

// Entry is one line of the points ledger.
type Entry struct {
	Player      PlayerID
	Playthrough int64
	Item        int64 // 0 for points of the engine itself
	Source      string
	Points      int
	From        PlayerID // set when the points come from another player's game
}

type rating struct{ min, points int }

var (
	ratingPoints = []rating{{90, 1}, {81, 2}, {76, 3}, {71, 4}, {61, 5}, {51, 6}, {45, 7}, {0, 10}}
	yearPoints   = []rating{{2024, 1}, {2020, 2}, {2016, 3}, {2010, 4}, {2006, 5}, {2001, 7}, {0, 10}}
)

func lookup(table []rating, v int) int {
	for _, r := range table {
		if v >= r.min {
			return r.points
		}
	}
	return 0
}

// BasePoints = HLTB hours + rating points + year points.
func BasePoints(g Game) int {
	return g.HLTB + lookup(ratingPoints, g.Rating) + lookup(yearPoints, g.Year)
}

// Round rounds half away from zero.
func Round(x float64) int { return int(math.Round(x)) }

// ScoreCtx is what a Scorer sees: one item on one playthrough.
type ScoreCtx struct {
	Player PlayerID
	Game   Game
	Base   int
	// Outcome is set only after the judge confirmed it.
	Outcome Outcome
	Hours   float64
	// Status describes multi-game items; Index is 1-based.
	Status Status

	item *Item
}

type Status struct {
	Index int
	Total int
	Chain []ChainGame
}

type ChainGame struct {
	Base    int
	Outcome Outcome // confirmed outcome only
}

func (c *ScoreCtx) Bool(name string) (bool, bool) {
	v, ok := c.item.Input[name].(bool)
	return v, ok
}

func (c *ScoreCtx) Int(name string) (int, bool) { return toInt(c.item.Input[name]) }

// Players reads a list-of-participants field.
func (c *ScoreCtx) Players(name string) []PlayerID {
	return (&Self{item: c.item}).Players(name)
}

func (c *ScoreCtx) InputPlayer(name string) (PlayerID, bool) {
	n, ok := toInt(c.item.Input[name])
	return PlayerID(n), ok
}

// Ledger collects the points of one playthrough.
type Ledger struct {
	owner   PlayerID
	pt      int64
	item    int64
	source  string
	entries []Entry
}

func (l *Ledger) add(p PlayerID, source string, points int) {
	if points == 0 {
		return
	}
	e := Entry{Player: p, Playthrough: l.pt, Item: l.item, Source: source, Points: points}
	if p != l.owner {
		e.From = l.owner
	}
	l.entries = append(l.entries, e)
}

// Add gives points to the owner of the game.
func (l *Ledger) Add(points int) { l.add(l.owner, l.source, points) }

// AddFor gives points to another player.
func (l *Ledger) AddFor(p PlayerID, points int) { l.add(p, l.source, points) }

// AddAs gives the owner points under another source, so they can be cancelled
// together with it («Ни шагу назад» writes its penalty as drop_penalty).
func (l *Ledger) AddAs(source string, points int) { l.add(l.owner, source, points) }

// Cancel removes the owner's points of a source on this game and returns
// their sum.
func (l *Ledger) Cancel(source string) int {
	sum := 0
	l.entries = slices.DeleteFunc(l.entries, func(e Entry) bool {
		if e.Player == l.owner && e.Source == source {
			sum += e.Points
			return true
		}
		return false
	})
	return sum
}

// Score recomputes all points of the event.
func (e *Engine) Score(s *State) []Entry {
	r := e.on(s)
	records := r.records()
	var out []Entry
	for _, pt := range s.Playthroughs {
		out = append(out, r.scorePlaythrough(pt, records)...)
	}
	return out
}

// records maps a game to the fastest confirmed completion (earliest on a tie).
func (r *run) records() map[int64]*Playthrough {
	best := map[int64]*Playthrough{}
	for _, pt := range r.s.Playthroughs {
		if !pt.Confirmed || pt.Outcome != OutcomeCompleted {
			continue
		}
		if b := best[pt.Game]; b == nil || pt.Hours < b.Hours || pt.Hours == b.Hours && pt.Seq < b.Seq {
			best[pt.Game] = pt
		}
	}
	return best
}

func (r *run) scorePlaythrough(pt *Playthrough, records map[int64]*Playthrough) []Entry {
	g := r.s.Game(pt.Game)
	base := BasePoints(*g)
	l := &Ledger{owner: pt.Player, pt: pt.ID}

	outcome := OutcomeNone
	if pt.Confirmed {
		outcome = pt.Outcome
	}
	switch outcome {
	case OutcomeCompleted:
		l.add(pt.Player, SourceCompletion, base)
		l.add(pt.Player, SourceSpeed, Round(float64(g.HLTB)-pt.Hours))
		if records[pt.Game] == pt {
			l.add(pt.Player, SourceRecord, 1)
		}
	case OutcomeDropped:
		l.add(pt.Player, SourceDropPenalty, -base/2)
	}

	var group []*Item
	for _, it := range r.s.Items {
		if it.Placement != PlaceVoided && slices.Contains(it.Chain, pt.ID) {
			group = append(group, it)
		}
	}
	order := map[Kind]int{KindEffect: 0, KindDrop: 1, KindBonus: 2}
	slices.SortStableFunc(group, func(a, b *Item) int {
		if d := order[r.def(a).Kind] - order[r.def(b).Kind]; d != 0 {
			return d
		}
		return int(a.Seq - b.Seq)
	})

	for _, it := range group {
		d := r.def(it)
		sc, ok := d.Impl.(Scorer)
		if !ok || r.blocked(it, group) || d.NeedsConfirm && !it.Confirmed {
			continue
		}
		c := &ScoreCtx{Player: pt.Player, Game: *g, Base: base, Outcome: outcome, Hours: pt.Hours, item: it}
		if d.multiGame() {
			c.Status = r.status(it, pt, d)
		}
		l.item, l.source = it.ID, it.DefID
		sc.Score(c, l)
	}
	return l.entries
}

func (r *run) status(it *Item, pt *Playthrough, d *Def) Status {
	st := Status{Total: d.lifetime()}
	for i, id := range it.Chain {
		p := r.s.Playthrough(id)
		if p == nil {
			continue
		}
		cg := ChainGame{Base: BasePoints(*r.s.Game(p.Game))}
		if p.Confirmed {
			cg.Outcome = p.Outcome
		}
		st.Chain = append(st.Chain, cg)
		if id == pt.ID {
			st.Index = i + 1
		}
	}
	return st
}

// Totals sums entries per player.
func Totals(entries []Entry) map[PlayerID]int {
	out := map[PlayerID]int{}
	for _, e := range entries {
		out[e.Player] += e.Points
	}
	return out
}
