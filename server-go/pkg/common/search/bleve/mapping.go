// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bleve

import (
	"github.com/blevesearch/bleve/v2/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/v2/analysis/analyzer/standard"
	"github.com/blevesearch/bleve/v2/mapping"
)

// BuildIndexMapping creates a default Bleve index mapping with common
// field mappings for text, keyword, numeric, and datetime fields.
func BuildIndexMapping(defaultAnalyzer string) *mapping.IndexMappingImpl {
	if defaultAnalyzer == "" {
		defaultAnalyzer = standard.Name
	}
	idx := mapping.NewIndexMapping()
	if idx == nil {
		panic("failed to create index mapping")
	}
	idx.DefaultAnalyzer = defaultAnalyzer
	idx.TypeField = "type"

	text := mapping.NewTextFieldMapping()
	text.Store = true
	text.Index = true
	text.Analyzer = defaultAnalyzer
	text.IncludeInAll = true
	text.IncludeTermVectors = true

	kw := mapping.NewTextFieldMapping()
	kw.Store = true
	kw.Index = true
	kw.Analyzer = keyword.Name

	num := mapping.NewNumericFieldMapping()
	num.Store = true
	num.Index = true
	dt := mapping.NewDateTimeFieldMapping()
	dt.Store = true
	dt.Index = true

	article := mapping.NewDocumentMapping()
	article.Dynamic = false
	article.AddFieldMappingsAt("title", text)
	article.AddFieldMappingsAt("body", text)
	article.AddFieldMappingsAt("tags", kw)
	article.AddFieldMappingsAt("author", kw)
	article.AddFieldMappingsAt("createdAt", dt)
	article.AddFieldMappingsAt("views", num)
	idx.AddDocumentMapping("article", article)

	def := mapping.NewDocumentMapping()
	def.Dynamic = true
	def.AddFieldMappingsAt("userId", kw)
	def.AddFieldMappingsAt("type", kw)
	def.AddFieldMappingsAt("title", text)
	def.AddFieldMappingsAt("description", text)
	def.AddFieldMappingsAt("content", text)
	def.AddFieldMappingsAt("url", kw)
	def.AddFieldMappingsAt("icon", kw)
	def.AddFieldMappingsAt("category", kw)
	idx.DefaultMapping = def
	return idx
}
