/** Section titles for item kinds, in display order. */
export const kindLabels: Record<string, string> = {
  effect: 'Эффекты',
  bonus: 'Бонусы',
  drop: 'Дроп-дебаффы',
}

/** Default icon of each item; a judge may replace it with a picture. */
export const itemEmoji: Record<string, string> = {
  // effects
  opaaa: '🎉',
  plus8: '🍈',
  minus3: '📉',
  minus6: '😢',
  nothing: '🤷',
  sto_k_odnomu: '💯',
  rps: '✊',
  jester: '🃏',
  dendy: '🎮',
  babina: '🎬',
  documentary: '🎓',
  group_bow: '⏰',
  no_step_back: '🚫',
  borrow_game: '🤝',
  geralt: '🐺',
  smuta: '⚔️',
  zemsky_sobor: '👑',
  devil_deal: '😈',
  veteran: '🎖️',
  plot_armor: '🛡️',
  putin_vote: '🗳️',
  shrek: '🧅',
  reflex: '⚡',
  ne_shturm: '🏰',
  hungry: '🍔',
  mc_trup: '💀',
  shit_seller: '💩',
  // bonuses
  parachute: '🪂',
  friend_assist: '🫂',
  lucky_wheel: '🎡',
  reroll: '🎲',
  vault_born: '☢️',
  skip_cutscenes: '⏭️',
  cheater: '🔓',
  easy_mode: '🍼',
  wiki: '📖',
  lawsuit: '⚖️',
  // drop debuffs
  johnny: '🎸',
  self_sufficient: '🧍',
  immigrant: '🧳',
  scary: '👻',
  anthem: '🎺',
  not_casual: '😤',
  vlad: '🚪',
  shutdown: '🔌',
  one_punch: '👊',
  ost: '🎧',
  papich: '🎙️',
}

/** Icon for items without their own. */
export const kindEmoji: Record<string, string> = { effect: '✨', bonus: '🎁', drop: '💔' }
