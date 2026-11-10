// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// UCloudConfig holds credentials for the UCloud SMS (USMS) provider.
type UCloudConfig struct {
	PublicKey  string // UCloud public key
	PrivateKey string // UCloud private key
	ProjectID  string // UCloud project ID
	Region     string // region (e.g. cn-bj2)
	APIBase    string // API base URL override
}

// UCloudProvider sends SMS via the UCloud USMS API.
type UCloudProvider struct {
	cfg UCloudConfig
}

// NewUCloudProvider builds a UCloudProvider from a ProviderConfig.
// Recognised keys: public_key, private_key, project_id, region, api_base.
func NewUCloudProvider(cfg ProviderConfig) (Provider, error) {
	c := UCloudConfig{
		APIBase: "https://api.ucloud.cn",
	}
	if cfg != nil {
		c.PublicKey = stringFromCfg(cfg, "public_key")
		c.PrivateKey = stringFromCfg(cfg, "private_key")
		c.ProjectID = stringFromCfg(cfg, "project_id")
		c.Region = stringFromCfg(cfg, "region")
		if v := stringFromCfg(cfg, "api_base"); v != "" {
			c.APIBase = v
		}
	}
	if strings.TrimSpace(c.PublicKey) == "" || strings.TrimSpace(c.PrivateKey) == "" {
		return nil, fmt.Errorf("sms: ucloud public_key and private_key are required")
	}
	if strings.TrimSpace(c.ProjectID) == "" {
		return nil, fmt.Errorf("sms: ucloud project_id is required")
	}
	if strings.TrimSpace(c.Region) == "" {
		return nil, fmt.Errorf("sms: ucloud region is required")
	}
	return &UCloudProvider{cfg: c}, nil
}

// Kind returns ProviderUCloud.
func (p *UCloudProvider) Kind() ProviderKind { return ProviderUCloud }

// ucloudResponse is the UCloud USMS API response.
type ucloudResponse struct {
	Action    string `json:"Action"`
	RetCode   int    `json:"RetCode"`
	Message   string `json:"Message"`
	SessionNo string `json:"SessionNo"`
}

// Send delivers the request via the UCloud USMS API.
func (p *UCloudProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}

	tpl := strings.TrimSpace(req.Message.Template)
	if tpl == "" {
		return nil, fmt.Errorf("sms: ucloud requires templateId")
	}

	params := map[string]any{
		"Action":    "SendUSMSMessage",
		"PublicKey": strings.TrimSpace(p.cfg.PublicKey),
		"ProjectId": strings.TrimSpace(p.cfg.ProjectID),
		"Region":    strings.TrimSpace(p.cfg.Region),
	}
	for i, to := range req.To {
		params[fmt.Sprintf("PhoneNumbers.%d", i)] = strings.TrimSpace(to.String())
	}
	params["TemplateId"] = tpl
	if len(req.Message.Data) > 0 {
		var ordered []string
		if req.Extras != nil {
			if arr, ok := req.Extras["templateParamOrder"]; ok {
				b, _ := json.Marshal(arr)
				_ = json.Unmarshal(b, &ordered)
			}
		}
		if len(ordered) == 0 {
			keys := make([]string, 0, len(req.Message.Data))
			for k := range req.Message.Data {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			ordered = keys
		}
		for i, k := range ordered {
			params[fmt.Sprintf("TemplateParams.%d", i)] = strings.TrimSpace(req.Message.Data[k])
		}
	}
	sig := strings.TrimSpace(req.Message.SignName)
	if sig != "" {
		params["SigContent"] = sig
	}

	signStr := ucloudSignString(params, strings.TrimSpace(p.cfg.PrivateKey))
	params["Signature"] = SHA1Hex(signStr)

	base := strings.TrimSpace(p.cfg.APIBase)
	if base == "" {
		base = "https://api.ucloud.cn"
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("sms: ucloud invalid api_base: %w", err)
	}
	q := u.Query()
	for k, v := range ucloudFlattenParams(params) {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	status, body, err := GetURLRaw(ctx, u.String(), nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r ucloudResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.RetCode != 0 {
		msg := strings.TrimSpace(r.Message)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{
			Provider:   p.Kind(),
			Accepted:   false,
			Status:     strconv.Itoa(r.RetCode),
			Error:      msg,
			Raw:        raw,
			SentAtUnix: NowUnix(),
		}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.SessionNo), Accepted: true, Status: "0", Raw: raw, SentAtUnix: NowUnix()}, nil
}

// ucloudSignString builds the string to sign for UCloud API authentication.
func ucloudSignString(params map[string]any, privateKey string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "Signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		sb.WriteString(k)
		sb.WriteString(ucloudEncodeValue(params[k]))
	}
	sb.WriteString(privateKey)
	return sb.String()
}

// ucloudEncodeValue converts a value to its string representation for signing.
func ucloudEncodeValue(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case uint64:
		return strconv.FormatUint(t, 10)
	case map[string]string:
		b, _ := json.Marshal(t)
		return string(b)
	case map[string]any:
		b, _ := json.Marshal(t)
		return string(b)
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

// ucloudFlattenParams turns nested maps/slices into UCloud-style dotted keys.
func ucloudFlattenParams(params map[string]any) map[string]string {
	out := map[string]string{}
	for k, v := range params {
		if k == "Signature" {
			continue
		}
		ucloudFlattenKey("", k, v, out)
	}
	return out
}

func ucloudFlattenKey(prefix, key string, v any, out map[string]string) {
	full := key
	if prefix != "" {
		full = prefix + "." + key
	}
	switch t := v.(type) {
	case nil:
		return
	case map[string]any:
		for ck, cv := range t {
			ucloudFlattenKey(full, ck, cv, out)
		}
	case map[string]string:
		for ck, cv := range t {
			ucloudFlattenKey(full, ck, cv, out)
		}
	case []any:
		for i, item := range t {
			ucloudFlattenKey(full, strconv.Itoa(i), item, out)
		}
	case []string:
		for i, item := range t {
			ucloudFlattenKey(full, strconv.Itoa(i), item, out)
		}
	default:
		out[full] = ucloudEncodeValue(t)
	}
}
