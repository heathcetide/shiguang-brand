// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package opentelemetry

import (
	"context"
	"fmt"
	"math"
	"time"

	otellog "go.opentelemetry.io/otel/log"
	"go.uber.org/zap/zapcore"
)

// ZapOTelCore is a zapcore.Core that bridges zap log entries to the
// OpenTelemetry logs pipeline.
//
// This allows existing zap.Logger usage to be forwarded to OTel-compatible
// backends (Jaeger, Loki, etc.) without changing application code.
//
// Usage:
//
//	core := opentelemetry.NewZapOTelCore(otelSDK.Logs.Logger())
//	logger := zap.New(core)
type ZapOTelCore struct {
	logger otellog.Logger
	fields []otellog.KeyValue
	level  zapcore.Level
}

// NewZapOTelCore creates a zapcore.Core that bridges to the OTel logs pipeline.
// The minimum log level is Info (zapcore.InfoLevel).
func NewZapOTelCore(logger otellog.Logger) zapcore.Core {
	return &ZapOTelCore{
		logger: logger,
		level:  zapcore.InfoLevel,
	}
}

// NewZapOTelCoreWithLevel creates a zapcore.Core with a custom minimum level.
func NewZapOTelCoreWithLevel(logger otellog.Logger, minLevel zapcore.Level) zapcore.Core {
	return &ZapOTelCore{
		logger: logger,
		level:  minLevel,
	}
}

// Enabled returns whether the given level is enabled.
func (c *ZapOTelCore) Enabled(level zapcore.Level) bool {
	return level >= c.level
}

// With adds structured context to the core.
func (c *ZapOTelCore) With(fields []zapcore.Field) zapcore.Core {
	cloned := *c
	cloned.fields = make([]otellog.KeyValue, len(c.fields))
	copy(cloned.fields, c.fields)
	for _, f := range fields {
		cloned.fields = append(cloned.fields, zapFieldToOTel(f))
	}
	return &cloned
}

// Check returns a CheckedEntry if logging should proceed, nil otherwise.
func (c *ZapOTelCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(ent.Level) {
		return ce.AddCore(ent, c)
	}
	return ce
}

// Write writes the entry to the OTel logs pipeline.
func (c *ZapOTelCore) Write(ent zapcore.Entry, fields []zapcore.Field) error {
	// Build OTel log record.
	var rec otellog.Record
	rec.SetTimestamp(ent.Time)
	rec.SetBody(otellog.StringValue(ent.Message))
	rec.SetSeverity(zapLevelToOTel(ent.Level))
	rec.SetSeverityText(ent.Level.String())

	// Add caller info.
	if ent.Caller.Defined {
		rec.AddAttributes(
			otellog.String("code.filepath", ent.Caller.File),
			otellog.Int("code.lineno", ent.Caller.Line),
			otellog.String("code.function", ent.Caller.Function),
		)
	}

	// Add structured fields.
	for _, f := range fields {
		rec.AddAttributes(zapFieldToOTel(f))
	}

	// Add core-level fields.
	if len(c.fields) > 0 {
		rec.AddAttributes(c.fields...)
	}

	c.logger.Emit(context.Background(), rec)
	return nil
}

// Sync flushes any buffered log entries. The OTel logs pipeline is
// asynchronous; a true flush requires shutting down the LoggerProvider.
func (c *ZapOTelCore) Sync() error {
	return nil
}

// zapLevelToOTel maps zap levels to OTel severity.
func zapLevelToOTel(level zapcore.Level) otellog.Severity {
	switch level {
	case zapcore.DebugLevel:
		return otellog.SeverityDebug
	case zapcore.InfoLevel:
		return otellog.SeverityInfo
	case zapcore.WarnLevel:
		return otellog.SeverityWarn
	case zapcore.ErrorLevel:
		return otellog.SeverityError
	case zapcore.DPanicLevel:
		return otellog.SeverityFatal1
	case zapcore.PanicLevel:
		return otellog.SeverityFatal2
	case zapcore.FatalLevel:
		return otellog.SeverityFatal3
	default:
		return otellog.SeverityInfo
	}
}

// zapFieldToOTel converts a zap.Field to an OTel key-value.
func zapFieldToOTel(f zapcore.Field) otellog.KeyValue {
	switch f.Type {
	case zapcore.StringType:
		return otellog.String(f.Key, f.String)
	case zapcore.Int64Type, zapcore.Int32Type, zapcore.Int16Type, zapcore.Int8Type:
		return otellog.Int64(f.Key, f.Integer)
	case zapcore.Uint64Type, zapcore.Uint32Type, zapcore.Uint16Type, zapcore.Uint8Type:
		return otellog.Int64(f.Key, f.Integer)
	case zapcore.Float64Type:
		// zap stores float64 as math.Float64bits in Integer.
		return otellog.Float64(f.Key, math.Float64frombits(uint64(f.Integer)))
	case zapcore.Float32Type:
		// zap stores float32 as math.Float32bits in Integer.
		return otellog.Float64(f.Key, float64(math.Float32frombits(uint32(f.Integer))))
	case zapcore.BoolType:
		return otellog.Bool(f.Key, f.Integer == 1)
	case zapcore.DurationType:
		return otellog.String(f.Key, time.Duration(f.Integer).String())
	case zapcore.TimeType:
		return otellog.String(f.Key, time.Unix(0, f.Integer).Format(time.RFC3339Nano))
	case zapcore.ErrorType:
		if err, ok := f.Interface.(error); ok {
			return otellog.String(f.Key, err.Error())
		}
		return otellog.String(f.Key, fmt.Sprintf("%v", f.Interface))
	case zapcore.ReflectType:
		return otellog.String(f.Key, fmt.Sprintf("%v", f.Interface))
	case zapcore.SkipType:
		return otellog.String("", "")
	default:
		return otellog.String(f.Key, fmt.Sprintf("%v", f.Interface))
	}
}
