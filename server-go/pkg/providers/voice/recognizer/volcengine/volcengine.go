// Package synthesizer implements the Volcengine ASR adapter for ling-base.
package synthesizer

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	SuccessCode = 1000

	ServerFullResponse  = base.MessageType(0b1001)
	ServerAck           = base.MessageType(0b1011)
	ServerErrorResponse = base.MessageType(0b1111)
)

var DefaultFullClientWsHeader = []byte{0x11, 0x10, 0x11, 0x00}
var DefaultAudioOnlyWsHeader = []byte{0x11, 0x20, 0x11, 0x00}
var DefaultLastAudioWsHeader = []byte{0x11, 0x22, 0x11, 0x00}

func gzipCompress(input []byte) ([]byte, error) {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, err := w.Write(input)
	if err != nil {
		return nil, err
	}
	if err = w.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func gzipDecompress(input []byte) ([]byte, error) {
	b := bytes.NewBuffer(input)
	r, _ := gzip.NewReader(b)
	out, _ := io.ReadAll(r)
	if err := r.Close(); err != nil {
		return nil, err
	}
	return out, nil
}

// VolcEngineResponse is the parsed ASR response from Volcengine.
type VolcEngineResponse struct {
	Reqid    string             `json:"reqid"`
	Code     int                `json:"code"`
	Message  string             `json:"message"`
	Sequence int                `json:"sequence"`
	Results  []VolcengineResult `json:"result,omitempty"`
}

// VolcengineResult holds a single recognition result.
type VolcengineResult struct {
	Text       string      `json:"text"`
	Confidence int         `json:"confidence"`
	Language   string      `json:"language,omitempty"`
	Utterances []Utterance `json:"utterances,omitempty"`
}

// Utterance represents a single utterance with word-level timing.
type Utterance struct {
	Text      string `json:"text"`
	StartTime int    `json:"start_time"`
	EndTime   int    `json:"end_time"`
	Definite  bool   `json:"definite"`
	Words     []Word `json:"words"`
	Language  string `json:"language"`
}

// Word represents a single recognized word.
type Word struct {
	Text          string `json:"text"`
	StartTime     int    `json:"start_time"`
	EndTime       int    `json:"end_time"`
	Pronounce     string `json:"pronounce"`
	BlankDuration int    `json:"blank_duration"`
}

// Volcengine is the Volcengine standard ASR engine.
type Volcengine struct {
	client         *VolcengineClient
	opt            VolcengineOption
	ttfbDone       bool
	sendReqTime    *time.Time
	endReqTime     *time.Time
	Sentence       string
	isTranscribing bool

	audioChan chan []byte
	closeChan chan struct{}

	tr       base.ResultFunc
	er       base.ErrorFunc
	dialogID string
}

// VolcengineOption configures the Volcengine standard ASR.
type VolcengineOption struct {
	Url           string `json:"url" yaml:"url" default:"wss://openspeech.bytedance.com/api/v2/asr"`
	AppID         string `json:"appId" yaml:"app_id" env:"VOLC_APPID"`
	Token         string `json:"token" yaml:"token" env:"VOLC_TOKEN"`
	Cluster       string `json:"cluster" yaml:"cluster" env:"VOLC_CLUSTER"`
	WorkFlow      string `json:"workFlow" yaml:"work_flow" default:"audio_in,resample,partition,vad,fe,decode"`
	Format        string `json:"format" yaml:"format" default:"raw" env:"VOLC_FORMAT"`
	Codec         string `json:"codec" yaml:"codec" default:"raw"`
	ReqChanSize   int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
	EndWindowSize int    `json:"endWindowSize" yaml:"end_window_size"`
}

// GetVendor returns the vendor identifier.
func (opt *VolcengineOption) GetVendor() base.Vendor {
	return base.VendorVolcengine
}

func (opt VolcengineOption) effectiveEndWindowSize() int {
	v := opt.EndWindowSize
	if v <= 0 {
		v = base.DefaultVolcEndWindowMs()
	}
	if v < 200 {
		return 200
	}
	if v > 3000 {
		return 3000
	}
	return v
}

// VolcengineClient holds the WebSocket connection state.
type VolcengineClient struct {
	uuid          string
	conn          *websocket.Conn
	ctx           context.Context
	cancel        context.CancelFunc
	sendLastAudio bool
}

func (c *VolcengineClient) String() string {
	return fmt.Sprintf("volc client{uuid: %s, sendLastAudio: %t}", c.uuid, c.sendLastAudio)
}

// NewVolcengineOption creates a default VolcengineOption.
func NewVolcengineOption(appId string, token string, cluster string, format string) VolcengineOption {
	if format == "" {
		format = "raw"
	}
	if cluster == "" {
		cluster = "volcengine_input_common"
	}
	return VolcengineOption{
		Url:           "wss://openspeech.bytedance.com/api/v2/asr",
		AppID:         appId,
		Token:         token,
		Cluster:       cluster,
		ReqChanSize:   128,
		WorkFlow:      "audio_in,resample,partition,vad,fe,decode",
		Codec:         "raw",
		Format:        format,
		EndWindowSize: base.DefaultVolcEndWindowMs(),
	}
}

// NewVolcengineASR builds a Volcengine ASR engine.
func NewVolcengineASR(opt VolcengineOption) *Volcengine {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if strings.TrimSpace(opt.Url) == "" {
		opt.Url = "wss://openspeech.bytedance.com/api/v2/asr"
	}
	if strings.TrimSpace(opt.WorkFlow) == "" {
		opt.WorkFlow = "audio_in,resample,partition,vad,fe,decode"
	}
	if strings.TrimSpace(opt.Codec) == "" {
		opt.Codec = "raw"
	}
	if strings.TrimSpace(opt.Format) == "" {
		opt.Format = "raw"
	}
	if strings.TrimSpace(opt.Cluster) == "" {
		opt.Cluster = "volcengine_input_common"
	}
	if opt.EndWindowSize <= 0 {
		opt.EndWindowSize = base.DefaultVolcEndWindowMs()
	}
	return &Volcengine{
		opt:       opt,
		audioChan: make(chan []byte, 1024),
		closeChan: make(chan struct{}, 24),
	}
}

func (volc *Volcengine) Init(tr base.ResultFunc, er base.ErrorFunc) {
	volc.tr = tr
	volc.er = er
}

func (volc *Volcengine) Vendor() string { return "volcengine" }

func (volc *Volcengine) ConnAndReceive(dialogID string) error {
	volc.dialogID = dialogID
	if volc.audioChan == nil {
		volc.audioChan = make(chan []byte, 1024)
	}
	if volc.closeChan == nil {
		volc.closeChan = make(chan struct{}, 24)
	}
	n := time.Now()
	volc.sendReqTime = &n
	volc.endReqTime = nil
	volc.ttfbDone = false
	volc.Sentence = ""
	return volc.buildClient()
}

func (volc *Volcengine) Activity() bool {
	return volc.client != nil && volc.client.conn != nil
}

func (volc *Volcengine) RestartClient() {
	_ = volc.StopConn()
	id := strings.TrimSpace(volc.dialogID)
	if id == "" {
		id = uuid.New().String()
	}
	if err := volc.ConnAndReceive(id); err != nil {
		volc.causeErr(err)
	}
}

func (volc *Volcengine) SendAudioBytes(data []byte) error {
	if data == nil {
		return nil
	}
	if !volc.Activity() {
		if len(data) == 0 {
			return nil
		}
		volc.RestartClient()
		if !volc.Activity() {
			return fmt.Errorf("volcengine recognizer is not running")
		}
	}
	if volc.sendReqTime == nil {
		n := time.Now()
		volc.sendReqTime = &n
	}
	select {
	case volc.audioChan <- data:
		return nil
	default:
		select {
		case volc.audioChan <- data:
			return nil
		case <-time.After(200 * time.Millisecond):
			return fmt.Errorf("volcengine audio chan full")
		}
	}
}

func (volc *Volcengine) SendEnd() error {
	if volc.closeChan == nil {
		return nil
	}
	select {
	case volc.closeChan <- struct{}{}:
	default:
	}
	return nil
}

func (volc *Volcengine) StopConn() error {
	if volc.client != nil && volc.client.cancel != nil {
		volc.client.cancel()
	}
	err := volc.closeClient()
	volc.client = nil
	return err
}

func (volc *Volcengine) causeErr(err error) {
	if err == nil {
		return
	}
	if volc.er != nil {
		volc.er(err, true)
	}
}

func (volc *Volcengine) sinceSend() time.Duration {
	if volc.sendReqTime == nil {
		return 0
	}
	return time.Since(*volc.sendReqTime)
}

func (volc *Volcengine) emitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	volc.Sentence = text
	if volc.tr != nil {
		volc.tr(text, false, volc.sinceSend(), volc.dialogID)
	}
}

