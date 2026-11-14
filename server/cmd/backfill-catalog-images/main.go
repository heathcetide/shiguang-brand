// Copyright (c) 2026 heathcetide. All rights reserved.

// backfill-catalog-images replaces checkerboard placeholder catalog images with
// real Wikimedia Commons photos matched by dish / kitchenware keywords.
package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/heathcetide/DietDigiDose/internal/configs"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	pkgstorage "github.com/heathcetide/DietDigiDose/pkg/storage"
)

type commonsPage struct {
	Title     string `json:"title"`
	ImageInfo []struct {
		URL      string `json:"url"`
		ThumbURL string `json:"thumburl"`
		MIME     string `json:"mime"`
		Size     int64  `json:"size"`
	} `json:"imageinfo"`
}

type commonsResponse struct {
	Query struct {
		Pages map[string]commonsPage `json:"pages"`
	} `json:"query"`
}

var (
	enStop = map[string]struct{}{
		"a": {}, "an": {}, "the": {}, "and": {}, "or": {}, "of": {}, "with": {}, "without": {},
		"for": {}, "to": {}, "from": {}, "in": {}, "on": {}, "over": {}, "under": {}, "into": {},
		"by": {}, "style": {}, "styles": {}, "homemade": {}, "easy": {}, "quick": {}, "best": {},
		"classic": {}, "simple": {}, "delicious": {}, "tasty": {}, "recipe": {}, "recipes": {},
		"free": {}, "gluten": {}, "grandma": {}, "grandmas": {}, "new": {}, "old": {}, "not": {},
		"no": {}, "ii": {}, "iii": {}, "iv": {}, "vi": {}, "vii": {}, "three": {}, "white": {},
		"green": {}, "sweet": {}, "stuffed": {}, "toasted": {}, "glazed": {}, "roasted": {},
		"grilled": {}, "baked": {}, "fried": {}, "steamed": {}, "boiled": {},
	}
	enWordRe = regexp.MustCompile(`[A-Za-z][A-Za-z']+`)
)

