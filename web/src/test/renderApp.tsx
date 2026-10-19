import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { newQueryClient } from '@/api/queryClient'
import { routes } from '@/routes'

/** Renders the whole app at the given path with a fresh query cache. */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = newQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}