func (volc *Volcengine) emitFinal(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		text = strings.TrimSpace(volc.Sentence)
	}
	if text == "" {
		return
	}
	volc.Sentence = text
	dur := volc.sinceSend()
	if volc.tr != nil {
		volc.tr(text, true, dur, volc.dialogID)
	}
	volc.Sentence = ""
}

func (volc *Volcengine) closeClient() error {
	if volc.client != nil {
		return volc.client.conn.Close()
	}
	return nil
}

func (volc *Volcengine) buildClient() error {
	var err error
	var tokenHeader = http.Header{"Authorization": []string{fmt.Sprintf("Bearer;%s", volc.opt.Token)}}
	conn, _, err := websocket.DefaultDialer.Dial(volc.opt.Url, tokenHeader)
	if err != nil {
		logger.Error("volcengine asr: fail to dial", logger.WithError(err))
		return err
	}
	if err = volc.sendFullClientMsg(conn); err != nil {
		logger.Error("volcengine asr: fail to send full client msg", logger.WithError(err))
		return err
	}

	ctx, clientCancel := context.WithCancel(context.Background())
	client := VolcengineClient{uuid: uuid.New().String(), conn: conn, sendLastAudio: false, ctx: ctx, cancel: clientCancel}
	logger.Info("volcengine asr: build client", logger.WithFields(map[string]interface{}{
		"client": client.String(),
	})...)
	volc.client = &client

	go volc.recvFrames(&client)
	go volc.sendFrames(&client)
	return err
}

