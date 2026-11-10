// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package codegen provides helpers for programmatically manipulating Go
// source code via the go/ast package. It is designed for code generation
// tools, scaffolding utilities, and AST-based source transformation.
//
// # Quick start
//
//	// Parse a Go file.
//	fset := token.NewFileSet()
//	file, err := codegen.ParseFile(fset, "main.go")
//	if err != nil { ... }
//
//	// Add an import if not already present.
//	codegen.AddImport(file, "fmt")
//
//	// Find a function.
//	fn := codegen.FindFunction(file, "main")
//	if fn != nil { ... }
//
//	// Write back.
//	var buf bytes.Buffer
//	codegen.PrintFile(&buf, fset, file)
//	os.WriteFile("main.go", buf.Bytes(), 0644)
package codegen

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"strings"
)

// ──────────────────────────────────────────────
// Parsing & printing
// ──────────────────────────────────────────────

// ParseFile parses a Go source file and returns its AST.
func ParseFile(fset *token.FileSet, filename string) (*ast.File, error) {
	return parser.ParseFile(fset, filename, nil, parser.ParseComments)
}

// ParseFileFromSource parses a Go source string and returns its AST.
func ParseFileFromSource(fset *token.FileSet, filename, src string) (*ast.File, error) {
	return parser.ParseFile(fset, filename, src, parser.ParseComments)
}

// PrintFile writes an AST file to a writer using the given file set.
func PrintFile(w *bytes.Buffer, fset *token.FileSet, file *ast.File) error {
	return printer.Fprint(w, fset, file)
}

// PrintNode writes any AST node to a string.
func PrintNode(fset *token.FileSet, node ast.Node) (string, error) {
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, node); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ──────────────────────────────────────────────
// Import management
// ──────────────────────────────────────────────

// AddImport adds an import path to the file's import block if it is
// not already present. The import is added without an alias.
func AddImport(file *ast.File, importPath string) {
	if HasImport(file, importPath) {
		return
	}
	impStr := fmt.Sprintf("%q", importPath)
	spec := &ast.ImportSpec{
		Path: &ast.BasicLit{Kind: token.STRING, Value: impStr},
	}
	file.Imports = append(file.Imports, spec)
	ast.Inspect(file, func(node ast.Node) bool {
		genDecl, ok := node.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.IMPORT {
			return true
		}
		genDecl.Specs = append(genDecl.Specs, spec)
		return false
	})
}

// AddImportWithAlias adds an import with an alias.
func AddImportWithAlias(file *ast.File, importPath, alias string) {
	if HasImport(file, importPath) {
		return
	}
	impStr := fmt.Sprintf("%q", importPath)
	spec := &ast.ImportSpec{
		Name: &ast.Ident{Name: alias},
		Path: &ast.BasicLit{Kind: token.STRING, Value: impStr},
	}
	file.Imports = append(file.Imports, spec)
	ast.Inspect(file, func(node ast.Node) bool {
		genDecl, ok := node.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.IMPORT {
			return true
		}
		genDecl.Specs = append(genDecl.Specs, spec)
		return false
	})
}

// RemoveImport removes an import path from the file.
// Returns true if the import was found and removed.
func RemoveImport(file *ast.File, importPath string) bool {
	impStr := fmt.Sprintf("%q", importPath)
	removed := false

	// Remove from file.Imports.
	imports := file.Imports[:0]
	for _, imp := range file.Imports {
		if imp.Path.Value == impStr {
			removed = true
			continue
		}
		imports = append(imports, imp)
	}
	file.Imports = imports

	// Remove from GenDecl.Specs.
	ast.Inspect(file, func(node ast.Node) bool {
		genDecl, ok := node.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.IMPORT {
			return true
		}
		specs := genDecl.Specs[:0]
		for _, spec := range genDecl.Specs {
			impSpec, ok := spec.(*ast.ImportSpec)
			if ok && impSpec.Path.Value == impStr {
				continue
			}
			specs = append(specs, spec)
		}
		genDecl.Specs = specs
		return false
	})
	return removed
}

