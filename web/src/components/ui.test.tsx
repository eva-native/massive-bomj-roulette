import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Field, Input } from './ui'

it('describes a field with its hint without changing its name or losing an existing description', () => {
  render(<><p id="extra">Дополнение</p><Field label="Рейтинг" hint="Из 100"><Input aria-describedby="extra" /></Field></>)
  expect(screen.getByRole('textbox', { name: 'Рейтинг' })).toHaveAccessibleDescription('Дополнение Из 100')
})
