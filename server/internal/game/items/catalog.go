package items

import (
	"fmt"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

var (
	opponent = field("opponent", "Соперник", game.FieldPlayer, game.RolePlayer)
	won      = field("won", "Победа", game.FieldBool, game.RolePlayer)
	watched  = field("watched", "Посмотрено", game.FieldBool, game.RolePlayer)
)

// Defs returns every item of docs/rules with its mechanics, in the order of
// the documents.
func Defs() []*game.Def {
	byID := map[string]*game.Def{}
	for _, d := range []*game.Def{
		// --- effects: points ---
		FlatPoints("opaaa", 4),
		FlatPoints("plus8", 8),
		FlatPoints("minus3", -3),
		FlatPoints("minus6", -6),
		Text("nothing"),

		// --- effects: points by result ---
		def("sto_k_odnomu", Input(opponent, won), Confirm(), Impl(duel{stake: 5})),
		def("rps", Input(opponent, won), Confirm(), Impl(winnerTakes{points: 5})),
		def("jester",
			Input(optional(field("meme", "Мемчик (ссылка)", game.FieldURL, game.RolePlayer)),
				field("liked", "Понравился судье", game.FieldBool, game.RoleJudge)),
			Confirm(), Impl(ifTrue{field: "liked", points: 3})),
		def("dendy", Input(field("levels", "Пройдено уровней", game.FieldInt, game.RolePlayer)), Confirm(),
			Impl(perUnit{field: "levels", points: 1})),
		def("babina", Input(watched), Confirm(), Impl(babina{})),
		def("documentary", Input(watched), Confirm(), Impl(ifTrue{field: "watched", points: 10})),
		def("group_bow", Input(field("late", "Опоздали", game.FieldPlayers, game.RoleJudge)), Confirm(),
			Impl(eachListed{field: "late", points: -5})),

		// --- effects: several games ---
		def("no_step_back", Lifetime(3), EndsOnDrop(), Impl(noStepBack{})),

		// --- effects: game choice ---
		def("borrow_game", Impl(borrowGame{})),
		def("geralt", Impl(doubleGameSpin{tie: TieChoose})),
		def("smuta", OncePerPlayer(), Special("smuta", "Смута"), Impl(replaceGame{key: "smuta"})),
		def("zemsky_sobor", OncePerPlayer(), Special("zemsky_sobor", "Земский собор"), Impl(replaceGame{key: "zemsky_sobor"})),
		def("devil_deal", Use(game.UseOffer), Impl(deal{})),
		def("veteran", Use(game.UseOffer), Impl(veteran{})),

		// --- effects: protection and statuses ---
		Blocker("plot_armor", game.KindEffect, game.KindDrop),
		def("putin_vote", Lifetime(game.UntilDone), Impl(putinVote{})),
		def("shrek", Impl(shrek{})),

		// --- effects: rules only ---
		Text("reflex"),
		Text("ne_shturm"),
		Text("hungry", WithProof()),
		Text("mc_trup", WithProof()),
		Text("shit_seller", Input(optional(field("target", "Кого выбрал", game.FieldPlayer, game.RolePlayer)))),

		// --- bonuses ---
		def("parachute", Impl(parachute{})),
		def("friend_assist", Input(field("helper", "Помощник", game.FieldPlayer, game.RolePlayer)), Confirm(),
			Impl(helperShare{percent: 50})),
		def("lucky_wheel", Use(game.UseInsteadOfGameSpin), Impl(luckyWheel{})),
		def("reroll", Use(game.UseAfterSpin), Impl(reroll{})),
		def("vault_born", Blocks(game.KindEffect, game.KindDrop)),
		Text("skip_cutscenes"),
		Text("cheater"),
		Text("easy_mode"),
		Text("wiki"),
		def("lawsuit", Use(game.UseAnytime), Confirm(), Input(
			field("target", "Чью игру судим", game.FieldPlayer, game.RolePlayer),
			field("verdict", "Решение судьи", game.FieldText, game.RoleJudge),
		)),

		// --- drop debuffs ---
		def("johnny", Impl(doubleGameSpin{tie: TieSecond})),
		Blocker("self_sufficient", game.KindBonus),
		Text("immigrant"),
		Text("scary"),
		Text("anthem"),
		Text("not_casual"),
		Text("vlad"),
		Text("shutdown"),
		Text("one_punch"),
		Text("ost"),
		Text("papich"),
	} {
		if _, dup := byID[d.ID]; dup {
			panic(fmt.Sprintf("items: %q is defined twice", d.ID))
		}
		byID[d.ID] = d
	}

	// Keep the order of docs/rules; every item there must have a definition.
	out := make([]*game.Def, 0, len(textOrder))
	for _, id := range textOrder {
		d, ok := byID[id]
		if !ok {
			panic(fmt.Sprintf("items: %q from docs/rules has no definition", id))
		}
		out = append(out, d)
		delete(byID, id)
	}
	for id := range byID {
		panic(fmt.Sprintf("items: %q is not in docs/rules", id))
	}
	return out
}

// NewCatalog builds the catalog of all items.
func NewCatalog() (*game.Catalog, error) {
	return game.NewCatalog(Defs()...)
}
