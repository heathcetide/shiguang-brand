package logger

import (
	"context"
	"fmt"
	"os"
	"sync"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Log level name constants (agentkit/log compatibility).
const (
	LevelDebug = "debug"
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
	LevelFatal = "fatal"
)

// PanicPrefix marks recovered panic logs so log-based collectors can report them.
const PanicPrefix = "[PANIC]"

// Logger is the printf-style interface used by injectable defaults (tests).
type Logger interface {
	Debug(args ...any)
	Debugf(format string, args ...any)
	Info(args ...any)
	Infof(format string, args ...any)
	Warn(args ...any)
	Warnf(format string, args ...any)
	Error(args ...any)
	Errorf(format string, args ...any)
	Fatal(args ...any)
	Fatalf(format string, args ...any)
}

var (
	sugarMu      sync.RWMutex
	traceEnabled bool
	atomicLevel  = zap.NewAtomicLevelAt(zapcore.InfoLevel)

	// Default, when non-nil, receives printf-style package helpers (tests inject mocks).
	Default Logger
	// ContextDefault is used by *Context helpers when set.
	ContextDefault Logger
)

// SetLevel sets the runtime log level for the auto-initialized console logger
// and, when possible, the global Lg core.
func SetLevel(level string) {
	var l zapcore.Level
	switch level {
	case LevelDebug:
		l = zapcore.DebugLevel
	case LevelInfo:
		l = zapcore.InfoLevel
	case LevelWarn:
		l = zapcore.WarnLevel
	case LevelError:
		l = zapcore.ErrorLevel
	case LevelFatal:
		l = zapcore.FatalLevel
	default:
		l = zapcore.InfoLevel
	}
	atomicLevel.SetLevel(l)
}

// SetTraceEnabled toggles Tracef / TracefContext.
func SetTraceEnabled(enabled bool) {
	sugarMu.Lock()
	traceEnabled = enabled
	sugarMu.Unlock()
}

// IsTraceEnabled reports whether trace logging is active.
func IsTraceEnabled() bool {
	sugarMu.RLock()
	defer sugarMu.RUnlock()
	return traceEnabled
}

func ensureLg() {
	if Lg != nil {
		return
	}
	encCfg := zap.NewDevelopmentEncoderConfig()
	encCfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
	encCfg.EncodeTime = zapcore.RFC3339TimeEncoder
	core := zapcore.NewCore(
		zapcore.NewConsoleEncoder(encCfg),
		zapcore.AddSync(os.Stdout),
		atomicLevel,
	)
	Lg = zap.New(core, zap.AddCaller(), zap.AddCallerSkip(1))
}

func sprintArgs(args ...any) string {
	return fmt.Sprint(args...)
}

// --- Context printf aliases (agentkit names) ---

// InfofContext is an alias of InfofCtx.
var InfofContext = func(ctx context.Context, format string, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Infof(format, args...)
		return
	}
	InfofCtx(ctx, format, args...)
}

// WarnfContext is an alias of WarnfCtx.
var WarnfContext = func(ctx context.Context, format string, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Warnf(format, args...)
		return
	}
	WarnfCtx(ctx, format, args...)
}

// ErrorfContext is an alias of ErrorfCtx.
var ErrorfContext = func(ctx context.Context, format string, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Errorf(format, args...)
		return
	}
	ErrorfCtx(ctx, format, args...)
}

// DebugfContext is an alias of DebugfCtx.
var DebugfContext = func(ctx context.Context, format string, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Debugf(format, args...)
		return
	}
	DebugfCtx(ctx, format, args...)
}

// FatalfContext logs a formatted fatal message with context.
var FatalfContext = func(ctx context.Context, format string, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Fatalf(format, args...)
		return
	}
	FatalfCtx(ctx, format, args...)
}

// FatalfCtx logs at fatal level with context and formatting.
func FatalfCtx(ctx context.Context, format string, args ...interface{}) {
	FatalCtx(ctx, fmt.Sprintf(format, args...))
}

// --- Print-style Context helpers (agentkit names) ---

var InfoContext = func(ctx context.Context, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Info(args...)
		return
	}
	InfoCtx(ctx, sprintArgs(args...))
}

var WarnContext = func(ctx context.Context, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Warn(args...)
		return
	}
	WarnCtx(ctx, sprintArgs(args...))
}

var ErrorContext = func(ctx context.Context, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Error(args...)
		return
	}
	ErrorCtx(ctx, sprintArgs(args...))
}

var DebugContext = func(ctx context.Context, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Debug(args...)
		return
	}
	DebugCtx(ctx, sprintArgs(args...))
}

var FatalContext = func(ctx context.Context, args ...any) {
	if ContextDefault != nil {
		ContextDefault.Fatal(args...)
		return
	}
	FatalCtx(ctx, sprintArgs(args...))
}

// Tracef logs at debug with a [TRACE] prefix when enabled.
func Tracef(format string, args ...any) {
	if !IsTraceEnabled() {
		return
	}
	if Default != nil {
		Default.Debugf("[TRACE] "+format, args...)
		return
	}
	Debugf("[TRACE] "+format, args...)
}

// TracefContext logs a TRACE message with context when enabled.
var TracefContext = func(ctx context.Context, format string, args ...any) {
	if !IsTraceEnabled() {
		return
	}
	if ContextDefault != nil {
		ContextDefault.Debugf("[TRACE] "+format, args...)
		return
	}
	DebugfCtx(ctx, "[TRACE] "+format, args...)
}

// PrintInfo logs with fmt.Sprint (multi-arg Print-style; avoids clashing with Info(msg, fields...)).
func PrintInfo(args ...any) {
	if Default != nil {
		Default.Info(args...)
		return
	}
	Info(sprintArgs(args...))
}

// PrintDebug logs with fmt.Sprint.
func PrintDebug(args ...any) {
	if Default != nil {
		Default.Debug(args...)
		return
	}
	Debug(sprintArgs(args...))
}

// PrintWarn logs with fmt.Sprint.
func PrintWarn(args ...any) {
	if Default != nil {
		Default.Warn(args...)
		return
	}
	Warn(sprintArgs(args...))
}

// PrintError logs with fmt.Sprint.
func PrintError(args ...any) {
	if Default != nil {
		Default.Error(args...)
		return
	}
	Error(sprintArgs(args...))
}

// PrintFatal logs with fmt.Sprint and exits.
func PrintFatal(args ...any) {
	if Default != nil {
		Default.Fatal(args...)
		return
	}
	Fatal(sprintArgs(args...))
}
