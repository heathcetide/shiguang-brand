// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package qcloud provides Tencent Cloud content moderation implementations
// for text, image, audio, and video. It depends only on the Tencent Cloud SDK.
package qcloud

import (
	"fmt"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
)

const defaultRegion = "ap-guangzhou"

// Config holds Tencent Cloud content moderation credentials.
type Config struct {
	SecretID  string
	SecretKey string
	Region    string // defaults to ap-guangzhou if empty
	BizType   string // defaults to "default" if empty
}

// newCredential builds the Tencent Cloud credential from the config.
func newCredential(cfg Config) (*common.Credential, error) {
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("qcloud requires SecretID and SecretKey")
	}
	return common.NewCredential(cfg.SecretID, cfg.SecretKey), nil
}

// newProfile builds a client profile with the given endpoint.
func newProfile(endpoint string) *profile.ClientProfile {
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = endpoint
	return cpf
}

// resolveRegion returns cfg.Region or the default.
func resolveRegion(region string) string {
	if region == "" {
		return defaultRegion
	}
	return region
}

// resolveBizType returns cfg.BizType or "default".
func resolveBizType(biz string) string {
	if biz == "" {
		return "default"
	}
	return biz
}
