// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const mediaCleanupStaleMinutes = 30

type storedMediaRef struct {
	Backend    string `json:"backend"`
	Path       string `json:"path,omitempty"`
	Origin     string `json:"origin,omitempty"`
	Bucket     string `json:"bucket,omitempty"`
	ObjectPath string `json:"objectPath,omitempty"`
}

// RunMediaCleanupTask claims and deletes pending media cleanup jobs.
func (h *Handlers) RunMediaCleanupTask(ctx context.Context) (map[string]any, error) {
	out := map[string]any{"checked": 0, "completed": 0, "failed": 0}
	if !h.hasTable("media_cleanup_jobs") {
		return out, nil
	}
	limit := envInt("MEDIA_CLEANUP_BATCH_SIZE", 25)
	ids := h.pendingMediaCleanupIDs(limit)
	out["checked"] = len(ids)
	completed, failed := 0, 0
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		ok, err := h.processMediaCleanupJob(id)
		if err != nil || !ok {
			if err != nil {
				failed++
			}
			continue
		}
		completed++
	}
	out["completed"] = completed
	out["failed"] = failed
	return out, nil
}

func (h *Handlers) pendingMediaCleanupIDs(limit int) []int64 {
	stale := fmt.Sprintf("-%d minutes", mediaCleanupStaleMinutes)
	rows, err := h.DB.Query(`SELECT id FROM media_cleanup_jobs
		WHERE status='pending' OR (status='processing' AND COALESCE(claimed_at, updated_at) <= datetime('now', ?))
		ORDER BY attempts, created_at, id LIMIT ?`, stale, limit)
	if err != nil {
		// PostgreSQL-ish fallback without datetime('now').
		cutoff := time.Now().Add(-time.Duration(mediaCleanupStaleMinutes) * time.Minute).UTC().Format(time.RFC3339)
		rows, err = h.DB.Query(`SELECT id FROM media_cleanup_jobs
			WHERE status='pending' OR (status='processing' AND COALESCE(claimed_at, updated_at) <= ?)
			ORDER BY attempts, created_at, id LIMIT ?`, cutoff, limit)
		if err != nil {
			return nil
		}
	}
	defer rows.Close()
	ids := make([]int64, 0, limit)
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func (h *Handlers) processMediaCleanupJob(jobID int64) (bool, error) {
	token := randomTokenHex(16)
	stale := fmt.Sprintf("-%d minutes", mediaCleanupStaleMinutes)
	res, err := h.DB.Exec(`UPDATE media_cleanup_jobs
		SET status='processing', attempts=attempts+1, last_error=NULL, claim_token=?, claimed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND (status='pending' OR (status='processing' AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)))`,
		token, jobID, stale)
	if err != nil {
		cutoff := time.Now().Add(-time.Duration(mediaCleanupStaleMinutes) * time.Minute).UTC().Format(time.RFC3339)
		res, err = h.DB.Exec(`UPDATE media_cleanup_jobs
			SET status='processing', attempts=attempts+1, last_error=NULL, claim_token=?, claimed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
			WHERE id=? AND (status='pending' OR (status='processing' AND COALESCE(claimed_at, updated_at) <= ?))`,
			token, jobID, cutoff)
	}
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}

	var owner int
	var urlsJSON, objectsJSON sql.NullString
	if err := h.DB.QueryRow(`SELECT owner_user_id, urls_json, objects_json FROM media_cleanup_jobs WHERE id=?`, jobID).
		Scan(&owner, &urlsJSON, &objectsJSON); err != nil {
		h.releaseMediaCleanup(jobID, token, err.Error())
		return false, err
	}

	refs, err := resolveMediaRefs(owner, urlsJSON.String, objectsJSON)
	if err != nil {
		h.releaseMediaCleanup(jobID, token, sanitizeMediaErr(err))
		return false, err
	}
	if err := deleteMediaRefs(refs); err != nil {
		h.releaseMediaCleanup(jobID, token, sanitizeMediaErr(err))
		return false, err
	}
	_, err = h.DB.Exec(`UPDATE media_cleanup_jobs
		SET status='completed', last_error=NULL, claim_token=NULL, claimed_at=NULL, updated_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP
		WHERE id=? AND status='processing' AND claim_token=?`, jobID, token)
	return err == nil, err
}