// keyword -> Commons search query. Longer / more specific keys win via longest match.
var recipeKeywords = []struct {
	Key   string
	Query string
}{
	// Chinese dishes / ingredients
	{"番茄炒蛋", "Stir Fried Tomatoes with Scrambled Eggs"},
	{"蛋炒饭", "Chinese egg fried rice"},
	{"红烧肉", "Hong Shao Rou Chinese pork"},
	{"糖醋排骨", "sweet and sour spare ribs Chinese"},
	{"麻婆豆腐", "Mapo tofu"},
	{"宫保鸡丁", "Kung Pao chicken"},
	{"鱼香肉丝", "Yuxiang shredded pork"},
	{"回锅肉", "twice cooked pork"},
	{"水煮牛肉", "Sichuan boiled beef"},
	{"西红柿鸡蛋", "tomato egg stir fry Chinese"},
	{"番茄鸡蛋", "tomato egg soup Chinese"},
	{"番茄", "Chinese tomato dish food"},
	{"豆腐", "Chinese tofu dish"},
	{"白菜", "Chinese cabbage stir fry"},
	{"土豆丝", "shredded potato stir fry Chinese"},
	{"土豆", "Chinese potato dish"},
	{"黄瓜", "Chinese cucumber salad"},
	{"西兰花", "garlic broccoli stir fry"},
	{"花椰菜", "cauliflower stir fry"},
	{"鸡胸", "chicken breast meal"},
	{"鸡翅", "Chinese soy chicken wings"},
	{"鸡肉", "Chinese chicken stir fry"},
	{"鸡丁", "kung pao chicken diced"},
	{"鸡", "Chinese chicken dish"},
	{"蟹", "Chinese crab dish"},
	{"地三鲜", "Chinese fried potato eggplant pepper"},
	{"雪花酥", "nougat cookie dessert"},
	{"红薯", "sweet potato Chinese food"},
	{"小米", "millet congee Chinese"},
	{"紫菜", "seaweed egg drop soup"},
	{"西葫芦", "zucchini egg stir fry"},
	{"牛油果", "avocado toast food"},
	{"银耳", "white fungus dessert soup"},
	{"柠檬", "lemon water drink"},
	{"糖醋", "sweet and sour Chinese food"},
	{"红烧", "Chinese red braised food"},
	{"照烧", "teriyaki chicken rice"},
	{"温泉蛋", "onsen egg soft boiled"},
	{"太阳蛋", "sunny side up egg"},
	{"排骨", "Chinese spare ribs"},
	{"牛肉", "Chinese beef stir fry"},
	{"猪肉", "Chinese pork stir fry"},
	{"虾仁", "Chinese shrimp stir fry"},
	{"虾", "Chinese shrimp dish"},
	{"鱼", "Chinese steamed fish"},
	{"香菇", "Chinese mushroom stir fry"},
	{"茄子", "Chinese eggplant dish"},
	{"芹菜", "celery stir fry Chinese"},
	{"胡萝卜", "carrot stir fry"},
	{"南瓜", "pumpkin dish food"},
	{"玉米", "corn on cob food"},
	{"燕麦", "oatmeal breakfast bowl"},
	{"粥", "congee rice porridge bowl"},
	{"汤", "Asian soup bowl food"},
	{"面", "noodle soup bowl"},
	{"米饭", "steamed rice bowl"},
	{"炒饭", "Chinese fried rice"},
	{"饭", "rice bowl meal"},
	{"沙拉", "healthy salad bowl"},
	{"三明治", "sandwich food"},
	{"披萨", "pizza food"},
	{"汉堡", "burger food"},
	{"蛋糕", "cake dessert"},
	{"咖啡", "coffee drink"},
	{"酸奶", "yogurt bowl"},
	{"牛奶", "milk breakfast"},
	{"饺子", "Chinese dumplings"},
	{"包子", "Chinese steamed bun"},
	{"火锅", "Chinese hot pot"},
	{"螺蛳粉", "Luosifen noodles"},
	{"意面", "pasta dish"},
	{"意大利", "Italian pasta"},
	{"鸡蛋", "scrambled eggs food"},
	{"蛋", "egg dish food"},
	{"蒜蓉", "garlic stir fry vegetables"},
	{"蒜香", "garlic vegetable dish"},
	{"蒸", "Chinese steamed food"},
	{"炒", "Chinese stir fry food"},
	{"拌", "Chinese cold dish salad"},
	{"烤", "roasted food dish"},
	{"炸", "fried food dish"},
	{"炖", "Chinese braised stew"},
	{"煮", "Chinese boiled food"},
	// English tokens → food photos
	{"chocolate", "chocolate dessert cake"},
	{"cheesecake", "cheesecake slice"},
	{"pizza", "pizza food"},
	{"pasta", "pasta dish"},
	{"lasagna", "lasagna food"},
	{"lasagne", "lasagna food"},
	{"salmon", "grilled salmon plate"},
	{"tuna", "tuna salad food"},
	{"shrimp", "shrimp dish food"},
	{"turkey", "roast turkey food"},
	{"steak", "steak dinner plate"},
	{"sausage", "sausage food"},
	{"bacon", "bacon breakfast"},
	{"lamb", "lamb roast food"},
	{"burger", "burger food"},
	{"burgers", "burger food"},
	{"sandwich", "sandwich food"},
	{"sandwiches", "sandwich food"},
	{"casserole", "casserole dish food"},
	{"chili", "chili bowl food"},
	{"curry", "curry dish food"},
	{"stew", "stew bowl food"},
	{"soup", "soup bowl food"},
	{"salad", "salad bowl food"},
	{"tofu", "tofu dish food"},
	{"zucchini", "zucchini food dish"},
	{"eggplant", "eggplant food dish"},
	{"mushroom", "mushroom dish food"},
	{"mushrooms", "mushroom dish food"},
	{"spinach", "spinach salad food"},
	{"asparagus", "asparagus dish"},
	{"cabbage", "cabbage dish food"},
	{"pumpkin", "pumpkin food dish"},
	{"apple", "apple dessert food"},
	{"raspberry", "raspberry dessert"},
	{"rhubarb", "rhubarb dessert"},
	{"lemon", "lemon dessert food"},
	{"orange", "orange dessert food"},
	{"coconut", "coconut dessert"},
	{"garlic", "garlic food dish"},
	{"ginger", "ginger food dish"},
	{"tomato", "tomato food dish"},
	{"tomatoes", "tomato food dish"},
	{"pepper", "pepper food dish"},
	{"peppers", "pepper food dish"},
	{"onion", "onion food dish"},
	{"onions", "onion food dish"},
	{"bean", "bean dish food"},
	{"beans", "bean dish food"},
	{"corn", "corn food dish"},
	{"squash", "squash food dish"},
	{"rosemary", "rosemary roast food"},
	{"basil", "basil pasta food"},
	{"greek", "Greek salad food"},
	{"irish", "Irish stew food"},
	{"german", "German food dish"},
	{"thai", "Thai food dish"},
	{"italian", "Italian pasta food"},
	{"mexican", "Mexican food dish"},
	{"pancake", "pancakes breakfast"},
	{"waffle", "waffles breakfast"},
	{"muffin", "muffin bakery"},
	{"cookie", "cookies bakery"},
	{"cookies", "cookies bakery"},
	{"brownie", "brownies dessert"},
	{"pudding", "pudding dessert"},
	{"pie", "pie dessert"},
	{"tart", "tart dessert"},
	{"cake", "cake dessert"},
	{"bread", "bread bakery"},
	{"biscuit", "biscuits bakery"},
	{"granola", "granola breakfast bowl"},
	{"oatmeal", "oatmeal breakfast"},
	{"smoothie", "smoothie drink"},
	{"cocktail", "cocktail drink"},
	{"vinaigrette", "salad vinaigrette"},
	{"risotto", "risotto dish"},
	{"paella", "paella dish"},
	{"sushi", "sushi platter"},
	{"ramen", "ramen bowl"},
	{"noodle", "noodle bowl food"},
	{"noodles", "noodle bowl food"},
	{"rice", "rice bowl food"},
	{"chicken", "chicken dinner plate"},
	{"beef", "beef dinner plate"},
	{"pork", "pork dinner plate"},
	{"fish", "fish dinner plate"},
	{"seafood", "seafood platter"},
	{"vegetable", "vegetable dish food"},
	{"vegetables", "vegetable dish food"},
	{"breakfast", "breakfast plate food"},
	{"dessert", "dessert plate food"},
}

