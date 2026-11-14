package ai_test

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/ai"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatPersistsRunsAndEnforcesOwnership(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer fake-test-key" {
			t.Errorf("unexpected provider request: %s", r.URL)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"仅测试回复"}}]}`))
	}))
	defer fake.Close()
	t.Setenv("AI_API_KEY", "fake-test-key")
	t.Setenv("AI_BASE_URL", fake.URL)
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "chat_owner", "user")
		other := testutil.User(t, db, "chat_other", "user")
		token := testutil.Token(t, db, uid)
		ot := testutil.Token(t, db, other)
		r := testutil.Router()
		(&ai.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db)}).RegisterOn(r)
		req := httptest.NewRequest("POST", "/api/v1/ai/chat", bytes.NewBufferString(`{"message":"你好","sessionId":"isolated-session"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("chat: %d %s", w.Code, w.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result["reply"] != "仅测试回复" || result["fallback"] == true {
			t.Fatalf("provider result: %v", result)
		}
		id := result["run"].(map[string]any)["id"].(string)
		if testutil.Count(t, db, "agent_runs") != 1 || testutil.Count(t, db, "ai_chat_messages") != 2 {
			t.Fatal("chat was not persisted")
		}
		testutil.Request(t, r, "GET", "/api/v1/ai/agent-runs/"+id, token, nil, 200)
		testutil.Request(t, r, "GET", "/api/v1/ai/agent-runs/"+id, ot, nil, 404)
		testutil.Request(t, r, "DELETE", "/api/v1/ai/chat-conversations/isolated-session", ot, nil, 200)
		if testutil.Count(t, db, "ai_chat_messages") != 2 {
			t.Fatal("foreign conversation deleted")
		}
		testutil.Request(t, r, "DELETE", "/api/v1/ai/chat-conversations/isolated-session", token, nil, 200)
		if testutil.Count(t, db, "ai_chat_messages") != 0 {
			t.Fatal("conversation not deleted")
		}
	})
}
func TestProviderMissingCredentialFailsWithoutNetwork(t *testing.T) {
	if _, err := ai.ChatCompletion(context.Background(), ai.ProviderConfig{}, nil, ai.ChatOptions{}); err == nil {
		t.Fatal("missing credential accepted")
	}
}
