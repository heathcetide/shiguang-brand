package recognizer

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

// UserMeta represents user metadata in the ASR request payload.
type UserMeta struct {
	UID        string `json:"uid,omitempty"`
	DID        string `json:"did,omitempty"`
	Platform   string `json:"platform,omitempty"`
	SDKVersion string `json:"sdk_version,omitempty"`
	APPVersion string `json:"app_version,omitempty"`
}

// AudioMeta represents audio format metadata in the ASR request payload.
type AudioMeta struct {
	Format  string `json:"format,omitempty"`
	Codec   string `json:"codec,omitempty"`
	Rate    int    `json:"rate,omitempty"`
	Bits    int    `json:"bits,omitempty"`
	Channel int    `json:"channel,omitempty"`
}

// CorpusMeta represents corpus metadata in the ASR request payload.
type CorpusMeta struct {
	BoostingTableName string `json:"boosting_table_name,omitempty"`
	CorrectTableName  string `json:"correct_table_name,omitempty"`
	Context           string `json:"context,omitempty"`
}

// RequestMeta represents request metadata in the ASR request payload.
type RequestMeta struct {
	ModelName       string     `json:"model_name,omitempty"`
	EnableITN       bool       `json:"enable_itn,omitempty"`
	EnablePUNC      bool       `json:"enable_punc,omitempty"`
	EnableDDC       bool       `json:"enable_ddc,omitempty"`
	ShowUtterances  bool       `json:"show_utterances"`
	EnableNonstream bool       `json:"enable_nonstream"`
	EndWindowSize   int        `json:"end_window_size,omitempty"`
	Corpus          CorpusMeta `json:"corpus,omitempty"`
}

// RequestPayload represents the full ASR request payload.
type RequestPayload struct {
	User    UserMeta    `json:"user"`
	Audio   AudioMeta   `json:"audio"`
	Request RequestMeta `json:"request"`
}

// NewFullClientRequest creates a full client request payload.
func NewFullClientRequest(config *Config) []byte {
	var request bytes.Buffer
	header := NewDefaultHeader().SetMessageTypeFlags(FlagPosSequence)
	request.Write(header.Serialize())

	payload := RequestPayload{
		User: UserMeta{
			UID:        config.User.UID,
			DID:        config.User.DID,
			Platform:   config.User.Platform,
			SDKVersion: config.User.SDKVersion,
			APPVersion: config.User.APPVersion,
		},
		Audio: AudioMeta{
			Format:  config.Audio.Format,
			Codec:   config.Audio.Codec,
			Rate:    config.Audio.Rate,
			Bits:    config.Audio.Bits,
			Channel: config.Audio.Channel,
		},
		Request: RequestMeta{
			ModelName:       config.Request.ModelName,
			EnableITN:       config.Request.EnableITN,
			EnablePUNC:      config.Request.EnablePUNC,
			EnableDDC:       config.Request.EnableDDC,
			ShowUtterances:  config.Request.ShowUtterances,
			EnableNonstream: config.Request.EnableNonstream,
			EndWindowSize:   config.Request.EndWindowSize,
			Corpus: CorpusMeta{
				BoostingTableName: config.Request.Corpus.BoostingTableName,
				CorrectTableName:  config.Request.Corpus.CorrectTableName,
				Context:           config.Request.Corpus.Context,
			},
		},
	}

	payloadData, _ := json.Marshal(payload)
	payloadData = GzipCompress(payloadData)
	payloadSize := len(payloadData)
	payloadSizeBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(payloadSizeBytes, uint32(payloadSize))

	_ = binary.Write(&request, binary.BigEndian, int32(1))
	request.Write(payloadSizeBytes)
	request.Write(payloadData)
	return request.Bytes()
}

// NewAudioOnlyRequest creates an audio-only request payload.
func NewAudioOnlyRequest(seq int, segment []byte) []byte {
	var request bytes.Buffer
	header := NewDefaultHeader()

	if seq < 0 {
		header.SetMessageTypeFlags(FlagNegWithSequence)
	} else {
		header.SetMessageTypeFlags(FlagPosSequence)
	}
	header.SetMessageType(MessageTypeClientAudioOnlyRequest)
	request.Write(header.Serialize())

	// Write sequence number
	_ = binary.Write(&request, binary.BigEndian, int32(seq))

	// Write payload
	payload := GzipCompress(segment)
	_ = binary.Write(&request, binary.BigEndian, int32(len(payload)))
	request.Write(payload)

	return request.Bytes()
}

// BuildAuthHeader creates HTTP headers for authentication.
func BuildAuthHeader(auth AuthConfig) http.Header {
	reqID := uuid.New().String()
	header := http.Header{}

	header.Add("X-Api-Resource-Id", auth.ResourceId)
	header.Add("X-Api-Request-Id", reqID)
	header.Add("X-Api-Access-Key", auth.AccessKey)
	header.Add("X-Api-App-Key", auth.AppKey)
	return header
}
