// Copyright (c) 2026 heathcetide. All rights reserved.
//
// migrate-sqlite-mysql creates a MySQL database and copies all rows from a
// local SQLite file. Secrets come from the environment only:
//
//	MYSQL_ADMIN_DSN='user:pass@tcp(host:port)/'   # no database name (CREATE DATABASE)
//	MYSQL_DSN='user:pass@tcp(host:port)/dietdigidose?charset=utf8mb4&parseTime=True&loc=Local'
//	SQLITE_PATH=../data/dietdigidose.db            # optional
//	MYSQL_DATABASE=dietdigidose                   # optional, default dietdigidose
//
// Keep literal '#' in the password; do not URL-encode as %23 for go-sql-driver/mysql.

package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/glebarez/go-sqlite"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "migrate-sqlite-mysql: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	adminDSN := strings.TrimSpace(os.Getenv("MYSQL_ADMIN_DSN"))
	mysqlDSN := strings.TrimSpace(os.Getenv("MYSQL_DSN"))
	dbName := strings.TrimSpace(os.Getenv("MYSQL_DATABASE"))
	if dbName == "" {
		dbName = "dietdigidose"
	}
	sqlitePath := strings.TrimSpace(os.Getenv("SQLITE_PATH"))
	if sqlitePath == "" {
		sqlitePath = defaultSQLitePath()
	}
	if mysqlDSN == "" {
		return fmt.Errorf("MYSQL_DSN is required")
	}
	mysqlDSN = ensureMySQLTimeouts(mysqlDSN)
	if adminDSN == "" {
		adminDSN = stripDatabase(mysqlDSN)
	}
	if _, err := os.Stat(sqlitePath); err != nil {
		return fmt.Errorf("sqlite file %s: %w", sqlitePath, err)
	}

	reset := strings.EqualFold(strings.TrimSpace(os.Getenv("MYSQL_RESET")), "1") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("MYSQL_RESET")), "true")
	if reset {
		fmt.Printf("dropping database %q (MYSQL_RESET)…\n", dbName)
		if err := dropDatabase(adminDSN, dbName); err != nil {
			return err
		}
	}
	fmt.Printf("creating database %q if needed…\n", dbName)
	if err := createDatabase(adminDSN, dbName); err != nil {
		return err
	}

	fmt.Printf("opening MySQL and applying Go schema…\n")
	mysqlDB, dialect, err := appdb.Open("mysql", mysqlDSN)
	if err != nil {
		return err
	}
	defer mysqlDB.Close()
	if dialect != "mysql" {
		return fmt.Errorf("expected mysql dialect, got %s", dialect)
	}
	if err := appdb.Migrate(mysqlDB); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}

	fmt.Printf("opening SQLite %s…\n", sqlitePath)
	sqliteDB, _, err := appdb.Open("sqlite", sqlitePath)
	if err != nil {
		return err
	}
	defer sqliteDB.Close()

	tables, err := listSQLiteTables(sqliteDB)
	if err != nil {
		return err
	}
	fmt.Printf("copying %d tables…\n", len(tables))
	for _, stmt := range []string{
		`SET FOREIGN_KEY_CHECKS=0`,
		`SET UNIQUE_CHECKS=0`,
		`SET SESSION sql_mode=REPLACE(@@sql_mode,'NO_ZERO_DATE','')`,
	} {
		if _, err := mysqlDB.Exec(stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	defer func() {
		_, _ = mysqlDB.Exec(`SET UNIQUE_CHECKS=1`)
		_, _ = mysqlDB.Exec(`SET FOREIGN_KEY_CHECKS=1`)
	}()

	for _, table := range tables {
		if table == "go_schema_migrations" || table == "sqlite_sequence" {
			continue
		}
		started := time.Now()
		fmt.Printf("  %s…", table)
		_ = os.Stdout.Sync()
		n, err := copyTable(sqliteDB, mysqlDB, table)
		if err != nil {
			fmt.Println()
			return fmt.Errorf("copy %s: %w", table, err)
		}
		fmt.Printf(" %d rows (%s)\n", n, time.Since(started).Round(time.Millisecond))
		if err := syncAutoIncrement(mysqlDB, table); err != nil {
			return fmt.Errorf("auto_increment %s: %w", table, err)
		}
	}

	fmt.Println("verifying row counts…")
	var mismatches int
	for _, table := range tables {
		if table == "go_schema_migrations" || table == "sqlite_sequence" {
			continue
		}
		var src, dst int
		if err := sqliteDB.QueryRow(`SELECT COUNT(*) FROM ` + quoteIdentSQLite(table)).Scan(&src); err != nil {
			return err
		}
		if err := mysqlDB.QueryRow(`SELECT COUNT(*) FROM ` + quoteIdentMySQL(table)).Scan(&dst); err != nil {
			return err
		}
		if src != dst {
			mismatches++
			fmt.Printf("  MISMATCH %s: sqlite=%d mysql=%d\n", table, src, dst)
		}
	}
	if mismatches > 0 {
		return fmt.Errorf("%d table count mismatches", mismatches)
	}
	fmt.Println("migration complete")
	return nil
}

func defaultSQLitePath() string {
	candidates := []string{
		filepath.Join("..", "..", "data", "dietdigidose.db"),
		filepath.Join("data", "dietdigidose.db"),
		filepath.Join("..", "data", "dietdigidose.db"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append([]string{filepath.Join(wd, "data", "dietdigidose.db")}, candidates...)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return filepath.Join("data", "dietdigidose.db")
}

func stripDatabase(dsn string) string {
	// user:pass@tcp(host:port)/dbname?params → user:pass@tcp(host:port)/
	at := strings.Index(dsn, "@tcp(")
	if at < 0 {
		return dsn
	}
	slash := strings.Index(dsn[at:], ")/")
	if slash < 0 {
		return dsn
	}
	base := dsn[:at+slash+2] // include )/
	return base
}

func ensureMySQLTimeouts(dsn string) string {
	add := []string{}
	lower := strings.ToLower(dsn)
	if !strings.Contains(lower, "timeout=") {
		add = append(add, "timeout=60s")
	}
	if !strings.Contains(lower, "readtimeout=") {
		add = append(add, "readTimeout=120s")
	}
	if !strings.Contains(lower, "writetimeout=") {
		add = append(add, "writeTimeout=120s")
	}
	if !strings.Contains(lower, "interpolateparams=") {
		add = append(add, "interpolateParams=true")
	}
	if len(add) == 0 {
		return dsn
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + strings.Join(add, "&")
}

func openAdmin(adminDSN string) (*sql.DB, error) {
	if !strings.Contains(adminDSN, "@tcp(") {
		return nil, fmt.Errorf("MYSQL_ADMIN_DSN must be a go-sql-driver DSN")
	}
	conn, err := sql.Open("mysql", adminDSN)
	if err != nil {
		return nil, err
	}
	conn.SetConnMaxLifetime(time.Minute)
	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ping admin dsn: %w", err)
	}
	return conn, nil
}

func safeDBName(name string) string {
	return strings.ReplaceAll(name, "`", "")
}

func createDatabase(adminDSN, name string) error {
	conn, err := openAdmin(adminDSN)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Exec(fmt.Sprintf(
		"CREATE DATABASE IF NOT EXISTS `%s` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
		safeDBName(name),
	))
	return err
}

func dropDatabase(adminDSN, name string) error {
	conn, err := openAdmin(adminDSN)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", safeDBName(name)))
	return err
}

func listSQLiteTables(db *dbx.DB) ([]string, error) {
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func tableColumns(db *dbx.DB, dialect, table string) ([]string, error) {
	var q string
	switch dialect {
	case "sqlite":
		q = `SELECT name FROM pragma_table_info(?) ORDER BY cid`
	case "mysql":
		q = `SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`
	default:
		return nil, fmt.Errorf("unsupported dialect %s", dialect)
	}
	rows, err := db.Query(q, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

func copyTable(src, dst *dbx.DB, table string) (int64, error) {
	srcCols, err := tableColumns(src, "sqlite", table)
	if err != nil {
		return 0, err
	}
	dstCols, err := tableColumns(dst, "mysql", table)
	if err != nil {
		return 0, err
	}
	dstSet := map[string]struct{}{}
	for _, c := range dstCols {
		dstSet[strings.ToLower(c)] = struct{}{}
	}
	var cols []string
	for _, c := range srcCols {
		if _, ok := dstSet[strings.ToLower(c)]; ok {
			cols = append(cols, c)
		}
	}
	if len(cols) == 0 {
		return 0, fmt.Errorf("no overlapping columns")
	}

	if _, err := dst.Exec(`DELETE FROM ` + quoteIdentMySQL(table)); err != nil {
		return 0, err
	}

	selectSQL := `SELECT ` + joinQuoteSQLite(cols) + ` FROM ` + quoteIdentSQLite(table)
	rows, err := src.Query(selectSQL)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	placeholders := strings.TrimRight(strings.Repeat("?,", len(cols)), ",")
	insertPrefix := `INSERT INTO ` + quoteIdentMySQL(table) + ` (` + joinQuoteMySQL(cols) + `) VALUES `

	batchSize := 200
	switch table {
	case "recipes", "ingredients_library", "kitchenware_catalog", "community_comments", "community_posts", "users":
		batchSize = 40
	}

	var total int64
	var batchArgs [][]any
	flush := func() error {
		if len(batchArgs) == 0 {
			return nil
		}
		var b strings.Builder
		b.Grow(len(insertPrefix) + len(batchArgs)*(len(placeholders)+3))
		b.WriteString(insertPrefix)
		flat := make([]any, 0, len(batchArgs)*len(cols))
		for i, row := range batchArgs {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteByte('(')
			b.WriteString(placeholders)
			b.WriteByte(')')
			flat = append(flat, row...)
		}
		if _, err := dst.Exec(b.String(), flat...); err != nil {
			return err
		}
		total += int64(len(batchArgs))
		batchArgs = batchArgs[:0]
		return nil
	}

	for rows.Next() {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return total, err
		}
		args := make([]any, len(cols))
		for i, v := range raw {
			args[i] = normalizeValue(v)
		}
		batchArgs = append(batchArgs, args)
		if len(batchArgs) >= batchSize {
			if err := flush(); err != nil {
				return total, err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	if err := flush(); err != nil {
		return total, err
	}
	return total, nil
}

func normalizeValue(v any) any {
	switch t := v.(type) {
	case []byte:
		// SQLite may return TEXT as []byte; MySQL driver accepts string or []byte.
		return append([]byte(nil), t...)
	default:
		return v
	}
}

func syncAutoIncrement(db *dbx.DB, table string) error {
	var col string
	err := db.QueryRow(`
		SELECT column_name FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name=? AND extra LIKE '%auto_increment%'
		LIMIT 1`, table).Scan(&col)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	var max sql.NullInt64
	if err := db.QueryRow(`SELECT MAX(` + quoteIdentMySQL(col) + `) FROM ` + quoteIdentMySQL(table)).Scan(&max); err != nil {
		return err
	}
	next := int64(1)
	if max.Valid && max.Int64 >= 1 {
		next = max.Int64 + 1
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s AUTO_INCREMENT=%d", quoteIdentMySQL(table), next))
	return err
}

func quoteIdentSQLite(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
func quoteIdentMySQL(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
func joinQuoteSQLite(cols []string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = quoteIdentSQLite(c)
	}
	return strings.Join(parts, ",")
}
func joinQuoteMySQL(cols []string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = quoteIdentMySQL(c)
	}
	return strings.Join(parts, ",")
}
