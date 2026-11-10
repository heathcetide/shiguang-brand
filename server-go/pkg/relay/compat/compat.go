// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package compat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

// ─── Role ─────────────────────────────────────────────────────────────────

// Role represents the role of a message author.
type Role string

// Role constants for message authors.
const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// String returns the string representation of the role.
func (r Role) String() string { return string(r) }

// IsValid checks if the role is one of the defined constants.
func (r Role) IsValid() bool {
	switch r {
	case RoleSystem, RoleUser, RoleAssistant, RoleTool:
		return true
	default:
		return false
	}
}

// ─── Content types ────────────────────────────────────────────────────────

// ContentType represents the type of content.
type ContentType string

// ContentType constants for content types.
const (
	ContentTypeText  ContentType = "text"
	ContentTypeImage ContentType = "image"
	ContentTypeAudio ContentType = "audio"
	ContentTypeVideo ContentType = "video"
	ContentTypeFile  ContentType = "file"
)

// ─── Multimodal content ───────────────────────────────────────────────────

// Image represents an image data for vision models.
type Image struct {
	URL    string `json:"url"`
	Data   []byte `json:"data"`
	Detail string `json:"detail,omitempty"`
	Format string `json:"format,omitempty"`
}

// Audio represents audio input for audio models.
type Audio struct {
	URL    string `json:"url,omitempty"`
	Data   []byte `json:"data"`
	Format string `json:"format"`
}

// Video represents video input for multimodal models.
type Video struct {
	URL    string `json:"url,omitempty"`
	Data   []byte `json:"data"`
	Format string `json:"format,omitempty"`
}

// File represents file content for file input models.
type File struct {
	Name     string `json:"filename"`
	URL      string `json:"url,omitempty"`
	Data     []byte `json:"data"`
	FileID   string `json:"file_id"`
	MimeType string `json:"format,omitempty"`
}

// FileURLText returns a textual representation for providers that cannot accept URL-based files.
func FileURLText(file *File) string {
	if file == nil {
		return ""
	}
	fileURL := strings.TrimSpace(file.URL)
	if fileURL == "" {
		return ""
	}
	name := strings.TrimSpace(file.Name)
	mimeType := strings.TrimSpace(file.MimeType)
	if name != "" && mimeType != "" {
		return fmt.Sprintf("File URL: %s (%s): %s", name, mimeType, fileURL)
	}
	if name != "" {
		return fmt.Sprintf("File URL: %s: %s", name, fileURL)
	}
	if mimeType != "" {
		return fmt.Sprintf("File URL (%s): %s", mimeType, fileURL)
	}
	return "File URL: " + fileURL
}

// ContentRef records where externalized content is stored and how to restore it.
type ContentRef struct {
	ArtifactRef      string `json:"artifact_ref"`
	ArtifactName     string `json:"artifact_name,omitempty"`
	ArtifactVersion  int    `json:"artifact_version"`
	MimeType         string `json:"mime_type,omitempty"`
	SizeBytes        int64  `json:"size_bytes,omitempty"`
	SHA256           string `json:"sha256,omitempty"`
	OriginalName     string `json:"original_name,omitempty"`
	EventID          string `json:"event_id,omitempty"`
	RequestID        string `json:"request_id,omitempty"`
}

// ContentPart represents a single content part in a multimodal message.
type ContentPart struct {
	Type       ContentType  `json:"type"`
	Text       *string      `json:"text,omitempty"`
	Image      *Image       `json:"image,omitempty"`
	Audio      *Audio       `json:"audio,omitempty"`
	Video      *Video       `json:"video,omitempty"`
	File       *File        `json:"file,omitempty"`
	ContentRef *ContentRef  `json:"content_ref,omitempty"`
}

// ─── Message (OpenAI-style flat message) ──────────────────────────────────