// HasImport checks whether the file imports the given path.
func HasImport(file *ast.File, importPath string) bool {
	for _, imp := range file.Imports {
		path := strings.Trim(imp.Path.Value, `"`)
		if path == importPath {
			return true
		}
	}
	return false
}

// ListImports returns all import paths in the file.
func ListImports(file *ast.File) []string {
	imports := make([]string, 0, len(file.Imports))
	for _, imp := range file.Imports {
		path := strings.Trim(imp.Path.Value, `"`)
		imports = append(imports, path)
	}
	return imports
}

// ──────────────────────────────────────────────
// Function & type lookup
// ──────────────────────────────────────────────

// FindFunction searches the AST for a function declaration with the
// given name. Returns nil if not found.
func FindFunction(node ast.Node, funcName string) *ast.FuncDecl {
	var found *ast.FuncDecl
	ast.Inspect(node, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok {
			return true
		}
		if fn.Name != nil && fn.Name.Name == funcName {
			found = fn
			return false
		}
		return true
	})
	return found
}

// FindTypeDecl searches the AST for a type declaration with the given name.
func FindTypeDecl(node ast.Node, typeName string) *ast.TypeSpec {
	var found *ast.TypeSpec
	ast.Inspect(node, func(n ast.Node) bool {
		genDecl, ok := n.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.TYPE {
			return true
		}
		for _, spec := range genDecl.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if ok && ts.Name != nil && ts.Name.Name == typeName {
				found = ts
				return false
			}
		}
		return true
	})
	return found
}

// FindMethod searches for a method (function with a receiver) by name
// on any receiver type.
func FindMethod(node ast.Node, methodName string) *ast.FuncDecl {
	fn := FindFunction(node, methodName)
	if fn != nil && fn.Recv != nil {
		return fn
	}
	return nil
}

// ListFunctions returns the names of all function declarations in the AST.
func ListFunctions(node ast.Node) []string {
	var names []string
	ast.Inspect(node, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok {
			return true
		}
		if fn.Name != nil {
			names = append(names, fn.Name.Name)
		}
		return true
	})
	return names
}

// ──────────────────────────────────────────────
// Statement creation
// ──────────────────────────────────────────────

// CreateStmt parses a Go expression string and returns it as an
// ExprStmt. The position information is cleared so the statement
// can be inserted anywhere in the AST.
func CreateStmt(expr string) (*ast.ExprStmt, error) {
	e, err := parser.ParseExpr(expr)
	if err != nil {
		return nil, fmt.Errorf("codegen: parse expression %q: %w", expr, err)
	}
	ClearPositions(e)
	return &ast.ExprStmt{X: e}, nil
}

// CreateCallExpr creates a function call expression from a string.
func CreateCallExpr(callStr string) (*ast.CallExpr, error) {
	e, err := parser.ParseExpr(callStr)
	if err != nil {
		return nil, fmt.Errorf("codegen: parse call %q: %w", callStr, err)
	}
	call, ok := e.(*ast.CallExpr)
	if !ok {
		return nil, fmt.Errorf("codegen: %q is not a call expression", callStr)
	}
	ClearPositions(call)
	return call, nil
}

// ──────────────────────────────────────────────
// Block & variable inspection
// ──────────────────────────────────────────────

// IsBlockStmt returns true if the node is a *ast.BlockStmt.
func IsBlockStmt(node ast.Node) bool {
	_, ok := node.(*ast.BlockStmt)
	return ok
}

// VariableExistsInBlock checks whether a variable with the given name
// is assigned within the block.
func VariableExistsInBlock(block *ast.BlockStmt, varName string) bool {
	exists := false
	ast.Inspect(block, func(n ast.Node) bool {
		assign, ok := n.(*ast.AssignStmt)
		if !ok {
			return true
		}
		for _, expr := range assign.Lhs {
			ident, ok := expr.(*ast.Ident)
			if ok && ident.Name == varName {
				exists = true
				return false
			}
		}
		return true
	})
	return exists
}

