package ratelimit

import "time"

// Bucket tracks a burst without storing a timestamp per request.
type Bucket struct{ next time.Time }

func (b *Bucket) Take(now time.Time, interval time.Duration, burst int) bool {
	floor := now.Add(-time.Duration(burst-1) * interval)
	if b.next.Before(floor) {
		b.next = floor
	}
	if b.next.After(now) {
		return false
	}
	b.next = b.next.Add(interval)
	return true
}

func (b *Bucket) Next() time.Time { return b.next }
