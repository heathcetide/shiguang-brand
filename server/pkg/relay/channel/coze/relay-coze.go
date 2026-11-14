package coze

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/helper"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/samber/lo"
	"go.uber.org/zap"
)

func convertCozeChatRequest(c context.Context, request dto.GeneralOpenAIRequest) *CozeChatRequest {
	var messages []CozeEnterMessage
	// 将 request的messages的role为user的content转换为CozeMessage
	for _, message := range request.Messages {
		if message.Role == "user" {
			messages = append(messages, CozeEnterMessage{
				Role:    "user",
				Content: message.Content,
				// Currently only text content type is supported; image/audio/video support can be added here
				ContentType: "text",
			})
		}
	}
	user := request.User
	if len(user) == 0 {
		user = json.RawMessage(helper.GetResponseID(""))
	}
	cozeRequest := &CozeChatRequest{
		BotId:              "",
		UserId:             user,
		AdditionalMessages: messages,
		Stream:             lo.FromPtrOr(request.Stream, false),
	}
	return cozeRequest
}

func cozeChatHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	resp.Body.Close()
	// convert coze response to openai response
	var response dto.TextResponse
	var cozeResponse CozeChatDetailResponse
	response.Model = info.UpstreamModelName
	err = json.Unmarshal(responseBody, &cozeResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	if cozeResponse.Code != 0 {
		return nil, types.NewError(errors.New(cozeResponse.Msg), types.ErrorCodeBadResponseBody)
	}
	// 从上下文获取 usage
	var usage dto.Usage
	usage.PromptTokens = 0
	usage.CompletionTokens = 0
	usage.TotalTokens = 0
	response.Usage = usage
	response.Id = helper.GetResponseID("")

	var responseContent json.RawMessage
	for _, data := range cozeResponse.Data {
		if data.Type == "answer" {
			responseContent = data.Content
			response.Created = data.CreatedAt
		}
	}
	// 添加 response.Choices
	response.Choices = []dto.OpenAITextResponseChoice{
		{
			Index:        0,
			Message:      dto.Message{Role: "assistant", Content: responseContent},
			FinishReason: "stop",
		},
	}
	jsonResponse, err := json.Marshal(response)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err := w.Write(jsonResponse); err != nil {
		logger.Warn("error writing coze response", zap.String("error", err.Error()))
	}

	return &usage, nil
}

func cozeChatStreamHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	scanner := bufio.NewScanner(resp.Body)
	scanner.Split(bufio.ScanLines)
	helper.SetEventStreamHeaders(w)
	id := helper.GetResponseID("")
	var responseText string

	var currentEvent string
	var currentData string
	var usage = &dto.Usage{}

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			if currentEvent != "" && currentData != "" {
				// handle last event
				handleCozeEvent(c, currentEvent, currentData, &responseText, usage, id, info, w)
				currentEvent = ""
				currentData = ""
			}
			continue
		}

		if strings.HasPrefix(line, "event:") {
			currentEvent = strings.TrimSpace(line[6:])
			continue
		}

		if strings.HasPrefix(line, "data:") {
			currentData = strings.TrimSpace(line[5:])
			continue
		}
	}

	// Last event
	if currentEvent != "" && currentData != "" {
		handleCozeEvent(c, currentEvent, currentData, &responseText, usage, id, info, w)
	}

	if err := scanner.Err(); err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	helper.Done(w)

	if usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(responseText, info.UpstreamModelName, 0)
	}

	return usage, nil
}

