-- Base-table indexes only (columns present in CREATE TABLE migrations).
-- Indexes on additive columns are created in bootstrap after ALTER TABLE adds them.
CREATE INDEX IF NOT EXISTS idx_ingredients_library_name ON ingredients_library(name);
CREATE INDEX IF NOT EXISTS idx_ingredients_library_barcode ON ingredients_library(barcode);
CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
CREATE INDEX IF NOT EXISTS idx_kitchenware_catalog_name ON kitchenware_catalog(name);