func (volc *Volcengine) restartClient() {
	logger.Info("volcengine asr: restart client")
	if volc.client != nil && volc.client.cancel != nil {
		volc.client.cancel()
	}
	err := volc.buildClient()
	if err != nil {
		volc.causeErr(err)
	}
}

func (volc *Volcengine) sendFrames(client *VolcengineClient) {
	const maxBytesPerSecond = 96000
	const sendInterval = 100 * time.Millisecond
	const maxBytesPerInterval = maxBytesPerSecond / 10

	ticker := time.NewTicker(sendInterval)
	defer ticker.Stop()

	var pendingData []byte

	for {
		select {
		case data := <-volc.audioChan:
			pendingData = append(pendingData, data...)

		case <-ticker.C:
			if len(pendingData) > 0 {
				sendSize := len(pendingData)
				if sendSize > maxBytesPerInterval {
					sendSize = maxBytesPerInterval
				}

				toSend := pendingData[:sendSize]
				pendingData = pendingData[sendSize:]

				if err := volc.sendAudioMsg(client, toSend, false); err != nil {
					logger.Error("volcengine asr: fail to send audio msg", logger.WithError(err))
					volc.restartClient()
					return
				}
			}

		case <-volc.closeChan:
			if len(pendingData) > 0 {
				if err := volc.sendAudioMsg(client, pendingData, false); err != nil {
					logger.Error("volcengine asr: fail to send remaining audio", logger.WithError(err))
				}
			}
			client.sendLastAudio = true
			if err := volc.sendAudioMsg(client, nil, true); err != nil {
				logger.Error("volcengine asr: fail to send audio msg", logger.WithError(err))
				volc.restartClient()
			}
			return

		case <-client.ctx.Done():
			return
		}
	}
}

func (volc *Volcengine) sendAudioMsg(client *VolcengineClient, audio []byte, isLast bool) error {
	var err error
	audioMsg := make([]byte, len(DefaultAudioOnlyWsHeader))

	if isLast {
		copy(audioMsg, DefaultLastAudioWsHeader)
	} else {
		copy(audioMsg, DefaultAudioOnlyWsHeader)
	}
	payload, _ := gzipCompress(audio)
	payloadSize := len(payload)
	payloadSizeArr := make([]byte, 4)
	binary.BigEndian.PutUint32(payloadSizeArr, uint32(payloadSize))
	audioMsg = append(audioMsg, payloadSizeArr...)
	audioMsg = append(audioMsg, payload...)

	err = client.conn.WriteMessage(websocket.BinaryMessage, audioMsg)

	return err
}

func (volc *Volcengine) recvFrames(client *VolcengineClient) {
	for {
		select {
		case <-client.ctx.Done():
			return
		default:
			conn := client.conn
			_, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
					logger.Info("volcengine asr: recv close message, connection closed")
				} else {
					logger.Error("volcengine asr: recv error, connection closed", logger.WithError(err))
				}
				if strings.TrimSpace(volc.Sentence) != "" {
					volc.emitFinal(volc.Sentence)
				}
				volc.restartClient()
				return
			}

			response, err := volc.parseResponse(message)
			if err != nil {
				logger.Error("volcengine asr: fail to parse response", logger.WithError(err))
				volc.restartClient()
				return
			}
			if response.Code != SuccessCode {
				logger.Error("volcengine asr: receive error message", logger.WithFields(map[string]interface{}{
					"code":    response.Code,
					"message": response.Message,
				})...)
				volc.restartClient()
				return
			}
			if len(response.Results) == 0 {
				continue
			}
			latestResult := response.Results[0]
			if latestResult.Text != "" {
				if !volc.ttfbDone {
					volc.ttfbDone = true
				}
				logger.Info("volcengine asr: recv frame", logger.WithFields(map[string]interface{}{
					"Sentence": latestResult.Text,
				})...)
				volc.emitPartial(latestResult.Text)
			}

			definite := len(latestResult.Utterances) > 0 && latestResult.Utterances[0].Definite
			if definite && (client.sendLastAudio || volc.tr != nil) {
				volc.emitFinal(latestResult.Text)
				if client.cancel != nil {
					client.cancel()
				}
				err = volc.buildClient()
				if err != nil {
					volc.causeErr(err)
				}
				return
			}
		}
	}
}

