import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { newQueryClient } from '@/api/queryClient'
import { routes } from '@/routes'

const router = createBrowserRouter(routes)
const queryClient = newQueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
