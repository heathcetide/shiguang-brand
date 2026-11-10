package dbx_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// Business SQL must not silently regain SQLite-only operations or bypass dbx.
func TestDomainsUsePortableSQLBoundary(t *testing.T) {
	_, self, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(self), "..", "domains")
	sqliteOnly := regexp.MustCompile(`(?i)\b(INSERT\s+OR\s+(IGNORE|REPLACE)|sqlite_master|PRAGMA|CREATE\s+TABLE)\b`)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok {
				if sel.Sel.Name == "LastInsertId" {
					t.Errorf("%s uses LastInsertId instead of RETURNING", path)
				}
				if ident, ok := sel.X.(*ast.Ident); ok && ident.Name == "sql" && (sel.Sel.Name == "DB" || sel.Sel.Name == "Tx") {
					t.Errorf("%s bypasses the dbx SQL boundary", path)
				}
			}
			if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING {
				value, _ := strconv.Unquote(lit.Value)
				if sqliteOnly.MatchString(value) {
					t.Errorf("%s contains SQLite-only SQL/request-time DDL: %s", path, value)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
