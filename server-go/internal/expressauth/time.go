// Copyright (c) 2026 heathcetide. All rights reserved.

package expressauth

import "time"

func jwtExpiry() time.Time {
	return time.Now().UTC().Add(30 * 24 * time.Hour)
}