// Message represents a single message in a conversation.
// This is the OpenAI-compatible flat message format with string Content,
// ContentParts for multimodal, and ToolCalls for function calling.
// For structured content-block messages, use RichMessage instead.
type Message struct {
	Role              Role         `json:"role"`
	Content           string       `json:"content,omitempty"`
	ContentParts      []ContentPart `json:"content_parts,omitempty"`
	ToolID            string       `json:"tool_id,omitempty"`
	ToolName          string       `json:"tool_name,omitempty"`
	ToolCalls         []ToolCall   `json:"tool_calls,omitempty"`
	ReasoningContent  string       `json:"reasoning_content,omitempty"`
	ReasoningSignature string      `json:"reasoning_signature,omitempty"`
}

// AddFilePath adds a file path to the message.
func (m *Message) AddFilePath(fp string) error {
	mimeType, err := inferMimeType(fp)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(fp)
	if err != nil {
		return err
	}
	m.AddFileData(fp, content, mimeType)
	return nil
}

// AddFileData adds file data to the message.
func (m *Message) AddFileData(name string, data []byte, mimetype string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type: ContentTypeFile,
		File: &File{Name: name, Data: data, MimeType: mimetype},
	})
}

// AddFileURL adds a URL-based file to the message.
func (m *Message) AddFileURL(name, url, mimetype string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type: ContentTypeFile,
		File: &File{Name: name, URL: url, MimeType: mimetype},
	})
}

// AddFileID adds a file ID to the message.
func (m *Message) AddFileID(fileID string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type: ContentTypeFile,
		File: &File{FileID: fileID},
	})
}

// AddFileIDWithName adds a file ID and filename to the message.
func (m *Message) AddFileIDWithName(fileID, name string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type: ContentTypeFile,
		File: &File{Name: name, FileID: fileID},
	})
}

// AddImageURL adds an image URL to the message.
func (m *Message) AddImageURL(url, detail string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeImage,
		Image: &Image{URL: url, Detail: detail},
	})
}

// AddImageFilePath adds an image file path to the message.
func (m *Message) AddImageFilePath(path, detail string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	ext := filepath.Ext(path)
	var format string
	switch ext {
	case ".png":
		format = "png"
	case ".jpg", ".jpeg":
		format = "jpg"
	case ".webp":
		format = "webp"
	case ".gif":
		format = "gif"
	default:
		return fmt.Errorf("unsupported image format: %s", ext)
	}
	m.AddImageData(content, detail, format)
	return nil
}

// AddImageData adds image data to the message.
func (m *Message) AddImageData(data []byte, detail, format string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeImage,
		Image: &Image{Data: data, Detail: detail, Format: format},
	})
}

// AddAudioURL adds URL-based audio to the message.
func (m *Message) AddAudioURL(url, format string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeAudio,
		Audio: &Audio{URL: url, Format: format},
	})
}

// AddAudioFilePath adds an audio file path to the message.
func (m *Message) AddAudioFilePath(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	format := filepath.Ext(path)
	if format == ".wav" {
		format = "wav"
	} else if format == ".mp3" {
		format = "mp3"
	} else {
		return fmt.Errorf("unsupported audio format: %s", format)
	}
	m.AddAudioData(content, format)
	return nil
}

// AddAudioData adds audio data to the message.
func (m *Message) AddAudioData(data []byte, format string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeAudio,
		Audio: &Audio{Data: data, Format: format},
	})
}

// AddVideoURL adds URL-based video to the message.
func (m *Message) AddVideoURL(url, format string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeVideo,
		Video: &Video{URL: url, Format: format},
	})
}

// AddVideoData adds inline video data to the message.
func (m *Message) AddVideoData(data []byte, format string) {
	m.ContentParts = append(m.ContentParts, ContentPart{
		Type:  ContentTypeVideo,
		Video: &Video{Data: data, Format: format},
	})
}

// NewSystemMessage creates a new system message.
func NewSystemMessage(content string) Message {
	return Message{Role: RoleSystem, Content: content}
}

// NewUserMessage creates a new user message.
func NewUserMessage(content string) Message {
	return Message{Role: RoleUser, Content: content}
}