var kitchenwareKeywords = []struct {
	Key   string
	Query string
}{
	{"电热锅", "electric hot pot kitchen"},
	{"电炖锅", "electric slow cooker"},
	{"电饭煲", "rice cooker appliance"},
	{"微波炉", "microwave oven kitchen"},
	{"烤箱", "kitchen oven"},
	{"空气炸锅", "air fryer kitchen"},
	{"破壁机", "blender kitchen appliance"},
	{"搅拌机", "kitchen blender"},
	{"洗碗机", "dishwasher appliance"},
	{"油烟机", "kitchen range hood"},
	{"燃气灶", "gas stove kitchen"},
	{"电水壶", "electric kettle"},
	{"保温杯", "thermos bottle"},
	{"蒸锅", "bamboo steamer pot"},
	{"砂锅", "clay pot casserole"},
	{"炒锅", "wok pan kitchen"},
	{"平底锅", "frying pan kitchen"},
	{"煎锅", "skillet pan kitchen"},
	{"汤锅", "stock pot kitchen"},
	{"奶锅", "saucepan kitchen"},
	{"压力锅", "pressure cooker"},
	{"刨丝器", "kitchen grater"},
	{"砧板", "cutting board kitchen"},
	{"菜刀", "kitchen chef knife"},
	{"水果刀", "paring knife kitchen"},
	{"厨房刀", "kitchen knife"},
	{"通用刀", "kitchen knife"},
	{"拇指刀", "kitchen knife"},
	{"筷子", "chopsticks"},
	{"汤勺", "soup ladle kitchen"},
	{"锅铲", "spatula kitchen"},
	{"漏勺", "kitchen strainer spoon"},
	{"滤干架", "dish drying rack"},
	{"玻璃瓶", "glass bottle kitchen"},
	{"储物罐", "kitchen storage jar"},
	{"保鲜膜", "plastic wrap kitchen"},
	{"烘焙纸", "parchment baking paper"},
	{"模具", "baking mold kitchen"},
	{"隔热手套", "oven mitt kitchen"},
	{"防溅网", "splatter screen kitchen"},
	{"秤", "kitchen scale"},
	{"温度计", "kitchen thermometer"},
	{"碗", "ceramic bowl kitchen"},
	{"盘", "dinner plate kitchen"},
	{"杯", "drinking cup kitchen"},
	{"瓶", "kitchen bottle"},
	{"盒", "food storage container"},
	{"架", "kitchen rack shelf"},
	{"刀", "kitchen knife"},
	{"铲", "kitchen spatula"},
	{"勺", "kitchen spoon"},
	{"锅", "cooking pot kitchen"},
	{"炉", "kitchen stove"},
	{"机", "kitchen appliance"},
	{"刷", "kitchen brush"},
	{"刮", "kitchen scraper"},
	{"刨", "kitchen peeler"},
	{"筷", "chopsticks"},
	{"叉", "kitchen fork"},
	{"烘焙", "baking tools kitchen"},
	{"清洁", "kitchen cleaning tools"},
}

