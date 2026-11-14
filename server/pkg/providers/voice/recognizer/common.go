package recognizer

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"io"
)

const DefaultSampleRate = 16000

type ProtocolVersion byte
type MessageType byte
type MessageTypeSpecificFlags byte
type SerializationType byte
type CompressionType byte

const (
	ProtocolVersionV1 = ProtocolVersion(0b0001)

	// Message Type
	MessageTypeClientFullRequest      = MessageType(0b0001)
	MessageTypeClientAudioOnlyRequest = MessageType(0b0010)
	MessageTypeServerFullResponse     = MessageType(0b1001)
	MessageTypeServerAck              = MessageType(0b1011)
	MessageTypeServerErrorResponse    = MessageType(0b1111)

	// Message Type Specific Flags
	FlagNoSequence        = MessageTypeSpecificFlags(0b0000)
	FlagPosSequence       = MessageTypeSpecificFlags(0b0001)
	FlagNegWithSequence   = MessageTypeSpecificFlags(0b0011)
	FlagEventWithSequence = MessageTypeSpecificFlags(0b0100)

	// Serialization Type
	SerializationJSON = SerializationType(0b0001)
	SerializationRaw  = SerializationType(0b0010)
	SerializationNone = SerializationType(0b0000)

	// Compression Type
	CompressionNone = CompressionType(0b0000)
	CompressionGZIP = CompressionType(0b0001)
)

// ProtocolHeader represents the binary protocol header for ASR requests.
type ProtocolHeader struct {
	messageType              MessageType
	messageTypeSpecificFlags MessageTypeSpecificFlags
	serializationType        SerializationType
	compressionType          CompressionType
	reservedData             []byte
}

// Serialize converts the header to binary format.
func (h *ProtocolHeader) Serialize() []byte {
	buf := bytes.NewBuffer([]byte{})
	buf.WriteByte(byte(ProtocolVersionV1<<4 | 1))
	buf.WriteByte(byte(h.messageType<<4) | byte(h.messageTypeSpecificFlags))
	buf.WriteByte(byte(h.serializationType<<4) | byte(h.compressionType))
	buf.Write(h.reservedData)
	return buf.Bytes()
}

// SetMessageType sets the message type.
func (h *ProtocolHeader) SetMessageType(msgType MessageType) *ProtocolHeader {
	h.messageType = msgType
	return h
}

// SetMessageTypeFlags sets the message type specific flags.
func (h *ProtocolHeader) SetMessageTypeFlags(flags MessageTypeSpecificFlags) *ProtocolHeader {
	h.messageTypeSpecificFlags = flags
	return h
}

// SetSerializationType sets the serialization type.
func (h *ProtocolHeader) SetSerializationType(serType SerializationType) *ProtocolHeader {
	h.serializationType = serType
	return h
}

// SetCompressionType sets the compression type.
func (h *ProtocolHeader) SetCompressionType(compType CompressionType) *ProtocolHeader {
	h.compressionType = compType
	return h
}

// SetReservedData sets the reserved data bytes.
func (h *ProtocolHeader) SetReservedData(data []byte) *ProtocolHeader {
	h.reservedData = data
	return h
}

// NewDefaultHeader creates a default protocol header.
func NewDefaultHeader() *ProtocolHeader {
	return &ProtocolHeader{
		messageType:              MessageTypeClientFullRequest,
		messageTypeSpecificFlags: FlagPosSequence,
		serializationType:        SerializationJSON,
		compressionType:          CompressionGZIP,
		reservedData:             []byte{0x00},
	}
}

// GzipCompress compresses data using gzip.
func GzipCompress(input []byte) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, _ = w.Write(input)
	_ = w.Close()
	return b.Bytes()
}

// GzipDecompress decompresses gzip data.
func GzipDecompress(input []byte) []byte {
	b := bytes.NewBuffer(input)
	r, err := gzip.NewReader(b)
	if err != nil {
		return nil
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return nil
	}
	return out
}

// Ensure binary is referenced.
var _ = binary.BigEndian
