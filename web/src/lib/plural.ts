/** The Russian plural form for `n`: plural(n, 'сектор', 'сектора', 'секторов'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10
  const n100 = Math.abs(n) % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}
