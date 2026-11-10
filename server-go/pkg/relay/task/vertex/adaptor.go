package vertex

import (
	"context"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/relay/task/taskmodel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/task/gemini"
	"github.com/heathcetide/DietDigiDose/pkg/relay/task/taskcommon"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	vertex2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/vertex"

	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
)

// ============================
// Request / Response structures
// ============================

type fetchOperationPayload struct {
	OperationName string `json:"operationName"`
}

type submitResponse struct {
	Name string `json:"name"`
}

type operationVideo struct {
	MimeType           string `json:"mimeType"`
	BytesBase64Encoded string `json:"bytesBase64Encoded"`
	Encoding           string `json:"encoding"`
}

type operationResponse struct {
	Name     string `json:"name"`
	Done     bool   `json:"done"`
	Response struct {
		Type                  string           `json:"@type"`
		RaiMediaFilteredCount int              `json:"raiMediaFilteredCount"`
		Videos                []operationVideo `json:"videos"`
		BytesBase64Encoded    string           `json:"bytesBase64Encoded"`
		Encoding              string           `json:"encoding"`
		Video                 string           `json:"video"`
	} `json:"response"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *common.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// ValidateRequestAndSetAction parses body, validates fields and sets default action.
func (a *TaskAdaptor) ValidateRequestAndSetAction(c context.Context, info *common.RelayInfo) (taskErr *common.TaskError) {
	// Use the standard validation method for TaskSubmitReq
	return common.ValidateBasicTaskRequest(c, info, constant.TaskActionTextGenerate)
}

// BuildRequestURL constructs the upstream URL.
func (a *TaskAdaptor) BuildRequestURL(info *common.RelayInfo) (string, error) {
	adc := &vertex2.Credentials{}
	if err := json.Unmarshal([]byte(a.apiKey), adc); err != nil {
		return "", fmt.Errorf("failed to decode credentials: %w", err)
	}
	modelName := info.UpstreamModelName
	if modelName == "" {
		modelName = "veo-3.0-generate-001"
	}

	region := vertex2.GetModelRegion(info.ApiVersion, modelName)
	if strings.TrimSpace(region) == "" {
		region = "global"
	}
	return vertex2.BuildGoogleModelURL(a.baseURL, vertex2.DefaultAPIVersion, adc.ProjectID, region, modelName, "predictLongRunning"), nil
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(c context.Context, req *http.Request, info *common.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	adc := &vertex2.Credentials{}
	if err := json.Unmarshal([]byte(a.apiKey), adc); err != nil {
		return fmt.Errorf("failed to decode credentials: %w", err)
	}

	proxy := ""
	// Not supported in library mode
	// if info != nil {
	// 	proxy = info.ChannelSetting.Proxy
	// }
	token, err := vertex2.AcquireAccessToken(*adc, proxy)
	if err != nil {
		return fmt.Errorf("failed to acquire access token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-goog-user-project", adc.ProjectID)
	return nil
}

// EstimateBilling returns OtherRatios based on durationSeconds and resolution.
func (a *TaskAdaptor) EstimateBilling(c context.Context, info *common.RelayInfo) map[string]float64 {
	// Not supported in library mode
	return nil
}

// BuildRequestBody converts request into Vertex specific format.
func (a *TaskAdaptor) BuildRequestBody(c context.Context, info *common.RelayInfo) (io.Reader, error) {
	v, ok := common.CtxGet(c, "task_request")
	if !ok {
		return nil, fmt.Errorf("request not found in context")
	}
	req, ok := v.(common.TaskSubmitReq)
	if !ok {
		return nil, fmt.Errorf("invalid request type in context")
	}

	instance := gemini.VeoInstance{Prompt: req.Prompt}
	if img := gemini.ExtractMultipartImage(c, info); img != nil {
		instance.Image = img
	} else if len(req.Images) > 0 {
		if parsed := gemini.ParseImageInput(req.Images[0]); parsed != nil {
			instance.Image = parsed
			info.Action = constant.TaskActionGenerate
		}
	}

	params := &gemini.VeoParameters{}
	if err := taskcommon.UnmarshalMetadata(req.Metadata, params); err != nil {
		return nil, fmt.Errorf("unmarshal metadata failed: %w", err)
	}
	if params.DurationSeconds == 0 && req.Duration > 0 {
		params.DurationSeconds = req.Duration
	}
	if params.Resolution == "" && req.Size != "" {
		params.Resolution = gemini.SizeToVeoResolution(req.Size)
	}
	if params.AspectRatio == "" && req.Size != "" {
		params.AspectRatio = gemini.SizeToVeoAspectRatio(req.Size)
	}
	params.Resolution = strings.ToLower(params.Resolution)
	params.SampleCount = 1

	body := gemini.VeoRequestPayload{
		Instances:  []gemini.VeoInstance{instance},
		Parameters: params,
	}

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response, returns taskID etc.
func (a *TaskAdaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo) (taskID string, taskData []byte, taskErr *common.TaskError) {
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}

	var s submitResponse
	if err := json.Unmarshal(responseBody, &s); err != nil {
		return "", nil, service.TaskErrorWrapper(err, "unmarshal_response_failed", http.StatusInternalServerError)
	}
	if strings.TrimSpace(s.Name) == "" {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("missing operation name"), "invalid_response", http.StatusInternalServerError)
	}
	localID := taskcommon.EncodeLocalTaskID(s.Name)
	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	// Not supported in library mode
	// c.JSON(http.StatusOK, ov)
	return localID, responseBody, nil
}

func (a *TaskAdaptor) GetModelList() []string {
	return []string{
		"veo-3.0-generate-001",
		"veo-3.0-fast-generate-001",
		"veo-3.1-generate-preview",
		"veo-3.1-fast-generate-preview",
	}
}
func (a *TaskAdaptor) GetChannelName() string { return "vertex" }

func buildFetchOperationURL(baseURL, upstreamName string) (string, error) {
	region := extractRegionFromOperationName(upstreamName)
	if region == "" {
		region = "us-central1"
	}
	project := extractProjectFromOperationName(upstreamName)
	modelName := extractModelFromOperationName(upstreamName)
	if strings.TrimSpace(modelName) == "" {
		return "", fmt.Errorf("cannot extract model from operation name")
	}
	if strings.TrimSpace(project) == "" {
		return "", fmt.Errorf("cannot extract project from operation name")
	}
	return vertex2.BuildGoogleModelURL(baseURL, vertex2.DefaultAPIVersion, project, region, modelName, "fetchPredictOperation"), nil
}

// FetchTask fetch task status
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	upstreamName, err := taskcommon.DecodeLocalTaskID(taskID)
	if err != nil {
		return nil, fmt.Errorf("decode task_id failed: %w", err)
	}
	url, err := buildFetchOperationURL(baseUrl, upstreamName)
	if err != nil {
		return nil, err
	}
	payload := fetchOperationPayload{OperationName: upstreamName}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	adc := &vertex2.Credentials{}
	if err := json.Unmarshal([]byte(key), adc); err != nil {
		return nil, fmt.Errorf("failed to decode credentials: %w", err)
	}
	token, err := vertex2.AcquireAccessToken(*adc, proxy)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire access token: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-goog-user-project", adc.ProjectID)
	// Not supported in library mode (proxy ignored)
	return http.DefaultClient.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*common.TaskInfo, error) {
	var op operationResponse
	if err := json.Unmarshal(respBody, &op); err != nil {
		return nil, fmt.Errorf("unmarshal operation response failed: %w", err)
	}
	ti := &common.TaskInfo{}
	if op.Error.Message != "" {
		ti.Status = taskmodel.TaskStatusFailure
		ti.Reason = op.Error.Message
		ti.Progress = "100%"
		return ti, nil
	}
	if !op.Done {
		ti.Status = taskmodel.TaskStatusInProgress
		ti.Progress = "50%"
		return ti, nil
	}
	ti.Status = taskmodel.TaskStatusSuccess
	ti.Progress = "100%"
	if len(op.Response.Videos) > 0 {
		v0 := op.Response.Videos[0]
		if v0.BytesBase64Encoded != "" {
			mime := strings.TrimSpace(v0.MimeType)
			if mime == "" {
				enc := strings.TrimSpace(v0.Encoding)
				if enc == "" {
					enc = "mp4"
				}
				if strings.Contains(enc, "/") {
					mime = enc
				} else {
					mime = "video/" + enc
				}
			}
			ti.Url = "data:" + mime + ";base64," + v0.BytesBase64Encoded
			return ti, nil
		}
	}
	if op.Response.BytesBase64Encoded != "" {
		enc := strings.TrimSpace(op.Response.Encoding)
		if enc == "" {
			enc = "mp4"
		}
		mime := enc
		if !strings.Contains(enc, "/") {
			mime = "video/" + enc
		}
		ti.Url = "data:" + mime + ";base64," + op.Response.BytesBase64Encoded
		return ti, nil
	}
	if op.Response.Video != "" { // some variants use `video` as base64
		enc := strings.TrimSpace(op.Response.Encoding)
		if enc == "" {
			enc = "mp4"
		}
		mime := enc
		if !strings.Contains(enc, "/") {
			mime = "video/" + enc
		}
		ti.Url = "data:" + mime + ";base64," + op.Response.Video
		return ti, nil
	}
	return ti, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *taskmodel.Task) ([]byte, error) {
	// Use GetUpstreamTaskID() to get the real upstream operation name for model extraction.
	// task.TaskID is now a public task_xxxx ID, no longer a base64-encoded upstream name.
	upstreamTaskID := task.GetUpstreamTaskID()
	upstreamName, err := taskcommon.DecodeLocalTaskID(upstreamTaskID)
	if err != nil {
		upstreamName = ""
	}
	modelName := extractModelFromOperationName(upstreamName)
	if strings.TrimSpace(modelName) == "" {
		modelName = "veo-3.0-generate-001"
	}
	v := dto.NewOpenAIVideo()
	v.ID = task.TaskID
	v.Model = modelName
	v.Status = task.Status.ToVideoStatus()
	v.SetProgressStr(task.Progress)
	v.CreatedAt = task.CreatedAt
	v.CompletedAt = task.UpdatedAt
	if resultURL := task.GetResultURL(); strings.HasPrefix(resultURL, "data:") && len(resultURL) > 0 {
		v.SetMetadata("url", resultURL)
	}

	return json.Marshal(v)
}

// ============================
// helpers
// ============================

var regionRe = regexp.MustCompile(`locations/([a-z0-9-]+)/`)

func extractRegionFromOperationName(name string) string {
	m := regionRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}

var modelRe = regexp.MustCompile(`models/([^/]+)/operations/`)

func extractModelFromOperationName(name string) string {
	m := modelRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	idx := strings.Index(name, "models/")
	if idx >= 0 {
		s := name[idx+len("models/"):]
		if p := strings.Index(s, "/operations/"); p > 0 {
			return s[:p]
		}
	}
	return ""
}

var projectRe = regexp.MustCompile(`projects/([^/]+)/locations/`)

func extractProjectFromOperationName(name string) string {
	m := projectRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}