// FindCompositeLit searches for a composite literal assigned to a
// variable with the given identifier and selector expression type.
// e.g. FindCompositeLit(node, "model", "Menu") matches:
//
//	menus := []model.Menu{...}
func FindCompositeLit(node ast.Node, identName, selectorName string) *ast.CompositeLit {
	var found *ast.CompositeLit
	ast.Inspect(node, func(n ast.Node) bool {
		assign, ok := n.(*ast.AssignStmt)
		if !ok {
			return true
		}
		for _, expr := range assign.Rhs {
			lit, ok := expr.(*ast.CompositeLit)
			if !ok {
				continue
			}
			arrType, ok := lit.Type.(*ast.ArrayType)
			if !ok {
				continue
			}
			sel, ok1 := arrType.Elt.(*ast.SelectorExpr)
			ident, ok2 := sel.X.(*ast.Ident)
			if ok1 && ok2 && ident.Name == identName && sel.Sel.Name == selectorName {
				found = lit
				return false
			}
		}
		return true
	})
	return found
}

// ──────────────────────────────────────────────
// Position clearing
// ──────────────────────────────────────────────

// ClearPositions recursively clears position information from an AST node.
// This is useful when inserting nodes parsed from strings into an
// existing AST, to avoid position conflicts.
func ClearPositions(node ast.Node) {
	ast.Inspect(node, func(n ast.Node) bool {
		switch v := n.(type) {
		case *ast.Ident:
			v.NamePos = token.NoPos
		case *ast.BasicLit:
			v.ValuePos = token.NoPos
		case *ast.CallExpr:
			v.Lparen = token.NoPos
			v.Rparen = token.NoPos
		case *ast.SelectorExpr:
			v.Sel.NamePos = token.NoPos
		case *ast.BinaryExpr:
			v.OpPos = token.NoPos
		case *ast.UnaryExpr:
			v.OpPos = token.NoPos
		case *ast.StarExpr:
			v.Star = token.NoPos
		case *ast.CompositeLit:
			v.Lbrace = token.NoPos
			v.Rbrace = token.NoPos
		case *ast.KeyValueExpr:
			v.Colon = token.NoPos
		}
		return true
	})
}

// ──────────────────────────────────────────────
// Struct literal builders
// ──────────────────────────────────────────────

// KeyValueExpr creates a key-value expression for struct literal fields.
func KeyValueExpr(key string, value ast.Expr) *ast.KeyValueExpr {
	return &ast.KeyValueExpr{
		Key:   &ast.Ident{Name: key},
		Value: value,
	}
}

// StringLit creates a string literal expression.
func StringLit(s string) *ast.BasicLit {
	return &ast.BasicLit{Kind: token.STRING, Value: fmt.Sprintf("%q", s)}
}

// IntLit creates an integer literal expression.
func IntLit(n int) *ast.BasicLit {
	return &ast.BasicLit{Kind: token.INT, Value: fmt.Sprintf("%d", n)}
}

// BoolLit creates a boolean literal expression.
func BoolLit(b bool) *ast.Ident {
	name := "false"
	if b {
		name = "true"
	}
	return &ast.Ident{Name: name}
}

// CompositeLit creates a composite literal with the given type and elements.
func CompositeLit(typ ast.Expr, elts []ast.Expr) *ast.CompositeLit {
	return &ast.CompositeLit{
		Type: typ,
		Elts: elts,
	}
}

// SelectorExpr creates a selector expression (e.g. pkg.Type).
func SelectorExpr(pkg, name string) *ast.SelectorExpr {
	return &ast.SelectorExpr{
		X:   &ast.Ident{Name: pkg},
		Sel: &ast.Ident{Name: name},
	}
}