var categoryFallbacks = map[string]string{
	"营养餐单": "Chinese home cooking plated food",
	"增肌":   "grilled chicken rice meal",
	"减脂":   "vegetable salad bowl",
	"快手菜":  "Chinese stir fry plate",
	"厨具":   "kitchen utensils",
	"小家电":  "kitchen appliance",
	"刀具餐具": "kitchen knives",
	"烹饪锅具": "cooking pots pans",
	"烘焙工具": "baking tools",
	"清洁":   "kitchen sponge brush",
	"餐具与食物容器": "kitchen bowls plates",
	"刀具与手动工具": "kitchen knife tools",
	"料理与饮品电器": "kitchen blender kettle",
	"烹饪电器": "rice cooker appliance",
	"锅具与烘焙器具": "cookware pans pots",
	"制冷与清洗电器": "dishwasher appliance",
	"餐具": "ceramic plates bowls",
	"厨卫电器": "kitchen appliance",
	"家居厨具": "kitchen utensils",
	"其他": "kitchen utensils",
	"厨房用品综合": "kitchen gadgets",
	"来源明确列出的工具": "kitchen tools",
	"default-recipe": "plated dinner food",
	"default-kitchenware": "kitchen utensils",
}

func main() {
	configPath := flag.String("config", "configs/config.yaml", "config path")
	limit := flag.Int("limit", 0, "max rows per table (0 = all)")
	workers := flag.Int("workers", 4, "download/upload workers")
	dryRun := flag.Bool("dry-run", false, "resolve matches without writing")
	only := flag.String("only", "all", "recipes | kitchenware | all")
	skipDone := flag.Bool("skip-done", true, "skip rows already pointing at /real- CDN images")
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

	client := &http.Client{Timeout: 45 * time.Second}
	cache := &imageCache{
		client:   client,
		resolved: map[string]string{},
		uploaded: map[string]string{},
		inflight: map[string]*sync.WaitGroup{},
	}

	if *only == "all" || *only == "recipes" {
		runTable(db, client, cache, "recipes", *limit, *workers, *dryRun, *skipDone, true)
	}
	if *only == "all" || *only == "kitchenware" {
		runTable(db, client, cache, "kitchenware_catalog", *limit, *workers, *dryRun, *skipDone, false)
	}
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func runTable(db *dbx.DB, client *http.Client, cache *imageCache, table string, limit, workers int, dryRun, skipDone, isRecipe bool) {
	_ = workers // two-phase run is serial for Commons; workers unused
	if !db.HasTable(table) {
		logf("skip %s (missing table)", table)
		return
	}
	nameCol := "name"
	if isRecipe {
		nameCol = "title"
	}
	sql := fmt.Sprintf(`SELECT id, COALESCE(%s,''), COALESCE(category,''), COALESCE(image_url,'') FROM %s ORDER BY id`, nameCol, table)
	if limit > 0 {
		sql += fmt.Sprintf(" LIMIT %d", limit)
	}
	rows, err := db.Query(sql)
	if err != nil {
		logf("%s query failed: %v", table, err)
		return
	}
	type row struct {
		ID       int
		Name     string
		Category string
		ImageURL string
	}
	type group struct {
		query string
		ids   []int
	}
	groups := map[string]*group{}
	order := make([]string, 0)
	skipped := 0
	for rows.Next() {
		var r row
		if rows.Scan(&r.ID, &r.Name, &r.Category, &r.ImageURL) != nil {
			continue
		}
		if skipDone && strings.Contains(r.ImageURL, "/real-") {
			skipped++
			continue
		}
		query, matchKey := matchQuery(r.Name, r.Category, isRecipe)
		g, ok := groups[matchKey]
		if !ok {
			g = &group{query: query}
			groups[matchKey] = g
			order = append(order, matchKey)
		}
		g.ids = append(g.ids, r.ID)
	}
	_ = rows.Close()

	totalRows := 0
	for _, g := range groups {
		totalRows += len(g.ids)
	}
	logf("%s queued %d rows across %d unique keys (skipped-done %d)", table, totalRows, len(order), skipped)
	if totalRows == 0 {
		return
	}

	ok, fail := 0, 0
	for i, matchKey := range order {
		g := groups[matchKey]
		pub, _, err := cache.ensure(g.query, matchKey, table, dryRun)
		if err != nil || pub == "" {
			logf("%s key %s failed (%d rows): %v", table, matchKey, len(g.ids), err)
			fail += len(g.ids)
			continue
		}
		if dryRun {
			logf("[dry-run] %s %s -> %s (%d rows)", table, matchKey, pub, len(g.ids))
			ok += len(g.ids)
			continue
		}
		for _, id := range g.ids {
			var err error
			if isRecipe {
				_, err = db.Exec(`UPDATE recipes SET image_url=?, cover_image_url=? WHERE id=?`, pub, pub, id)
			} else {
				_, err = db.Exec(`UPDATE kitchenware_catalog SET image_url=? WHERE id=?`, pub, id)
			}
			if err != nil {
				logf("%s#%d update failed: %v", table, id, err)
				fail++
				continue
			}
			ok++
		}
		if (i+1)%10 == 0 || i+1 == len(order) {
			logf("%s keys %d/%d rows_ok=%d fail=%d last=%s", table, i+1, len(order), ok, fail, matchKey)
		}
	}
	logf("%s done ok=%d fail=%d unique_images=%d", table, ok, fail, cache.uniqueCount())
}

func matchQuery(name, category string, isRecipe bool) (query, cacheKey string) {
	name = strings.TrimSpace(name)
	category = strings.TrimSpace(category)
	keys := recipeKeywords
	if !isRecipe {
		keys = kitchenwareKeywords
	}
	bestKey, bestQuery, bestLen := "", "", 0
	lower := strings.ToLower(name)
	for _, k := range keys {
		key := k.Key
		hit := false
		if isASCII(key) {
			hit = containsWord(lower, strings.ToLower(key))
		} else {
			hit = strings.Contains(name, key)
		}
		if hit && len([]rune(key)) > bestLen {
			bestKey, bestQuery, bestLen = key, k.Query, len([]rune(key))
		}
	}
	if bestQuery != "" {
		return bestQuery, "kw:" + bestKey
	}
	// English title: only match curated keyword keys (avoid thousands of unique Commons queries).
	if isRecipe {
		tokens := enTokens(name)
		tokenSet := map[string]struct{}{}
		for _, t := range tokens {
			tokenSet[t] = struct{}{}
		}
		bestLen = 0
		for _, k := range recipeKeywords {
			if !isASCII(k.Key) {
				continue
			}
			if _, ok := tokenSet[strings.ToLower(k.Key)]; ok && len(k.Key) > bestLen {
				bestKey, bestQuery, bestLen = k.Key, k.Query, len(k.Key)
			}
		}
		if bestQuery != "" {
			return bestQuery, "kw:" + bestKey
		}
	}
	if q, ok := categoryFallbacks[category]; ok {
		return q, "cat:" + category
	}
	if isRecipe {
		return categoryFallbacks["default-recipe"], "cat:default-recipe"
	}
	return categoryFallbacks["default-kitchenware"], "cat:default-kitchenware"
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func containsWord(haystack, word string) bool {
	if word == "" {
		return false
	}
	idx := strings.Index(haystack, word)
	for idx >= 0 {
		beforeOK := idx == 0 || !isAlpha(rune(haystack[idx-1]))
		after := idx + len(word)
		afterOK := after >= len(haystack) || !isAlpha(rune(haystack[after]))
		if beforeOK && afterOK {
			return true
		}
		next := strings.Index(haystack[idx+1:], word)
		if next < 0 {
			return false
		}
		idx = idx + 1 + next
	}
	return false
}

func isAlpha(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

func enTokens(title string) []string {
	raw := enWordRe.FindAllString(strings.ToLower(title), -1)
	out := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, w := range raw {
		w = strings.Trim(w, "'")
		if len(w) < 4 {
			continue
		}
		if _, stop := enStop[w]; stop {
			continue
		}
		if _, ok := seen[w]; ok {
			continue
		}
		seen[w] = struct{}{}
		out = append(out, w)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return len(out[i]) > len(out[j])
	})
	return out
}

type imageCache struct {
	client   *http.Client
	mu       sync.Mutex
	resolved map[string]string // cacheKey -> source URL
	uploaded map[string]string // cacheKey -> public CDN URL
	inflight map[string]*sync.WaitGroup
}

func (c *imageCache) uniqueCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.uploaded)
}