// NewToolMessage creates a new tool message.
func NewToolMessage(toolID, toolName, content string) Message {
	return Message{Role: RoleTool, ToolID: toolID, ToolName: toolName, Content: content}
}

// NewAssistantMessage creates a new assistant message.
func NewAssistantMessage(content string) Message {
	return Message{Role: RoleAssistant, Content: content}
}

// ─── Tool call ────────────────────────────────────────────────────────────

// ToolCall represents a call to a tool (function) in the model response.
type ToolCall struct {
	Type        string                  `json:"type"`
	Function    FunctionDefinitionParam `json:"function,omitempty"`
	ID          string                  `json:"id,omitempty"`
	Index       *int                    `json:"index,omitempty"`
	ExtraFields map[string]any          `json:"extra_fields,omitempty"`
}

// FunctionDefinitionParam represents the parameters for a function definition in tool calls.
type FunctionDefinitionParam struct {
	Name        string `json:"name"`
	Strict      bool   `json:"strict,omitempty"`
	Description string `json:"description,omitempty"`
	Arguments   []byte `json:"arguments,omitempty"`
}

// MarshalJSON customizes JSON marshaling for FunctionDefinitionParam.
func (f FunctionDefinitionParam) MarshalJSON() ([]byte, error) {
	type Alias FunctionDefinitionParam
	return json.Marshal(&struct {
		Alias
		Arguments string `json:"arguments,omitempty"`
	}{
		Alias:     Alias(f),
		Arguments: string(f.Arguments),
	})
}

// UnmarshalJSON customizes JSON unmarshaling for FunctionDefinitionParam.
func (f *FunctionDefinitionParam) UnmarshalJSON(data []byte) error {
	type Alias FunctionDefinitionParam
	aux := &struct {
		Alias
		Arguments string `json:"arguments,omitempty"`
	}{}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	*f = FunctionDefinitionParam(aux.Alias)
	f.Arguments = []byte(aux.Arguments)
	return nil
}

// ─── Generation config ────────────────────────────────────────────────────

// GenerationConfig contains configuration for text generation.
type GenerationConfig struct {
	MaxTokens         *int     `json:"max_tokens,omitempty"`
	Temperature       *float64 `json:"temperature,omitempty"`
	TopP              *float64 `json:"top_p,omitempty"`
	Stream            bool     `json:"stream"`
	Stop              []string `json:"stop,omitempty"`
	PresencePenalty   *float64 `json:"presence_penalty,omitempty"`
	FrequencyPenalty  *float64 `json:"frequency_penalty,omitempty"`
	Logprobs          *bool    `json:"logprobs,omitempty"`
	TopLogprobs       *int     `json:"top_logprobs,omitempty"`
	ReasoningEffort   *string  `json:"reasoning_effort,omitempty"`
	ThinkingEnabled   *bool    `json:"thinking_enabled,omitempty"`
	ThinkingTokens    *int     `json:"thinking_tokens,omitempty"`
	ThinkingLevel     *string  `json:"thinking_level,omitempty"`
}

// GenerationConfigPatch selectively overrides fields in GenerationConfig.
type GenerationConfigPatch struct {
	MaxTokens         *int     `json:"max_tokens,omitempty"`
	Temperature       *float64 `json:"temperature,omitempty"`
	TopP              *float64 `json:"top_p,omitempty"`
	Stream            *bool    `json:"stream,omitempty"`
	Stop              []string `json:"stop,omitempty"`
	PresencePenalty   *float64 `json:"presence_penalty,omitempty"`
	FrequencyPenalty  *float64 `json:"frequency_penalty,omitempty"`
	Logprobs          *bool    `json:"logprobs,omitempty"`
	TopLogprobs       *int     `json:"top_logprobs,omitempty"`
	ReasoningEffort   *string  `json:"reasoning_effort,omitempty"`
	ThinkingEnabled   *bool    `json:"thinking_enabled,omitempty"`
	ThinkingTokens    *int     `json:"thinking_tokens,omitempty"`
	ThinkingLevel     *string  `json:"thinking_level,omitempty"`
}