func (h *Handlers) releaseMediaCleanup(jobID int64, token, msg string) {
	_, _ = h.DB.Exec(`UPDATE media_cleanup_jobs
		SET status='pending', last_error=?, claim_token=NULL, claimed_at=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND status='processing' AND claim_token=?`, truncate(msg, 500), jobID, token)
}

func resolveMediaRefs(owner int, urlsJSON string, objectsJSON sql.NullString) ([]storedMediaRef, error) {
	if objectsJSON.Valid && strings.TrimSpace(objectsJSON.String) != "" && objectsJSON.String != "null" {
		var refs []storedMediaRef
		if err := json.Unmarshal([]byte(objectsJSON.String), &refs); err == nil && len(refs) > 0 {
			owned := make([]storedMediaRef, 0, len(refs))
			for _, ref := range refs {
				if mediaRefOwnedBy(owner, ref) {
					owned = append(owned, ref)
				}
			}
			if len(owned) == 0 {
				return nil, fmt.Errorf("媒体清理任务对象不属于 owner=%d", owner)
			}
			return owned, nil
		}
	}
	var urls []string
	_ = json.Unmarshal([]byte(urlsJSON), &urls)
	bucket := strings.TrimSpace(os.Getenv("SUPABASE_MEDIA_BUCKET"))
	refs := make([]storedMediaRef, 0, len(urls))
	for _, rawURL := range urls {
		rawURL = strings.TrimSpace(rawURL)
		if rawURL == "" {
			continue
		}
		if strings.HasPrefix(rawURL, "/media/") {
			ref := storedMediaRef{Backend: "local", Path: rawURL}
			if !mediaRefOwnedBy(owner, ref) {
				continue
			}
			refs = append(refs, ref)
			continue
		}
		if objectPath := parseSupabaseObjectPath(rawURL, bucket); objectPath != "" {
			origin := ""
			if o, err := urlOrigin(rawURL); err == nil {
				origin = o
			}
			ref := storedMediaRef{Backend: "supabase", Origin: origin, Bucket: bucket, ObjectPath: objectPath}
			if !mediaRefOwnedBy(owner, ref) {
				continue
			}
			refs = append(refs, ref)
		}
	}
	if len(urls) > 0 && len(refs) == 0 {
		return nil, fmt.Errorf("媒体清理任务无法定位任何存储对象 (owner=%d)", owner)
	}
	return refs, nil
}

// mediaRefOwnedBy mirrors Express scope/userId path ownership checks.
func mediaRefOwnedBy(owner int, ref storedMediaRef) bool {
	if owner <= 0 {
		return true
	}
	ownerToken := fmt.Sprintf("/%d/", owner)
	ownerPrefix := fmt.Sprintf("/%d", owner)
	switch ref.Backend {
	case "local", "":
		path := "/" + strings.Trim(strings.ReplaceAll(ref.Path, "\\", "/"), "/")
		return strings.Contains(path, "/users"+ownerToken) ||
			strings.Contains(path, "/user"+ownerToken) ||
			strings.Contains(path, "/u"+ownerToken) ||
			strings.Contains(path, ownerToken) ||
			strings.HasSuffix(path, ownerPrefix)
	case "supabase":
		objectPath := "/" + strings.Trim(ref.ObjectPath, "/")
		return strings.Contains(objectPath, ownerToken) || strings.HasPrefix(objectPath, strings.TrimPrefix(ownerPrefix, "/")+"/")
	default:
		return true
	}
}