func (c *imageCache) ensure(query, cacheKey, table string, dryRun bool) (pub, key string, err error) {
	for {
		c.mu.Lock()
		if pub, ok := c.uploaded[cacheKey]; ok {
			c.mu.Unlock()
			return pub, "", nil
		}
		if wg, busy := c.inflight[cacheKey]; busy {
			c.mu.Unlock()
			wg.Wait()
			continue
		}
		wg := &sync.WaitGroup{}
		wg.Add(1)
		c.inflight[cacheKey] = wg
		c.mu.Unlock()

		pub, key, err = c.fill(query, cacheKey, table, dryRun)

		c.mu.Lock()
		delete(c.inflight, cacheKey)
		if err == nil && pub != "" {
			c.uploaded[cacheKey] = pub
		}
		c.mu.Unlock()
		wg.Done()
		return pub, key, err
	}
}

func (c *imageCache) fill(query, cacheKey, table string, dryRun bool) (pub, key string, err error) {
	src, err := c.resolveSource(query, cacheKey)
	if err != nil {
		return "", "", err
	}
	if dryRun {
		return src, "", nil
	}

	data, contentType, err := download(c.client, src, 3)
	if err != nil {
		return "", "", err
	}
	if len(data) < 4000 {
		return "", "", fmt.Errorf("image too small (%d bytes) from %s", len(data), src)
	}
	ext := extFromURLOrMIME(src, contentType, data)
	sum := sha1.Sum([]byte(cacheKey + ":" + src))
	objectKey := fmt.Sprintf("dietdigidose/catalog/%s/real-%s.%s", table, hex.EncodeToString(sum[:10]), ext)
	if err := pkgstorage.Write(objectKey, bytes.NewReader(data)); err != nil {
		return "", "", err
	}
	return pkgstorage.PublicURL(objectKey), objectKey, nil
}

