// Package dbx is the SQL boundary for the migrated application domains.
// Queries use ? parameters; only unquoted parameters are rebound for PostgreSQL.
// SQL dialect differences other than parameters remain explicit at call sites.
package dbx

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type DB struct {
	*sql.DB
	Dialect string
}

type Tx struct {
	*sql.Tx
	dialect string
}

func Wrap(db *sql.DB, dialect string) *DB { return &DB{DB: db, Dialect: dialect} }

func (db *DB) Exec(query string, args ...any) (sql.Result, error) {
	return db.ExecContext(context.Background(), query, args...)
}
func (db *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return db.DB.ExecContext(ctx, Bind(query, db.Dialect), args...)
}
func (db *DB) Query(query string, args ...any) (*sql.Rows, error) {
	return db.QueryContext(context.Background(), query, args...)
}
func (db *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return db.DB.QueryContext(ctx, Bind(query, db.Dialect), args...)
}
func (db *DB) QueryRow(query string, args ...any) *sql.Row {
	return db.QueryRowContext(context.Background(), query, args...)
}
func (db *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return db.DB.QueryRowContext(ctx, Bind(query, db.Dialect), args...)
}
func (db *DB) Begin() (*Tx, error) { return db.BeginTx(context.Background(), nil) }
func (db *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := db.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: db.Dialect}, nil
}
func (tx *Tx) Exec(query string, args ...any) (sql.Result, error) {
	return tx.ExecContext(context.Background(), query, args...)
}
func (tx *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return tx.Tx.ExecContext(ctx, Bind(query, tx.dialect), args...)
}
func (tx *Tx) Query(query string, args ...any) (*sql.Rows, error) {
	return tx.QueryContext(context.Background(), query, args...)
}
func (tx *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return tx.Tx.QueryContext(ctx, Bind(query, tx.dialect), args...)
}
func (tx *Tx) QueryRow(query string, args ...any) *sql.Row {
	return tx.QueryRowContext(context.Background(), query, args...)
}
func (tx *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return tx.Tx.QueryRowContext(ctx, Bind(query, tx.dialect), args...)
}

// InsertID uses RETURNING on both supported databases. Never use LastInsertId:
// PostgreSQL does not implement it, including inside transactions.
func (db *DB) InsertID(query string, args ...any) (int64, error) {
	var id int64
	err := db.QueryRow(strings.TrimSuffix(strings.TrimSpace(query), ";")+" RETURNING id", args...).Scan(&id)
	return id, err
}
func (tx *Tx) InsertID(query string, args ...any) (int64, error) {
	var id int64
	err := tx.QueryRow(strings.TrimSuffix(strings.TrimSpace(query), ";")+" RETURNING id", args...).Scan(&id)
	return id, err
}

func (db *DB) HasTable(name string) bool {
	var n int
	query := `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`
	if db.Dialect == "postgresql" {
		query = `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?`
	}
	return db.QueryRow(query, name).Scan(&n) == nil && n > 0
}
func (db *DB) HasColumn(table, column string) bool {
	var n int
	query := `SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`
	if db.Dialect == "postgresql" {
		query = `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?`
	}
	return db.QueryRow(query, table, column).Scan(&n) == nil && n > 0
}

// Bind deliberately ignores strings, quoted identifiers, SQL comments and
// PostgreSQL dollar-quoted bodies. PostgreSQL JSON ? operators are not part of
// this placeholder syntax; use jsonb_exists/jsonb_exists_any instead.
func Bind(query, dialect string) string {
	if dialect != "postgresql" {
		return query
	}
	var out strings.Builder
	n := 0
	for i := 0; i < len(query); {
		start := i
		switch {
		case query[i] == '\'' || query[i] == '"' || query[i] == '`':
			quote := query[i]
			i++
			for i < len(query) {
				if query[i] == quote {
					i++
					if i < len(query) && query[i] == quote {
						i++
						continue
					}
					break
				}
				i++
			}
		case strings.HasPrefix(query[i:], "--"):
			for i < len(query) && query[i] != '\n' {
				i++
			}
		case strings.HasPrefix(query[i:], "/*"):
			i += 2
			depth := 1
			for i < len(query) && depth > 0 {
				if strings.HasPrefix(query[i:], "/*") {
					depth++
					i += 2
				} else if strings.HasPrefix(query[i:], "*/") {
					depth--
					i += 2
				} else {
					i++
				}
			}
		case query[i] == '$':
			j := i + 1
			for j < len(query) && ((query[j] >= 'a' && query[j] <= 'z') || (query[j] >= 'A' && query[j] <= 'Z') || query[j] == '_' || (j > i+1 && query[j] >= '0' && query[j] <= '9')) {
				j++
			}
			if j < len(query) && query[j] == '$' {
				tag := query[i : j+1]
				if end := strings.Index(query[j+1:], tag); end >= 0 {
					i = j + 1 + end + len(tag)
				} else {
					i = len(query)
				}
			} else {
				i++
			}
		case query[i] == '?':
			n++
			fmt.Fprintf(&out, "$%d", n)
			i++
			continue
		default:
			i++
		}
		out.WriteString(query[start:i])
	}
	return out.String()
}