// ApplyGenerationConfigPatch applies patch to base and returns the merged configuration.
func ApplyGenerationConfigPatch(base GenerationConfig, patch GenerationConfigPatch) GenerationConfig {
	if patch.MaxTokens != nil {
		base.MaxTokens = patch.MaxTokens
	}
	if patch.Temperature != nil {
		base.Temperature = patch.Temperature
	}
	if patch.TopP != nil {
		base.TopP = patch.TopP
	}
	if patch.Stream != nil {
		base.Stream = *patch.Stream
	}
	if patch.Stop != nil {
		base.Stop = append([]string{}, patch.Stop...)
	}
	if patch.PresencePenalty != nil {
		base.PresencePenalty = patch.PresencePenalty
	}
	if patch.FrequencyPenalty != nil {
		base.FrequencyPenalty = patch.FrequencyPenalty
	}
	if patch.Logprobs != nil {
		base.Logprobs = patch.Logprobs
	}
	if patch.TopLogprobs != nil {
		base.TopLogprobs = patch.TopLogprobs
	}
	if patch.ReasoningEffort != nil {
		base.ReasoningEffort = patch.ReasoningEffort
	}
	if patch.ThinkingEnabled != nil {
		base.ThinkingEnabled = patch.ThinkingEnabled
	}
	if patch.ThinkingTokens != nil {
		base.ThinkingTokens = patch.ThinkingTokens
	}
	if patch.ThinkingLevel != nil {
		base.ThinkingLevel = patch.ThinkingLevel
	}
	return base
}

// ─── Tool declaration (relay-internal, no agentkit dependency) ────────────

// ToolDeclaration is the interface for tools that can be included in a Request.
// It mirrors agentkit/tool.Tool but lives in relay to avoid a circular dependency.
// The Declaration method returns an interface{} so that both compat.ToolDecl
// and agentkit/tool.Declaration can satisfy this interface.
type ToolDeclaration interface {
	// Declaration returns the metadata describing the tool.
	Declaration() any
}

// ToolDecl is the metadata describing a tool.
type ToolDecl struct {
	Name         string      `json:"name"`
	Description  string      `json:"description"`
	InputSchema  *JSONSchema `json:"inputSchema"`
	OutputSchema *JSONSchema `json:"outputSchema,omitempty"`
}

// JSONSchema represents the structure of JSON Schema used for defining arguments and responses.
type JSONSchema struct {
	Type                string                `json:"type,omitempty"`
	Description         string                `json:"description,omitempty"`
	Pattern             string                `json:"pattern,omitempty"`
	Required            []string              `json:"required,omitempty"`
	Properties          map[string]*JSONSchema `json:"properties,omitempty"`
	Items               *JSONSchema           `json:"items,omitempty"`
	AdditionalProperties any                   `json:"additionalProperties,omitempty"`
	Default             any                   `json:"default,omitempty"`
	Enum                []any                 `json:"enum,omitempty"`
	Ref                 string                `json:"$ref,omitempty"`
	Defs                map[string]*JSONSchema `json:"$defs,omitempty"`
}

// ─── Structured output ────────────────────────────────────────────────────

// StructuredOutputType represents the type of structured output.
type StructuredOutputType string

const (
	// StructuredOutputJSONSchema enables structured JSON output.
	StructuredOutputJSONSchema StructuredOutputType = "json_schema"
)

// JSONSchemaConfig defines the configuration for JSON schema structured output.
type JSONSchemaConfig struct {
	// Name is the name of the structured output format.
	Name string `json:"name,omitempty"`
	// Schema is the JSON schema definition.
	Schema map[string]any `json:"schema"`
	// Strict controls whether to enforce strict schema adherence.
	Strict bool `json:"strict,omitempty"`
	// Description provides context for the model about the structured output.
	Description string `json:"description,omitempty"`
}

