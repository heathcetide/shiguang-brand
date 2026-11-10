// Copyright (c) 2026 heathcetide. All rights reserved.

package appapi

import (
	"database/sql"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/ai"
	"github.com/heathcetide/DietDigiDose/internal/domains/admin"
	"github.com/heathcetide/DietDigiDose/internal/domains/auth"
	"github.com/heathcetide/DietDigiDose/internal/domains/catalog"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/domains/lifestyle"
	"github.com/heathcetide/DietDigiDose/internal/domains/ops"
	"github.com/heathcetide/DietDigiDose/internal/domains/sitesettings"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
)

// Deps holds shared runtime dependencies for migrated Express APIs.
type Deps struct {
	DB   *sql.DB
	Auth *expressauth.Auth
}

// Register mounts all Go-owned Express-compatible routes.
// With upstream.express empty (default), unmatched routes return 404.
func Register(engine *gin.Engine, deps Deps) {
	authHandlers := &auth.Handlers{
		Service: &auth.Service{DB: deps.DB, Auth: deps.Auth},
		Auth:    deps.Auth,
	}
	authHandlers.RegisterOn(engine)

	(&sitesettings.Handlers{DB: deps.DB}).RegisterOn(engine)
	(&ops.Handlers{DB: deps.DB, Auth: deps.Auth}).RegisterOn(engine)
	(&admin.Handlers{DB: deps.DB, Auth: deps.Auth}).RegisterOn(engine)

	inventoryService := &inventory.Service{DB: deps.DB}
	(&inventory.Handlers{
		Service: inventoryService,
		Auth:    deps.Auth,
	}).RegisterOn(engine)

	(&catalog.Handlers{DB: deps.DB, Auth: deps.Auth}).RegisterOn(engine)
	(&lifestyle.Handlers{DB: deps.DB, Auth: deps.Auth, Inventory: inventoryService}).RegisterOn(engine)
	(&ai.Handlers{DB: deps.DB, Auth: deps.Auth}).RegisterOn(engine)
	(&social.Handlers{DB: deps.DB, Auth: deps.Auth}).RegisterOn(engine)
}
