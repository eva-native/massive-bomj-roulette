import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { forgetAllBrokenImages } from '@/lib/brokenImages'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  forgetAllBrokenImages() // the page-wide memory of dead picture links
})
