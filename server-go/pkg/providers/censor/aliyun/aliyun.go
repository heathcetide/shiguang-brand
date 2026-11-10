// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package aliyun provides Alibaba Cloud Green content moderation implementations
// for text, image, audio, and video. It depends only on the Aliyun Green SDK.
package aliyun

import (
	"fmt"

	"github.com/alibabacloud-go/darabonba-openapi/v2/client"
	green "github.com/alibabacloud-go/green-20220302/v2/client"
	"github.com/alibabacloud-go/tea/tea"
)

const defaultEndpoint = "green-cip.cn-shanghai.aliyuncs.com"

// Config holds Alibaba Cloud Green content moderation credentials.
type Config struct {
	AccessKeyID     string
	AccessKeySecret string
	Endpoint        string // defaults to green-cip.cn-shanghai.aliyuncs.com if empty
}

// newClient builds the Aliyun Green client from the config.
func newClient(cfg Config) (*green.Client, error) {
	if cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("aliyun requires AccessKeyID and AccessKeySecret")
	}
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	c := &client.Config{
		AccessKeyId:     tea.String(cfg.AccessKeyID),
		AccessKeySecret: tea.String(cfg.AccessKeySecret),
		Endpoint:        tea.String(endpoint),
	}
	greenClient, err := green.NewClient(c)
	if err != nil {
		return nil, fmt.Errorf("failed to create Green client: %w", err)
	}
	return greenClient, nil
}