// StructuredOutput defines how the model should produce structured output.
type StructuredOutput struct {
	// Type specifies the structured output type.
	Type StructuredOutputType `json:"type"`
	// JSONSchema is used when Type is StructuredOutputJSONSchema.
	JSONSchema *JSONSchemaConfig `json:"json_schema,omitempty"`
}

// ─── Request ──────────────────────────────────────────────────────────────

// Request is the request to the model (OpenAI-style flat format).
// For content-block-based requests, use RichChatRequest instead.
type Request struct {
	Messages         []Message           `json:"messages"`
	GenerationConfig `json:"generation_config,omitempty"`
	StructuredOutput *StructuredOutput   `json:"structured_output,omitempty"`
	ExtraFields      map[string]any      `json:"-"`
	Headers          map[string]string   `json:"-"`
	// Tools is a map of tool name to tool interface. The concrete type
	// can be agentkit/tool.Tool or any other type with a Declaration() method.
	// Use the GetTools() helper to extract tool declarations.
	Tools            any                 `json:"-"`
}

// GetTools returns the tools map as map[string]any. Returns nil if Tools is nil
// or not a map.
func (r *Request) GetTools() map[string]any {
	if r == nil || r.Tools == nil {
		return nil
	}
	if m, ok := r.Tools.(map[string]any); ok {
		return m
	}
	// Try to convert from map[string]tool.Tool or similar via reflection
	return nil
}

// ToolsLen returns the number of tools in the request.
func (r *Request) ToolsLen() int {
	if r == nil || r.Tools == nil {
		return 0
	}
	if m, ok := r.Tools.(map[string]any); ok {
		return len(m)
	}
	// Use reflection for other map types
	v := reflect.ValueOf(r.Tools)
	if v.Kind() == reflect.Map {
		return v.Len()
	}
	return 0
}

// RequestOption configures a Request.
type RequestOption func(*Request)

// NewRequest creates a model request from messages and applies options.
func NewRequest(messages []Message, opts ...RequestOption) *Request {
	req := &Request{Messages: messages}
	for _, opt := range opts {
		if opt != nil {
			opt(req)
		}
	}
	return req
}

// WithStructuredOutputJSON sets JSON schema structured output for a request.
// The schema is constructed automatically from the provided example type.
func WithStructuredOutputJSON(examplePtr any, strict bool, description string) RequestOption {
	return func(req *Request) {
		if out := structuredOutputJSON(examplePtr, strict, description); out != nil {
			req.StructuredOutput = out
		}
	}
}

// structuredOutputJSON builds a StructuredOutput from the provided example type.
func structuredOutputJSON(examplePtr any, strict bool, description string) *StructuredOutput {
	name, schema, _ := fromType(examplePtr, strict)
	if schema == nil {
		return nil
	}
	return &StructuredOutput{
		Type: StructuredOutputJSONSchema,
		JSONSchema: &JSONSchemaConfig{
			Name:        name,
			Schema:      schema,
			Strict:      strict,
			Description: description,
		},
	}
}

// ─── Response ─────────────────────────────────────────────────────────────

// Error type constants for ResponseError.Type field.
const (
	ErrorTypeStreamError = "stream_error"
	ErrorTypeAPIError    = "api_error"
	ErrorTypeFlowError   = "flow_error"
	ErrorTypeRunError    = "run_error"
	ErrorTypeCancelled   = "cancelled"
)

