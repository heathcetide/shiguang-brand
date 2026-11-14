package suno

import (
	"context"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/heathcetide/DietDigiDose/pkg/relay/task/taskcommon"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
)

// sunoSubmitResponse mirrors the upstream Suno submit response shape
// (Code is an int, 200 means success) used by the library-mode client.
type sunoSubmitResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
	Data    string `json:"data,omitempty"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
}

// ParseTaskResult is not used for Suno tasks.
// Suno polling uses a dedicated batch-fetch path (service.UpdateSunoTasks) that
// receives dto.TaskResponse[[]dto.SunoDataResponse] from the upstream /fetch API.
// This differs from the per-task polling used by video adaptors.
func (a *TaskAdaptor) ParseTaskResult([]byte) (*common.TaskInfo, error) {
	return nil, fmt.Errorf("suno uses batch polling via UpdateSunoTasks, ParseTaskResult is not applicable")
}

func (a *TaskAdaptor) Init(info *common.RelayInfo) {
	a.ChannelType = info.ChannelType
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c context.Context, info *common.RelayInfo) (taskErr *common.TaskError) {
	if info.Action == "" {
		return service.TaskErrorWrapper(fmt.Errorf("action is required"), "invalid_action", http.StatusBadRequest)
	}
	action := strings.ToUpper(info.Action)
	switch action {
	case "MUSIC":
		// defaults (e.g. Mv="chirp-v3-0") are handled by the caller via Client.SubmitSunoTask
	case "LYRICS":
		// caller must provide a non-empty prompt via Client.SubmitSunoTask
	default:
		return service.TaskErrorWrapper(fmt.Errorf("invalid action: %s", action), "invalid_action", http.StatusBadRequest)
	}
	info.Action = action
	return nil
}

func (a *TaskAdaptor) BuildRequestURL(info *common.RelayInfo) (string, error) {
	baseURL := info.ChannelBaseUrl
	fullRequestURL := fmt.Sprintf("%s%s", baseURL, "/suno/submit/"+info.Action)
	return fullRequestURL, nil
}

func (a *TaskAdaptor) BuildRequestHeader(c context.Context, req *http.Request, info *common.RelayInfo) error {
	req.Header.Set("Content-Type", info.RequestHeaders["Content-Type"])
	req.Header.Set("Accept", info.RequestHeaders["Accept"])
	req.Header.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c context.Context, info *common.RelayInfo) (io.Reader, error) {
	// In library mode, the request body is provided by the caller via Client.SubmitTask.
	return nil, nil
}

func (a *TaskAdaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo) (taskID string, taskData []byte, taskErr *common.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	var sunoResponse sunoSubmitResponse
	err = json.Unmarshal(responseBody, &sunoResponse)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	if sunoResponse.Code != 200 {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("suno error: %s", sunoResponse.Message), "suno_error", http.StatusBadRequest)
		return
	}
	return sunoResponse.Data, responseBody, nil
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	requestUrl := fmt.Sprintf("%s/suno/fetch", baseUrl)
	byteBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", requestUrl, bytes.NewBuffer(byteBody))
	if err != nil {
		// Not supported in library mode
		// common.SysLog(fmt.Sprintf("Get Task error: %v", err))
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	// Not supported in library mode (proxy ignored)
	return http.DefaultClient.Do(req)
}

func actionValidate(c context.Context, sunoRequest interface{}, action string) (err error) {
	// Not supported in library mode
	// switch action {
	// case constant.SunoActionMusic:
	// 	if sunoRequest.Mv == "" {
	// 		sunoRequest.Mv = "chirp-v3-0"
	// 	}
	// case constant.SunoActionLyrics:
	// 	if sunoRequest.Prompt == "" {
	// 		err = fmt.Errorf("prompt_empty")
	// 		return
	// 	}
	// default:
	// 	err = fmt.Errorf("invalid_action")
	// }
	return
}
