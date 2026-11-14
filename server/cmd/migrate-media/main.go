// Copyright (c) 2026 heathcetide. All rights reserved.

// migrate-media downloads remote catalog images and re-uploads them to configured object storage.
package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/configs"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	pkgstorage "github.com/heathcetide/DietDigiDose/pkg/storage"
)

type catalogItem struct {
	ID  int
	URL string
}

type migrateResult struct {
	item        catalogItem
	key         string
	pub         string
	placeholder bool
	err         error
}

func main() {
	configPath := flag.String("config", "configs/config.yaml", "config path")
	limit := flag.Int("limit", 200, "max rows per table")
	workers := flag.Int("workers", 6, "concurrent download/upload workers")
	retries := flag.Int("retries", 2, "download retries per image")
	placeholderOnFail := flag.Bool("placeholder-on-fail", true, "upload a generated JPEG when remote download fails")
	dryRun := flag.Bool("dry-run", false, "print actions without writing")
	flag.Parse()
	if *workers < 1 {
		*workers = 1
	}

	cfg, err := configs.Load(*configPath)
	if err != nil {
		fatal(err)
	}
	if err := pkgstorage.Init(
		cfg.Storage.Driver, cfg.Storage.Root, cfg.Storage.Region,
		cfg.Storage.Endpoint, cfg.Storage.AccessKey, cfg.Storage.SecretKey,
		cfg.Storage.PublicURLBase, cfg.Storage.MaxFileSize,
	); err != nil {
		fatal(err)
	}
	db, _, err := appdb.Open(cfg.Database.Driver, cfg.Database.DSN)
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	cdn := strings.TrimRight(strings.TrimSpace(cfg.Storage.PublicURLBase), "/")
	cdnFilter := ""
	if cdn != "" {
		cdnFilter = ` AND image_url NOT LIKE '` + strings.ReplaceAll(cdn, "'", "''") + `/%'`
	}
	// Prefer reachable hosts first.
	order := ` ORDER BY CASE
		WHEN image_url LIKE '%githubusercontent.com%' THEN 0
		WHEN image_url LIKE '%picsum.photos%' THEN 2
		WHEN image_url LIKE '%meredithcorp.io%' OR image_url LIKE '%allrecipes.com%' THEN 3
		ELSE 1 END, id DESC LIMIT ?`
	type migrateJob struct {
		label  string
		table  string
		column string
		sql    string
	}
	filterCol := func(col string) string {
		return strings.ReplaceAll(cdnFilter, "image_url", col)
	}
	orderCol := func(col string) string {
		return strings.ReplaceAll(order, "image_url", col)
	}
	jobsSpec := []migrateJob{
		{"recipes.image_url", "recipes", "image_url", `SELECT id, COALESCE(image_url,'') FROM recipes WHERE image_url LIKE 'http%' ` + filterCol("image_url") + orderCol("image_url")},
		{"ingredients_library.image_url", "ingredients_library", "image_url", `SELECT id, COALESCE(image_url,'') FROM ingredients_library WHERE image_url LIKE 'http%' ` + filterCol("image_url") + orderCol("image_url")},
		{"kitchenware_catalog.image_url", "kitchenware_catalog", "image_url", `SELECT id, COALESCE(image_url,'') FROM kitchenware_catalog WHERE image_url LIKE 'http%' ` + filterCol("image_url") + orderCol("image_url")},
		{"community_posts.image_url", "community_posts", "image_url", `SELECT id, COALESCE(image_url,'') FROM community_posts WHERE image_url LIKE 'http%' ` + filterCol("image_url") + orderCol("image_url")},
		{"community_posts.avatar_url", "community_posts", "avatar_url", `SELECT id, COALESCE(avatar_url,'') FROM community_posts WHERE avatar_url LIKE 'http%' ` + filterCol("avatar_url") + orderCol("avatar_url")},
		{"inventory_items.image_url", "inventory_items", "image_url", `SELECT id, COALESCE(image_url,'') FROM inventory_items WHERE image_url LIKE 'http%' ` + filterCol("image_url") + orderCol("image_url")},
	}
	client := &http.Client{Timeout: 45 * time.Second}
	var uploadMu sync.Mutex
	for _, job := range jobsSpec {
		if !db.HasTable(job.table) {
			fmt.Printf("skip %s (missing table)\n", job.label)
			continue
		}
		rows, err := db.Query(job.sql, *limit)
		if err != nil {
			fmt.Printf("%s query failed: %v\n", job.label, err)
			continue
		}
		list := make([]catalogItem, 0)
		for rows.Next() {
			var it catalogItem
			if rows.Scan(&it.ID, &it.URL) == nil {
				list = append(list, it)
			}
		}
		_ = rows.Close()
		fmt.Printf("%s queued %d\n", job.label, len(list))

		work := make(chan catalogItem)
		results := make(chan migrateResult, *workers*2)
		var wg sync.WaitGroup
		for w := 0; w < *workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for it := range work {
					func() {
						defer func() {
							if rec := recover(); rec != nil {
								results <- migrateResult{item: it, err: fmt.Errorf("panic: %v", rec)}
							}
						}()
						url := strings.TrimSpace(it.URL)
						if url == "" || !strings.HasPrefix(url, "http") || (cdn != "" && strings.HasPrefix(url, cdn+"/")) {
							return
						}
						key, pub, usedPlaceholder, err := rehost(client, &uploadMu, job.table+"_"+job.column, it.ID, url, *retries, *placeholderOnFail)
						results <- migrateResult{item: it, key: key, pub: pub, placeholder: usedPlaceholder, err: err}
					}()
				}
			}()
		}
		go func() {
			wg.Wait()
			close(results)
		}()
		go func() {
			for _, it := range list {
				work <- it
			}
			close(work)
		}()

		moved, placeholders, failed := 0, 0, 0
		updateSQL := fmt.Sprintf("UPDATE %s SET %s=? WHERE id=?", job.table, job.column)
		for res := range results {
			if res.err != nil {
				fmt.Printf("%s#%d failed: %v\n", job.label, res.item.ID, res.err)
				failed++
				continue
			}
			label := ""
			if res.placeholder {
				label = " (placeholder)"
				placeholders++
			}
			if *dryRun {
				fmt.Printf("[dry-run] %s#%d -> %s%s\n", job.label, res.item.ID, res.pub, label)
				moved++
				continue
			}
			if _, err := db.Exec(updateSQL, res.pub, res.item.ID); err != nil {
				fmt.Printf("%s#%d update failed: %v\n", job.label, res.item.ID, err)
				failed++
				continue
			}
			fmt.Printf("%s#%d -> %s%s\n", job.label, res.item.ID, res.pub, label)
			moved++
		}
		fmt.Printf("%s migrated %d (placeholders %d) failed %d\n", job.label, moved, placeholders, failed)
	}
}

