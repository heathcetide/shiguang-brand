// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

func (h *Handlers) householdMember(householdID, userID int) (memberID int, role string, ok bool) {
	err := h.DB.QueryRow(`SELECT id, COALESCE(role,'member') FROM household_members WHERE household_id=? AND user_id=?`,
		householdID, userID).Scan(&memberID, &role)
	return memberID, role, err == nil
}

func (h *Handlers) insertHousehold(tx *dbx.Tx, name string, userID int, inviteCode string) (int64, error) {
	return tx.InsertID(`INSERT INTO households (name, invite_code, owner_id, owner_user_id) VALUES (?, ?, ?, ?)`, name, inviteCode, userID, userID)
}
