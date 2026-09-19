package queries

import (
	"testing"
)

func TestNewQueries(t *testing.T) {
	q := New(nil)
	if q == nil {
		t.Fatal("expected New(nil) to return non-nil Queries instance")
	}
	if q.db != nil {
		t.Fatal("expected q.db to be nil")
	}
}