// Object type constants for Response.Object field.
const (
	ObjectTypeError                     = "error"
	ObjectTypeToolResponse              = "tool.response"
	ObjectTypePreprocessingBasic        = "preprocessing.basic"
	ObjectTypePreprocessingContent      = "preprocessing.content"
	ObjectTypePreprocessingIdentity     = "preprocessing.identity"
	ObjectTypePreprocessingInstruction  = "preprocessing.instruction"
	ObjectTypePreprocessingPlanning     = "preprocessing.planning"
	ObjectTypePreprocessingStatus       = "preprocessing.status"
	ObjectTypePostprocessingPlanning    = "postprocessing.planning"
	ObjectTypePostprocessingCodeExecution = "postprocessing.code_execution"
	ObjectTypeTransfer                  = "agent.transfer"
	ObjectTypeRunnerCompletion          = "runner.completion"
	ObjectTypeStateUpdate               = "state.update"
	ObjectTypeChatCompletionChunk       = "chat.completion.chunk"
	ObjectTypeChatCompletion            = "chat.completion"
)

// Choice represents a single completion choice.
type Choice struct {
	Index        int       `json:"index"`
	Message      Message   `json:"message,omitempty"`
	Delta        Message   `json:"delta,omitempty"`
	FinishReason *string   `json:"finish_reason,omitempty"`
	Logprobs     *Logprobs `json:"logprobs,omitempty"`
}

// Logprobs represents token-level log probability information.
type Logprobs struct {
	Content []TokenLogprob `json:"content,omitempty"`
}

// TokenLogprob represents the log probability data for one generated token.
type TokenLogprob struct {
	Token       string        `json:"token"`
	Logprob     float64       `json:"logprob"`
	Bytes       []int         `json:"bytes,omitempty"`
	TopLogprobs []TopLogprob  `json:"top_logprobs,omitempty"`
}

// TopLogprob represents one alternative token and its log probability.
type TopLogprob struct {
	Token   string  `json:"token"`
	Logprob float64 `json:"logprob"`
	Bytes   []int   `json:"bytes,omitempty"`
}

// TimingInfo represents timing information for token generation.
type TimingInfo struct {
	FirstTokenDuration time.Duration `json:"time_to_first_token,omitempty"`
	ReasoningDuration  time.Duration `json:"reasoning_duration,omitempty"`
}

// Usage represents token usage information.
type Usage struct {
	PromptTokens          int                   `json:"prompt_tokens"`
	CompletionTokens      int                   `json:"completion_tokens"`
	TotalTokens           int                   `json:"total_tokens"`
	PromptTokensDetails   PromptTokensDetails   `json:"prompt_tokens_details"`
	CompletionTokensDetails CompletionTokensDetails `json:"completion_tokens_details"`
	TimingInfo            *TimingInfo           `json:"timing_info,omitempty"`
}

// PromptTokensDetails is the details of the prompt tokens.
type PromptTokensDetails struct {
	CachedTokens      int `json:"cached_tokens"`
	CacheCreationTokens int `json:"cache_creation_tokens,omitempty"`
	CacheReadTokens    int `json:"cache_read_tokens,omitempty"`
}

// CompletionTokensDetails is the details of the completion tokens.
type CompletionTokensDetails struct {
	ReasoningTokens int `json:"reasoning_tokens,omitempty"`
}

// Response is the response from the model (OpenAI-style with Choices).
// For content-block-based responses, use RichResponse instead.
type Response struct {
	ID               string          `json:"id"`
	Object           string          `json:"object"`
	Created          int64           `json:"created"`
	Model            string          `json:"model"`
	Choices          []Choice        `json:"choices"`
	Usage            *Usage          `json:"usage,omitempty"`
	SystemFingerprint *string        `json:"system_fingerprint,omitempty"`
	Error            *ResponseError  `json:"error,omitempty"`
	Timestamp        time.Time       `json:"timestamp"`
	Done             bool            `json:"done"`
	IsPartial        bool            `json:"is_partial"`
}

