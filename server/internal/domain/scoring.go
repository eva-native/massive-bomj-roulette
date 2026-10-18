package domain

import "math"

type threshold struct {
	min int
	pts int
}

var ratingTable = []threshold{
	{90, 1}, {81, 2}, {76, 3}, {71, 4}, {61, 5}, {51, 6}, {45, 7}, {0, 10},
}

var yearTable = []threshold{
	{2024, 1}, {2020, 2}, {2016, 3}, {2010, 4}, {2006, 5}, {2001, 7}, {0, 10},
}

func lookup(table []threshold, value int) int {
	for _, t := range table {
		if value >= t.min {
			return t.pts
		}
	}
	return 0
}

func RatingPoints(rating int) int {
	return lookup(ratingTable, rating)
}

func YearPoints(year int) int {
	return lookup(yearTable, year)
}

func BasePoints(game Game) int {
	return game.HLTBHours + RatingPoints(game.Rating) + YearPoints(game.Year)
}

func hasParachute(b *AppliedBonus, parachuteDefID int64) bool {
	return b != nil && b.DefID == parachuteDefID
}

type ScoringConfig struct {
	ParachuteBonusID int64
}

func ComputeEntries(p Playthrough, g Game, cfg ScoringConfig) []PointEntry {
	var out []PointEntry
	add := func(src PointSource, pts int, srcPlayer *int64) {
		out = append(out, PointEntry{
			PlayerID:       p.PlayerID,
			PlaythroughID:  p.ID,
			Source:         src,
			Points:         pts,
			SourcePlayerId: srcPlayer,
		})
	}

	if p.Status == StatusDropped {
		if !hasParachute(p.Bonus, cfg.ParachuteBonusID) {
			add(SourceDrop, -BasePoints(g)/2, nil)
		}
		if p.DropDebuff != nil {
			add(SourceDropDebuff, p.DropDebuff.Resolved, nil)
		}
		return out
	}

	if p.Status != StatusCompleted {
		return out
	}

	add(SourceCompletion, BasePoints(g), nil)

	spent := p.TimeSpent.Hours()
	speed := int(math.Round(float64(g.HLTBHours) - spent))

	if speed != 0 {
		add(SourceSpeed, speed, nil)
	}

	if p.Effect != nil {
		add(SourceEffect, p.Effect.Resolved, nil)
	}

	if p.Bonus != nil {
		if p.Bonus.Resolved != 0 {
			add(SourceBonus, p.Bonus.Resolved, nil)
		}
		if p.Bonus.AffectsPlayerID != nil {
			share := int(math.Round(float64(BasePoints(g)) * p.Bonus.AffectShare))
			out = append(out, PointEntry{
				PlayerID:       *p.Bonus.AffectsPlayerID,
				PlaythroughID:  p.ID,
				Source:         SourceAssist,
				Points:         share,
				SourcePlayerId: &p.PlayerID,
			})
		}
	}

	if p.IsRecord {
		add(SourceRecord, 1, nil)
	}

	return out
}

func Total(entries []PointEntry, playerID int64) int {
	sum := 0
	for _, e := range entries {
		if e.PlayerID == playerID {
			sum += e.Points
		}
	}
	return sum
}
