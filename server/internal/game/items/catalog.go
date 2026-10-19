package items

import "github.com/eva-native/massive-bomj-roulette/server/internal/game"

// Defs returns every item of the catalog. Stage 1 holds the items that test
// the engine's mechanics; the rest of docs/rules is added in stage 4.
func Defs() []*game.Def {
	return []*game.Def{
		// --- effects ---
		FlatPoints("opaaa", "ОПАААА", "Получи плюс 4 очка.", 4),
		Text("reflex", game.KindEffect, "Мужской природный рефлекс",
			"Каждый раз, когда в сцене появляется женский персонаж, игрок ебашит по столу."),
		Blocker("plot_armor", game.KindEffect, "Плот Армор",
			"Дебаффы и эффекты на этой игре не влияют ни на геймплей, ни на очки.",
			game.KindEffect, game.KindDrop),
		build(&game.Def{
			ID: "babina", Kind: game.KindEffect, Name: "Бабина",
			Concept:      "После крутки колеса игр ты крутишь ещё и киноколесо: в нём фильмы, которые добавили участники ивента. Фильм, который ты уже посмотрел, тебе больше не выпадет. Можно смотреть вместе с друзьями, но очки получает только тот, кому выпал эффект: после того как он напишет «Посмотрено», ему начисляется +10.",
			NeedsConfirm: true,
			Input:        []game.Field{{Name: "watched", Label: "Посмотрено", Type: game.FieldBool, By: game.RolePlayer}},
			Impl:         babina{},
		}, nil),
		build(&game.Def{
			ID: "geralt", Kind: game.KindEffect, Name: "ГЕРАЛЬТ ДВЕ КРУТКИ",
			Concept: "Прокрути колесо игр ещё раз. Из двух выпавших игр выбери самую долгую. Если у них одинаковые часы HLTB, играй в любую.",
			Impl:    doubleGameSpin{tie: TieChoose},
		}, nil),
		build(&game.Def{
			ID: "borrow_game", Kind: game.KindEffect, Name: "Одолжи игру у друга",
			Concept: "Вместо обычного колеса игр ты сам выбираешь участника и крутишь колесо из игр, которые он добавил на ивент. Игры, которые ты уже прошёл или дропнул, в это колесо не попадают.",
			Impl:    borrowGame{},
		}, nil),
		build(&game.Def{
			ID: "no_step_back", Kind: game.KindEffect, Name: "Ни шагу назад",
			Concept: "Действует на текущую игру и 2 следующие.\n" +
				"- Дропнул одну из них: теряешь 100% базовых очков этой игры (вместо обычных 50%), и эффект заканчивается.\n" +
				"- Прошёл все три: получаешь +30% от суммы базовых очков трёх игр.\n" +
				"«Парашют» отменяет потерю целиком.",
			Lifetime:   3,
			EndsOnDrop: true,
			Impl:       noStepBack{},
		}, nil),
		build(&game.Def{
			ID: "putin_vote", Kind: game.KindEffect, Name: "Голосование за Путина",
			Concept:  "Следующий выпавший тебе бонус не кладётся в карман, а насильно активируется на игру, которая выпадет следом.",
			Lifetime: game.UntilDone,
			Impl:     putinVote{},
		}, nil),
		build(&game.Def{
			ID: "devil_deal", Kind: game.KindEffect, Name: "Сделка с пиксельным дьяволом",
			Concept: "Можешь бесплатно рерольнуть выпавшую игру и даже получить эффекты для новой. Но все игры, которые ты уже прошёл или дропнул, возвращаются в твоё колесо и снова могут тебе выпасть.",
			Use:     game.UseOffer,
			Impl:    deal{},
		}, nil),
		build(&game.Def{
			ID: "veteran", Kind: game.KindEffect, Name: "Закаленный ветеран",
			Concept: "Пройди игру на повышенной сложности. Если в игре нет стандартного выбора уровня сложности, эффект перекручивается.",
			Use:     game.UseOffer,
			Impl:    veteran{},
		}, nil),
		build(&game.Def{
			ID: "smuta", Kind: game.KindEffect, Name: "Внезапный ДЭБ",
			Concept:       "Заменяешь выпавшую игру на «Смуту». Очки за неё считаются по обычным правилам.",
			OncePerPlayer: true,
			Impl:          replaceGame{key: "smuta"},
		}, nil),

		// --- bonuses ---
		build(&game.Def{
			ID: "parachute", Kind: game.KindBonus, Name: "Парашют",
			Concept: "За дроп игры не теряешь очки, в том числе 100% от «Ни шагу назад».",
			Use:     game.UsePlaythrough,
			Impl:    parachute{},
		}, nil),
		build(&game.Def{
			ID: "reroll", Kind: game.KindBonus, Name: "Реролл",
			Concept: "Используй сразу после крутки любого колеса: старого результата как будто не было. Не привязан к игре.",
			Use:     game.UseAfterSpin,
			Impl:    reroll{},
		}, nil),
		build(&game.Def{
			ID: "lucky_wheel", Kind: game.KindBonus, Name: "Колесо удачи",
			Concept: "Используй этот бонус вместо крутки колеса игр: ты сам выбираешь игру с колеса.",
			Use:     game.UseInsteadOfGameSpin,
			Impl:    luckyWheel{},
		}, nil),

		// --- drop debuffs ---
		build(&game.Def{
			ID: "johnny", Kind: game.KindDrop, Name: "ДЖОННИ ДВЕ КРУТКИ",
			Concept: "Прокрути колесо игр ещё раз. Из двух выпавших игр выбери самую долгую. Если у них одинаковые часы HLTB, играй во вторую.",
			Impl:    doubleGameSpin{tie: TieSecond},
		}, nil),
		Blocker("self_sufficient", game.KindDrop, "Самодостаточный",
			"На эту игру нельзя использовать никакие бонусы, в том числе из кармана. Они остаются на потом.",
			game.KindBonus),
	}
}

// NewCatalog builds the catalog of all items.
func NewCatalog() (*game.Catalog, error) {
	return game.NewCatalog(Defs()...)
}