func (c *imageCache) resolveSource(query, cacheKey string) (string, error) {
	c.mu.Lock()
	if src, ok := c.resolved[cacheKey]; ok {
		c.mu.Unlock()
		return src, nil
	}
	c.mu.Unlock()

	src, err := commonsSearch(c.client, query)
	if err != nil {
		return "", err
	}
	time.Sleep(120 * time.Millisecond) // be polite to Commons
	c.mu.Lock()
	c.resolved[cacheKey] = src
	c.mu.Unlock()
	return src, nil
}

func commonsSearch(client *http.Client, query string) (string, error) {
	fallbacks := []string{query, "plated food dish", "kitchen utensils"}
	var lastErr error
	for _, q := range fallbacks {
		url, err := commonsSearchOnce(client, q)
		if err == nil {
			return url, nil
		}
		lastErr = err
		time.Sleep(80 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no commons image for %q", query)
	}
	return "", lastErr
}

var commonsGate = make(chan struct{}, 1)

func commonsSearchOnce(client *http.Client, query string) (string, error) {
	commonsGate <- struct{}{}
	defer func() { <-commonsGate }()

	params := url.Values{}
	params.Set("action", "query")
	params.Set("generator", "search")
	params.Set("gsrsearch", query)
	params.Set("gsrnamespace", "6")
	params.Set("gsrlimit", "8")
	params.Set("prop", "imageinfo")
	params.Set("iiprop", "url|mime|size")
	params.Set("iiurlwidth", "800")
	params.Set("format", "json")
	reqURL := "https://commons.wikimedia.org/w/api.php?" + params.Encode()

	var lastErr error
	for attempt := 1; attempt <= 4; attempt++ {
		req, err := http.NewRequest(http.MethodGet, reqURL, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("User-Agent", "DietDigiDoseCatalogBot/1.0 (local-dev; catalog image backfill; https://github.com/heathcetide/DietDigiDose)")
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("commons HTTP %d", resp.StatusCode)
			time.Sleep(time.Duration(attempt*2) * time.Second)
			continue
		}
		if resp.StatusCode >= 300 {
			return "", fmt.Errorf("commons HTTP %d", resp.StatusCode)
		}
		return pickCommonsURL(body, query)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("commons search failed for %q", query)
	}
	return "", lastErr
}

func pickCommonsURL(body []byte, query string) (string, error) {
	var parsed commonsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	bestURL := ""
	bestScore := -1
	for _, page := range parsed.Query.Pages {
		if len(page.ImageInfo) == 0 {
			continue
		}
		info := page.ImageInfo[0]
		mime := strings.ToLower(info.MIME)
		if !strings.Contains(mime, "jpeg") && !strings.Contains(mime, "jpg") && !strings.Contains(mime, "png") && !strings.Contains(mime, "webp") {
			continue
		}
		candidate := strings.TrimSpace(info.ThumbURL)
		if candidate == "" {
			candidate = strings.TrimSpace(info.URL)
		}
		if candidate == "" {
			continue
		}
		score := 10
		titleLower := strings.ToLower(page.Title)
		if strings.Contains(titleLower, "logo") || strings.Contains(titleLower, "icon") || strings.Contains(titleLower, "svg") || strings.Contains(titleLower, "map") {
			score -= 8
		}
		if strings.Contains(mime, "jpeg") || strings.Contains(mime, "jpg") {
			score += 3
		}
		if info.Size > 20000 && info.Size < 8<<20 {
			score += 2
		}
		if score > bestScore {
			bestScore = score
			bestURL = candidate
		}
	}
	if bestURL == "" {
		return "", fmt.Errorf("no commons image for %q", query)
	}
	if u, err := url.Parse(bestURL); err == nil {
		u.RawQuery = ""
		bestURL = u.String()
	}
	return bestURL, nil
}

func download(client *http.Client, rawURL string, retries int) ([]byte, string, error) {
	if retries < 1 {
		retries = 1
	}
	var lastErr error
	for attempt := 1; attempt <= retries; attempt++ {
		req, err := http.NewRequest(http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, "", err
		}
		req.Header.Set("User-Agent", "DietDigiDoseCatalogBot/1.0 (local-dev; catalog image backfill)")
		req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
			continue
		}
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			time.Sleep(time.Duration(attempt*2) * time.Second)
			continue
		}
		if resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			time.Sleep(time.Duration(attempt) * 400 * time.Millisecond)
			continue
		}
		if len(body) == 0 {
			lastErr = fmt.Errorf("empty body")
			continue
		}
		return body, resp.Header.Get("Content-Type"), nil
	}
	return nil, "", lastErr
}

func extFromURLOrMIME(rawURL, mime string, data []byte) string {
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
	base := strings.ToLower(path.Ext(strings.Split(rawURL, "?")[0]))
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
