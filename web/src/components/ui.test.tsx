import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Avatar, Field, Input } from './ui'

it('describes a field with its hint without changing its name or losing an existing description', () => {
  render(<><p id="extra">Дополнение</p><Field label="Рейтинг" hint="Из 100"><Input aria-describedby="extra" /></Field></>)
  expect(screen.getByRole('textbox', { name: 'Рейтинг' })).toHaveAccessibleDescription('Дополнение Из 100')
})

it('falls back for every broken avatar and loads a changed URL', () => {
  const { container, rerender } = render(<><Avatar name="Алиса" url="https://cdn.discordapp.com/old.png" /><Avatar name="Алиса" url="https://cdn.discordapp.com/old.png" /></>)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(screen.getAllByText('А')).toHaveLength(2)
  rerender(<Avatar name="Алиса" url="https://cdn.discordapp.com/new.png" />)
  expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.discordapp.com/new.png')
})