// Clone creates a deep copy of the response.
func (rsp *Response) Clone() *Response {
	if rsp == nil {
		return nil
	}
	clone := *rsp
	clone.Choices = make([]Choice, len(rsp.Choices))
	for i, choice := range rsp.Choices {
		clone.Choices[i] = choice
		clone.Choices[i].Logprobs = cloneLogprobs(choice.Logprobs)
	}
	if rsp.Usage != nil {
		clone.Usage = &Usage{
			PromptTokens:            rsp.Usage.PromptTokens,
			CompletionTokens:        rsp.Usage.CompletionTokens,
			TotalTokens:             rsp.Usage.TotalTokens,
			PromptTokensDetails:     rsp.Usage.PromptTokensDetails,
			CompletionTokensDetails: rsp.Usage.CompletionTokensDetails,
		}
		if rsp.Usage.TimingInfo != nil {
			clone.Usage.TimingInfo = &TimingInfo{
				FirstTokenDuration: rsp.Usage.TimingInfo.FirstTokenDuration,
				ReasoningDuration:  rsp.Usage.TimingInfo.ReasoningDuration,
			}
		}
	}
	if rsp.Error != nil {
		clone.Error = &ResponseError{
			Message: rsp.Error.Message,
			Type:    rsp.Error.Type,
			Param:   rsp.Error.Param,
			Code:    rsp.Error.Code,
		}
	}
	if rsp.SystemFingerprint != nil {
		fp := *rsp.SystemFingerprint
		clone.SystemFingerprint = &fp
	}
	return &clone
}

func cloneLogprobs(logprobs *Logprobs) *Logprobs {
	if logprobs == nil {
		return nil
	}
	cloned := &Logprobs{}
	if logprobs.Content != nil {
		cloned.Content = make([]TokenLogprob, len(logprobs.Content))
		for i, token := range logprobs.Content {
			cloned.Content[i] = TokenLogprob{
				Token:   token.Token,
				Logprob: token.Logprob,
				Bytes:   append([]int(nil), token.Bytes...),
			}
			if token.TopLogprobs != nil {
				cloned.Content[i].TopLogprobs = make([]TopLogprob, len(token.TopLogprobs))
				for j, top := range token.TopLogprobs {
					cloned.Content[i].TopLogprobs[j] = TopLogprob{
						Token:   top.Token,
						Logprob: top.Logprob,
						Bytes:   append([]int(nil), top.Bytes...),
					}
				}
			}
		}
	}
	return cloned
}

// IsValidContent checks if the response has valid content for message generation.
func (rsp *Response) IsValidContent() bool {
	if rsp == nil {
		return false
	}
	if rsp.IsToolCallResponse() || rsp.IsToolResultResponse() {
		return true
	}
	for _, choice := range rsp.Choices {
		if HasPayload(choice.Message) || HasPayload(choice.Delta) {
			return true
		}
	}
	return false
}

// IsUserMessage checks if the response is a user message.
func (rsp *Response) IsUserMessage() bool {
	if rsp == nil || len(rsp.Choices) == 0 {
		return false
	}
	for _, choice := range rsp.Choices {
		if choice.Message.Role == RoleUser || choice.Delta.Role == RoleUser {
			return true
		}
	}
	return false
}

// IsToolResultResponse checks if the response is a tool call result response.
func (rsp *Response) IsToolResultResponse() bool {
	return rsp != nil && len(rsp.Choices) > 0 && (rsp.Choices[0].Message.ToolID != "" || rsp.Choices[0].Delta.ToolID != "")
}

// IsToolCallResponse checks if the response is related to tool calls.
func (rsp *Response) IsToolCallResponse() bool {
	return rsp != nil && len(rsp.Choices) > 0 && (len(rsp.Choices[0].Message.ToolCalls) > 0 || len(rsp.Choices[0].Delta.ToolCalls) > 0)
}

// GetToolCallIDs gets the IDs of tool calls from the response.
func (rsp *Response) GetToolCallIDs() []string {
	ids := make([]string, 0)
	if rsp == nil || len(rsp.Choices) <= 0 {
		return ids
	}
	for _, choice := range rsp.Choices {
		for _, toolCall := range choice.Message.ToolCalls {
			ids = append(ids, toolCall.ID)
		}
		for _, toolCall := range choice.Delta.ToolCalls {
			ids = append(ids, toolCall.ID)
		}
	}
	return ids
}