func handleCozeEvent(c context.Context, event string, data string, responseText *string, usage *dto.Usage, id string, info *common.RelayInfo, w http.ResponseWriter) {
	switch event {
	case "conversation.chat.completed":
		// 将 data 解析为 CozeChatResponseData
		var chatData CozeChatResponseData
		err := json.Unmarshal([]byte(data), &chatData)
		if err != nil {
			logger.Warn("error_unmarshalling_stream_response", zap.String("error", err.Error()))
			return
		}

		usage.PromptTokens = chatData.Usage.InputCount
		usage.CompletionTokens = chatData.Usage.OutputCount
		usage.TotalTokens = chatData.Usage.TokenCount

		finishReason := "stop"
		_ = finishReason
		stopResponse := helper.GenerateStopResponse(id, time.Now().Unix(), info.UpstreamModelName, nil)
		helper.ObjectData(w, stopResponse)

	case "conversation.message.delta":
		// 将 data 解析为 CozeChatV3MessageDetail
		var messageData CozeChatV3MessageDetail
		err := json.Unmarshal([]byte(data), &messageData)
		if err != nil {
			logger.Warn("error_unmarshalling_stream_response", zap.String("error", err.Error()))
			return
		}

		var content string
		err = json.Unmarshal(messageData.Content, &content)
		if err != nil {
			logger.Warn("error_unmarshalling_stream_response", zap.String("error", err.Error()))
			return
		}

		*responseText += content

		openaiResponse := dto.ChatCompletionsStreamResponse{
			Id:      id,
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   info.UpstreamModelName,
		}

		choice := dto.ChatCompletionsStreamResponseChoice{
			Index: 0,
		}
		choice.Delta.SetContentString(content)
		openaiResponse.Choices = append(openaiResponse.Choices, choice)

		helper.ObjectData(w, openaiResponse)

	case "error":
		var errorData CozeError
		err := json.Unmarshal([]byte(data), &errorData)
		if err != nil {
			logger.Warn("error_unmarshalling_stream_response", zap.String("error", err.Error()))
			return
		}

		logger.Warn("stream event error", zap.Any("code", errorData.Code), zap.Any("message", errorData.Message))
	}
}

func checkIfChatComplete(a *Adaptor, c context.Context, info *common.RelayInfo) (error, bool) {
	requestURL := fmt.Sprintf("%s/v3/chat/retrieve", info.ChannelBaseUrl)

	requestURL = requestURL + "?conversation_id=" + "" + "&chat_id=" + ""
	// 将 conversationId和chatId作为参数发送get请求
	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return err, false
	}
	err = a.SetupRequestHeader(c, &req.Header, info)
	if err != nil {
		return err, false
	}

	resp, err := doRequest(req, info) // 调用 doRequest
	if err != nil {
		return err, false
	}
	if resp == nil { // 确保在 doRequest 失败时 resp 不为 nil 导致 panic
		return fmt.Errorf("resp is nil"), false
	}
	defer resp.Body.Close() // 确保响应体被关闭

	// 解析 resp 到 CozeChatResponse
	var cozeResponse CozeChatResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body failed: %w", err), false
	}
	err = json.Unmarshal(responseBody, &cozeResponse)
	if err != nil {
		return fmt.Errorf("unmarshal response body failed: %w", err), false
	}
	if cozeResponse.Data.Status == "completed" {
		// 在上下文设置 usage
		// c.Set("coze_token_count", cozeResponse.Data.Usage.TokenCount)
		// c.Set("coze_output_count", cozeResponse.Data.Usage.OutputCount)
		// c.Set("coze_input_count", cozeResponse.Data.Usage.InputCount)
		return nil, true
	} else if cozeResponse.Data.Status == "failed" || cozeResponse.Data.Status == "canceled" || cozeResponse.Data.Status == "requires_action" {
		return fmt.Errorf("chat status: %s", cozeResponse.Data.Status), false
	} else {
		return nil, false
	}
}

func getChatDetail(a *Adaptor, c context.Context, info *common.RelayInfo) (*http.Response, error) {
	requestURL := fmt.Sprintf("%s/v3/chat/message/list", info.ChannelBaseUrl)

	requestURL = requestURL + "?conversation_id=" + "" + "&chat_id=" + ""
	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}
	err = a.SetupRequestHeader(c, &req.Header, info)
	if err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}
	resp, err := doRequest(req, info)
	if err != nil {
		return nil, fmt.Errorf("do request failed: %w", err)
	}
	return resp, nil
}

func doRequest(req *http.Request, info *common.RelayInfo) (*http.Response, error) {
	client := http.DefaultClient
	resp, err := client.Do(req)
	if err != nil { // 增加对 client.Do(req) 返回错误的检查
		return nil, fmt.Errorf("client.Do failed: %w", err)
	}
	// _ = resp.Body.Close()
	return resp, nil
}
