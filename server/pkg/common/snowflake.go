// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/idgen"
)

// SnowflakeUtil is the package-level snowflake generator, initialised on load.
// Deprecated: use idgen.SnowflakeNext / idgen.SnowflakeNextUint directly.
var SnowflakeUtil = (*idgen.Snowflake)(nil)

// NewSnowflake creates a snowflake generator using MACHINE_ID env var.
// Deprecated: use idgen.NewSnowflake.
func NewSnowflake() (*idgen.Snowflake, error) {
	return idgen.NewSnowflake()
}

// NextSnowflakeUint returns a snowflake id safe for uint + signed INTEGER stores.
// Deprecated: use idgen.SnowflakeNextUint.
func NextSnowflakeUint() uint {
	return idgen.SnowflakeNextUint()
}

// ClampSnowflakeUint clears the sign bit so IDs remain scannable from signed INTEGER columns.
// Deprecated: use idgen.ClampSnowflakeUint.
func ClampSnowflakeUint(id uint) uint {
	return idgen.ClampSnowflakeUint(id)
}
