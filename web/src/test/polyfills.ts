// Loaded before anything imports React (see setupFiles in vite.config.ts).
// jsdom has no AnimationEvent; without it React never listens to
// animationend, and the wheel could not report that it stopped.
if (!('AnimationEvent' in window)) {
  Object.defineProperty(window, 'AnimationEvent', { value: class AnimationEvent extends Event {} })
}