func (volc *Volcengine) sendFullClientMsg(conn *websocket.Conn) error {
	req := volc.constructRequest()
	payload, _ := gzipCompress(req)
	payloadSize := len(payload)
	payloadSizeArr := make([]byte, 4)
	binary.BigEndian.PutUint32(payloadSizeArr, uint32(payloadSize))

	fullClientMsg := make([]byte, len(DefaultFullClientWsHeader))
	copy(fullClientMsg, DefaultFullClientWsHeader)
	fullClientMsg = append(fullClientMsg, payloadSizeArr...)
	fullClientMsg = append(fullClientMsg, payload...)

	err := conn.WriteMessage(websocket.BinaryMessage, fullClientMsg)
	if err != nil {
		return err
	}
	_, msg, err := conn.ReadMessage()
	if err != nil {
		logger.Error("volcengine asr: fail to read message", logger.WithError(err))
		return err
	}
	_, err = volc.parseResponse(msg)
	if err != nil {
		return err
	}
	return nil
}

func (volc *Volcengine) constructRequest() []byte {
	uid := strings.ReplaceAll(uuid.New().String(), "-", "")

	req := make(map[string]map[string]interface{})
	req["app"] = make(map[string]interface{})
	req["app"]["appid"] = volc.opt.AppID
	req["app"]["cluster"] = volc.opt.Cluster
	req["app"]["token"] = volc.opt.Token
	req["user"] = make(map[string]interface{})
	req["user"]["uid"] = uid
	req["request"] = make(map[string]interface{})
	req["request"]["reqid"] = uuid.New().String()
	req["request"]["nbest"] = 1
	req["request"]["workflow"] = volc.opt.WorkFlow
	req["request"]["show_utterances"] = true
	req["request"]["result_type"] = "signle"
	req["request"]["sequence"] = 1
	req["request"]["end_window_size"] = volc.opt.effectiveEndWindowSize()
	req["audio"] = make(map[string]interface{})
	req["audio"]["format"] = volc.opt.Format
	req["audio"]["codec"] = volc.opt.Codec
	reqStr, _ := json.Marshal(req)
	return reqStr
}

func (volc *Volcengine) parseResponse(msg []byte) (VolcEngineResponse, error) {
	var err error

	headerSize := msg[0] & 0x0f
	messageType := msg[1] >> 4
	serializationMethod := msg[2] >> 4
	messageCompression := msg[2] & 0x0f
	payload := msg[headerSize*4:]
	payloadMsg := make([]byte, 0)
	payloadSize := 0

	if messageType == byte(ServerFullResponse) {
		payloadSize = int(int32(binary.BigEndian.Uint32(payload[0:4])))
		payloadMsg = payload[4:]
	} else if messageType == byte(ServerAck) {
		seq := int32(binary.BigEndian.Uint32(payload[:4]))
		if len(payload) >= 8 {
			payloadSize = int(binary.BigEndian.Uint32(payload[4:8]))
			payloadMsg = payload[8:]
		}
		logger.Debug(fmt.Sprintf("volcengine asr: server ack seq: %d", seq))
	} else if messageType == byte(ServerErrorResponse) {
		code := int32(binary.BigEndian.Uint32(payload[:4]))
		payloadSize = int(binary.BigEndian.Uint32(payload[4:8]))
		payloadMsg = payload[8:]
		var errResponse = VolcEngineResponse{}
		payloadMsg, _ = gzipDecompress(payloadMsg)
		_ = json.Unmarshal(payloadMsg, &errResponse)
		return VolcEngineResponse{}, errors.New(fmt.Sprintf("volcengine asr: server response error code: %d msg: %s", code, errResponse.Message))
	}
	if payloadSize == 0 {
		return VolcEngineResponse{}, errors.New("volcengine asr: payload size is 0")
	}
	if messageCompression == byte(base.CompressionGZIP) {
		payloadMsg, _ = gzipDecompress(payloadMsg)
	}

	var asrResponse = VolcEngineResponse{}
	if serializationMethod == byte(base.SerializationJSON) {
		err = json.Unmarshal(payloadMsg, &asrResponse)
		if err != nil {
			logger.Error(fmt.Sprintf("volcengine asr: fail to unmarshal response, %s", err.Error()))
			return VolcEngineResponse{}, err
		}
	}
	return asrResponse, nil
}

// Compile-time guard.
var _ base.Engine = (*Volcengine)(nil)

// Ensure sync is referenced.
var _ = sync.Mutex{}
