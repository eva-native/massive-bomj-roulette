// Package live fans out change notifications to SSE subscribers of an event.
package live

import "sync"

// Message tells subscribers that an event changed.
type Message struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

type Broker struct {
	mu   sync.Mutex
	subs map[int64]map[chan Message]struct{}
}

func NewBroker() *Broker {
	return &Broker{subs: map[int64]map[chan Message]struct{}{}}
}

// Subscribe returns a channel of messages for the event and a function that
// unsubscribes and closes it.
func (b *Broker) Subscribe(eventID int64) (<-chan Message, func()) {
	ch := make(chan Message, 16)
	b.mu.Lock()
	if b.subs[eventID] == nil {
		b.subs[eventID] = map[chan Message]struct{}{}
	}
	b.subs[eventID][ch] = struct{}{}
	b.mu.Unlock()

	var once sync.Once
	return ch, func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subs[eventID], ch)
			if len(b.subs[eventID]) == 0 {
				delete(b.subs, eventID)
			}
			b.mu.Unlock()
			close(ch)
		})
	}
}

// Publish sends a message to every subscriber of the event. A subscriber
// that is too slow misses the message; the UI refetches on the next one.
func (b *Broker) Publish(eventID int64, m Message) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs[eventID] {
		select {
		case ch <- m:
		default:
		}
	}
}

// Subscribers counts subscribers of an event (for tests).
func (b *Broker) Subscribers(eventID int64) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs[eventID])
}
