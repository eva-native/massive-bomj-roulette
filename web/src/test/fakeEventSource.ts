/**
 * A stand-in for the browser's EventSource (jsdom has none). Tests drive the
 * connection by hand: open(), fail(), send().
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  /** Every stream the page opened, oldest first. */
  static all: FakeEventSource[] = []

  readyState = FakeEventSource.CONNECTING

  constructor(readonly url: string) {
    super()
    FakeEventSource.all.push(this)
  }

  static last() {
    const es = FakeEventSource.all.at(-1)
    if (!es) throw new Error('no EventSource was opened')
    return es
  }

  open() {
    this.readyState = FakeEventSource.OPEN
    this.dispatchEvent(new Event('open'))
  }

  /** The connection drops; the browser retries unless `closed` (then it gives up). */
  fail(closed = false) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING
    this.dispatchEvent(new Event('error'))
  }

  /** A server message of the given type. */
  send(type = 'change') {
    this.dispatchEvent(new MessageEvent(type, { data: '{}' }))
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }
}