func rehost(client *http.Client, uploadMu *sync.Mutex, table string, id int, url string, retries int, placeholderOnFail bool) (string, string, bool, error) {
	usedPlaceholder := false
	var data []byte
	var contentType string
	var err error
	if skipRemoteDownload(url) {
		err = fmt.Errorf("skip unreachable host")
	} else {
		data, contentType, err = download(client, url, retries)
	}
	if err != nil {
		if !placeholderOnFail {
			return "", "", false, err
		}
		data, err = placeholderJPEG(table, id, url)
		if err != nil {
			return "", "", false, err
		}
		contentType = "image/jpeg"
		usedPlaceholder = true
	}
	ext := extFromURLOrMIME(url, contentType, data)
	sum := sha1.Sum(data)
	key := fmt.Sprintf("dietdigidose/catalog/%s/%d-%s.%s", table, id, hex.EncodeToString(sum[:8]), ext)
	uploadMu.Lock()
	writeErr := pkgstorage.Write(key, bytes.NewReader(data))
	uploadMu.Unlock()
	if writeErr != nil {
		return "", "", usedPlaceholder, writeErr
	}
	return key, pkgstorage.PublicURL(key), usedPlaceholder, nil
}

func skipRemoteDownload(url string) bool {
	u := strings.ToLower(url)
	return strings.Contains(u, "picsum.photos") ||
		strings.Contains(u, "images.unsplash.com") ||
		strings.Contains(u, "plus.unsplash.com") ||
		strings.Contains(u, "meredithcorp.io") ||
		strings.Contains(u, "images.media-allrecipes.com") ||
		strings.Contains(u, "www.allrecipes.com/img/")
}

func download(client *http.Client, url string, retries int) ([]byte, string, error) {
	if retries < 1 {
		retries = 1
	}
	var lastErr error
	for attempt := 1; attempt <= retries; attempt++ {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return nil, "", err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
		if strings.Contains(url, "allrecipes.com") || strings.Contains(url, "meredithcorp.io") {
			req.Header.Set("Referer", "https://www.allrecipes.com/")
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		if resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		if len(body) == 0 {
			lastErr = fmt.Errorf("empty body")
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		return body, resp.Header.Get("Content-Type"), nil
	}
	return nil, "", lastErr
}

func placeholderJPEG(table string, id int, url string) ([]byte, error) {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%d:%s", table, id, url)))
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	base := color.RGBA{R: 40 + sum[0]%80, G: 90 + sum[1]%90, B: 70 + sum[2]%80, A: 255}
	accent := color.RGBA{R: 20 + sum[3]%60, G: 140 + sum[4]%80, B: 90 + sum[5]%70, A: 255}
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			if (x/40+y/40)%2 == 0 {
				img.Set(x, y, base)
			} else {
				img.Set(x, y, accent)
			}
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func extFromURLOrMIME(url, mime string, data []byte) string {
	mime = strings.ToLower(strings.TrimSpace(mime))
	switch {
	case strings.Contains(mime, "png"):
		return "png"
	case strings.Contains(mime, "webp"):
		return "webp"
	case strings.Contains(mime, "gif"):
		return "gif"
	case strings.Contains(mime, "jpeg"), strings.Contains(mime, "jpg"):
		return "jpg"
	}
	base := strings.ToLower(path.Ext(strings.Split(url, "?")[0]))
	switch base {
	case ".png", ".webp", ".gif", ".jpg", ".jpeg":
		return strings.TrimPrefix(base, ".")
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 {
		return "jpg"
	}
	return "jpg"
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