// GetToolResultIDs gets the IDs of tool results from the response.
func (rsp *Response) GetToolResultIDs() []string {
	ids := make([]string, 0)
	if rsp == nil || len(rsp.Choices) <= 0 {
		return ids
	}
	for _, choice := range rsp.Choices {
		if choice.Message.ToolID != "" {
			ids = append(ids, choice.Message.ToolID)
		}
		if choice.Delta.ToolID != "" {
			ids = append(ids, choice.Delta.ToolID)
		}
	}
	return ids
}

// IsFinalResponse checks if the Response is a final response.
func (rsp *Response) IsFinalResponse() bool {
	if rsp == nil {
		return true
	}
	if rsp.IsPartial || rsp.IsToolCallResponse() {
		return false
	}
	return rsp.Done && (len(rsp.Choices) > 0 || rsp.Error != nil)
}

// ResponseError represents an error response from the API.
type ResponseError struct {
	Message string  `json:"message"`
	Type    string  `json:"type"`
	Param   *string `json:"param,omitempty"`
	Code    *string `json:"code,omitempty"`
}

// Error implements the error interface.
func (e *ResponseError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// ─── Message helpers ──────────────────────────────────────────────────────

// (HasPayload, MessagesEqual are in message_validator.go and message_compare.go)

// ─── Model interface ──────────────────────────────────────────────────────

// Model is the interface for all language models.
type Model interface {
	// GenerateContent generates content from the given request.
	GenerateContent(ctx context.Context, request *Request) (<-chan *Response, error)
	// Info returns basic information about the model.
	Info() Info
}

// Seq is a callback-based sequence that yields values.
type Seq[T any] func(yield func(T) bool)

// IterModel is an optional extension of Model that streams responses in the caller goroutine.
type IterModel interface {
	Model
	GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}

// Info contains basic information about a Model.
type Info struct {
	Name          string
	ContextWindow int
}

// ─── Token counter ────────────────────────────────────────────────────────

// (TokenCounter, TailoringStrategy, TokenTailoringConfig are in token_tailor.go)

// ─── File downloader (optional model capability) ──────────────────────────

// (FileDownloader is in file_downloader.go)

// ─── Pointer helpers ──────────────────────────────────────────────────────

// IntPtr returns a pointer to v.
func IntPtr(v int) *int { return &v }

// Float64Ptr returns a pointer to v.
func Float64Ptr(v float64) *float64 { return &v }

// BoolPtr returns a pointer to v.
func BoolPtr(v bool) *bool { return &v }

// StringPtr returns a pointer to v.
func StringPtr(v string) *string { return &v }

// ─── MIME type inference ──────────────────────────────────────────────────

func inferMimeType(path string) (string, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".txt":
		return "text/plain", nil
	case ".md":
		return "text/markdown", nil
	case ".json":
		return "application/json", nil
	case ".pdf":
		return "application/pdf", nil
	case ".png":
		return "image/png", nil
	case ".jpg", ".jpeg":
		return "image/jpeg", nil
	case ".gif":
		return "image/gif", nil
	case ".webp":
		return "image/webp", nil
	case ".csv":
		return "text/csv", nil
	case ".html", ".htm":
		return "text/html", nil
	case ".xml":
		return "application/xml", nil
	case ".zip":
		return "application/zip", nil
	case ".mp3":
		return "audio/mpeg", nil
	case ".wav":
		return "audio/wav", nil
	case ".mp4":
		return "video/mp4", nil
	default:
		return "application/octet-stream", nil
	}
}

// ─── Thinking parameter keys ──────────────────────────────────────────────

// Thinking parameter keys used in API requests.
const (
	ThinkingEnabledKey     = "thinking_enabled"
	ThinkingTokensKey      = "thinking_tokens"
	ReasoningContentKey    = "reasoning_content"
	ReasoningContentKeyAlt = "reasoning"
	EnableThinkingKey      = "enable_thinking"
	EnabledThinkingKey     = "enabled_thinking"
)
