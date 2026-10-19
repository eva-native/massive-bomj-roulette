package live

import "testing"

func TestBroker(t *testing.T) {
	b := NewBroker()
	a, unsubA := b.Subscribe(1)
	c, unsubC := b.Subscribe(1)
	other, unsubOther := b.Subscribe(2)
	defer unsubOther()

	b.Publish(1, Message{Kind: "spin", Message: "крутка"})
	for _, ch := range []<-chan Message{a, c} {
		if m := <-ch; m.Kind != "spin" {
			t.Fatalf("got %+v", m)
		}
	}
	select {
	case m := <-other:
		t.Fatalf("event 2 got event 1's message %+v", m)
	default:
	}

	unsubA()
	unsubA() // idempotent
	if _, ok := <-a; ok {
		t.Fatal("channel should be closed")
	}
	if n := b.Subscribers(1); n != 1 {
		t.Fatalf("subscribers = %d, want 1", n)
	}

	// A slow subscriber does not block publishing.
	for range 100 {
		b.Publish(1, Message{Kind: "x"})
	}
	unsubC()
	if n := b.Subscribers(1); n != 0 {
		t.Fatalf("subscribers = %d, want 0", n)
	}
}