func deleteMediaRefs(refs []storedMediaRef) error {
	root := mediaUploadRoot()
	publicRoot := strings.TrimSpace(os.Getenv("MEDIA_LOCAL_ROOT"))
	if publicRoot == "" {
		publicRoot = root
	}
	for _, ref := range refs {
		switch ref.Backend {
		case "local", "":
			path := strings.TrimSpace(ref.Path)
			if path == "" {
				continue
			}
			rel := strings.TrimPrefix(path, "/media/")
			rel = strings.TrimPrefix(rel, "uploads/")
			candidates := []string{
				filepath.Join(root, filepath.Base(path)),
				filepath.Join(root, rel),
				filepath.Join(publicRoot, rel),
				filepath.Join(publicRoot, "uploads", rel),
			}
			var last error
			removed := false
			for _, candidate := range candidates {
				clean := filepath.Clean(candidate)
				if !strings.HasPrefix(clean, filepath.Clean(root)) && !strings.HasPrefix(clean, filepath.Clean(publicRoot)) {
					continue
				}
				if err := os.Remove(clean); err == nil || os.IsNotExist(err) {
					removed = true
					break
				} else {
					last = err
				}
			}
			if !removed && last != nil {
				return last
			}
		case "supabase":
			if err := deleteSupabaseObject(ref); err != nil {
				return err
			}
		}
	}
	return nil
}

func deleteSupabaseObject(ref storedMediaRef) error {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
	bucket := strings.TrimSpace(os.Getenv("SUPABASE_MEDIA_BUCKET"))
	if baseURL == "" || key == "" || bucket == "" {
		return fmt.Errorf("supabase media cleanup requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_MEDIA_BUCKET")
	}
	objectPath := strings.TrimSpace(ref.ObjectPath)
	refBucket := strings.TrimSpace(ref.Bucket)
	if refBucket == "" {
		refBucket = bucket
	}
	if refBucket != bucket {
		return fmt.Errorf("supabase bucket mismatch: job=%s configured=%s", refBucket, bucket)
	}
	if objectPath == "" && ref.Origin != "" {
		objectPath = parseSupabaseObjectPath(ref.Origin, bucket)
	}
	if objectPath == "" {
		return fmt.Errorf("supabase object path missing")
	}
	if configuredOrigin, err := urlOrigin(baseURL); err == nil && ref.Origin != "" {
		if jobOrigin, err2 := urlOrigin(ref.Origin); err2 == nil && jobOrigin != configuredOrigin && !strings.HasPrefix(ref.Origin, "/") {
			// Allow relative object paths stored without origin.
			if strings.Contains(ref.Origin, "://") {
				return fmt.Errorf("supabase origin mismatch")
			}
		}
	}
	body, _ := json.Marshal([]string{objectPath})
	req, err := http.NewRequest(http.MethodDelete, baseURL+"/storage/v1/object/"+bucket, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("apikey", key)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("supabase remove status=%d body=%s", resp.StatusCode, truncate(string(raw), 200))
	}
	return nil
}

func parseSupabaseObjectPath(raw, bucket string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	markers := []string{
		"/storage/v1/object/public/" + bucket + "/",
		"/storage/v1/object/sign/" + bucket + "/",
		"/storage/v1/object/" + bucket + "/",
	}
	for _, marker := range markers {
		if idx := strings.Index(raw, marker); idx >= 0 {
			return strings.SplitN(raw[idx+len(marker):], "?", 2)[0]
		}
	}
	if !strings.Contains(raw, "://") && !strings.HasPrefix(raw, "/") {
		return raw
	}
	return ""
}

func urlOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("invalid url")
	}
	return u.Scheme + "://" + u.Host, nil
}

func sanitizeMediaErr(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	msg = strings.ReplaceAll(msg, os.Getenv("SUPABASE_SERVICE_ROLE_KEY"), "[redacted]")
	return truncate(msg, 500)
}

func randomTokenHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
