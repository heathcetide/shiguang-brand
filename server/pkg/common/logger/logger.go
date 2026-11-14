package logger

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/constants"
	"gopkg.in/natefinch/lumberjack.v2"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const consoleTimeLayout = "2006-01-02 15:04:05.000"

// DefaultTimezone is used when InitTimezone is not called or the given name is invalid.
const DefaultTimezone = constants.DefaultTimezone

// localLoc is the package-level timezone used by all time encoders.
// We avoid modifying time.Local to prevent data races with time.Now()
// calls in background goroutines (e.g. lumberjack's mill loop).
var (
	localLocMu sync.RWMutex
	localLoc   *time.Location
)

func getLocalLoc() *time.Location {
	localLocMu.RLock()
	defer localLocMu.RUnlock()
	if localLoc == nil {
		return time.Local
	}
	return localLoc
}

// InitTimezone loads the IANA timezone name and sets the package-level timezone.
// Call once at startup. Unlike modifying time.Local directly, this is safe to
// call concurrently with time.Now() in background goroutines.
func InitTimezone(name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = DefaultTimezone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "logger: invalid timezone %q: %v; falling back to %s\n", name, err, DefaultTimezone)
		loc, _ = time.LoadLocation(DefaultTimezone)
	}
	localLocMu.Lock()
	localLoc = loc
	localLocMu.Unlock()
}

// businessTimeEncoder writes timestamps in the configured business timezone.
func businessTimeEncoder(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
	enc.AppendString(t.In(getLocalLoc()).Format("2006-01-02T15:04:05.000Z07:00"))
}

func formatConsoleTime(t time.Time) string {
	return t.In(getLocalLoc()).Format(consoleTimeLayout)
}

func todayDateString() string {
	return time.Now().In(getLocalLoc()).Format("2006-01-02")
}

type LogConfig struct {
	Level           string `mapstructure:"level"`
	Filename        string `mapstructure:"filename"`
	MaxSize         int    `mapstructure:"max_size"`
	MaxAge          int    `mapstructure:"max_age"`        // lumberjack rotation age (days)
	RetentionDays   int    `mapstructure:"retention_days"` // purge files under logs dir (from LOG_RETENTION_DAYS)
	MaxBackups      int    `mapstructure:"max_backups"`
	Daily           bool   `mapstructure:"daily"`
	SensitiveFields string `mapstructure:"sensitive_fields"` // comma-separated; from LOG_SENSITIVE_FIELDS
}

var (
	Lg          *zap.Logger
	once        sync.Once
	cfg         *LogConfig
	currentDate string
)

// Init initializes the global logger once using sync.Once.
func Init(config *LogConfig, mode string) (err error) {
	once.Do(func() {
		cfg = config
		currentDate = todayDateString()
		redactor := initRedactor(cfg.SensitiveFields)

		writeSyncer := getLogWriter(cfg.Filename, cfg.MaxSize, cfg.MaxBackups, cfg.MaxAge, cfg.Daily)
		encoder := getEncoder()
		var l = new(zapcore.Level)
		err = l.UnmarshalText([]byte(cfg.Level))
		if err != nil {
			return
		}
		var core zapcore.Core
		if mode == constants.ENV_PROD || mode == constants.ENV_DEV || mode == constants.ENV_LOCAL {
			consoleEncoderConfig := zap.NewDevelopmentEncoderConfig()
			consoleEncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
			consoleEncoderConfig.EncodeTime = businessTimeEncoder
			consoleEncoderConfig.TimeKey = "time"
			consoleEncoderConfig.EncodeCaller = zapcore.ShortCallerEncoder
			if mode == constants.ENV_LOCAL {
				// local: green theme, prominent for development debugging
				consoleEncoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[32m" + formatConsoleTime(t) + "\x1b[0m")
				}
				consoleEncoderConfig.EncodeLevel = func(l zapcore.Level, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[32m" + "[" + l.CapitalString() + "]\x1b[0m")
				}
				consoleEncoderConfig.EncodeCaller = func(caller zapcore.EntryCaller, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[32m" + caller.TrimmedPath() + "\x1b[0m")
				}
			} else if mode == constants.ENV_DEV {
				// dev: blue theme, distinct from local/prod
				consoleEncoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[34m" + formatConsoleTime(t) + "\x1b[0m")
				}
				consoleEncoderConfig.EncodeLevel = func(l zapcore.Level, enc zapcore.PrimitiveArrayEncoder) {
					var levelColor = map[zapcore.Level]string{
						zapcore.DebugLevel:  "\x1b[34m", // blue
						zapcore.InfoLevel:   "\x1b[36m", // cyan
						zapcore.WarnLevel:   "\x1b[33m", // yellow
						zapcore.ErrorLevel:  "\x1b[31m", // red
						zapcore.DPanicLevel: "\x1b[31m", // red
						zapcore.PanicLevel:  "\x1b[31m", // red
						zapcore.FatalLevel:  "\x1b[31m", // red
					}
					color, ok := levelColor[l]
					if !ok {
						color = "\x1b[34m"
					}
					enc.AppendString(color + "[" + l.CapitalString() + "]\x1b[0m")
				}
				consoleEncoderConfig.EncodeCaller = func(caller zapcore.EntryCaller, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[34m" + caller.TrimmedPath() + "\x1b[0m")
				}
			} else {
				// prod: gray theme, low-key professional
				consoleEncoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[90m" + formatConsoleTime(t) + "\x1b[0m")
				}
				consoleEncoderConfig.EncodeLevel = func(l zapcore.Level, enc zapcore.PrimitiveArrayEncoder) {
					var levelColor = map[zapcore.Level]string{
						zapcore.DebugLevel:  "\x1b[90m", // gray
						zapcore.InfoLevel:   "\x1b[37m", // white
						zapcore.WarnLevel:   "\x1b[33m", // yellow
						zapcore.ErrorLevel:  "\x1b[31m", // red
						zapcore.DPanicLevel: "\x1b[31m", // red
						zapcore.PanicLevel:  "\x1b[31m", // red
						zapcore.FatalLevel:  "\x1b[31m", // red
					}
					color, ok := levelColor[l]
					if !ok {
						color = "\x1b[37m"
					}
					enc.AppendString(color + "[" + l.CapitalString() + "]\x1b[0m")
				}
				consoleEncoderConfig.EncodeCaller = func(caller zapcore.EntryCaller, enc zapcore.PrimitiveArrayEncoder) {
					enc.AppendString("\x1b[90m" + caller.TrimmedPath() + "\x1b[0m")
				}
			}
			consoleEncoder := zapcore.NewConsoleEncoder(consoleEncoderConfig)
			highPriority := zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
				return lvl >= zapcore.ErrorLevel
			})
			lowPriority := zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
				return lvl < zapcore.ErrorLevel
			})
			// Wrap each leaf individually rather than the Tee. Wrapping
			// the Tee bypasses per-leaf level filtering: Tee.Write
			// dispatches to all sub-cores unconditionally, so an INFO
			// entry routed through a single outer-wrapper Write call
			// would hit both the stdout-low leaf AND the stderr-high
			// leaf, printing the same line twice in a terminal that
			// merges both streams. Wrapping at the leaf preserves the
			// leaf's LevelEnabler in Check.
			core = zapcore.NewTee(
				wrapLogCore(zapcore.NewCore(encoder, writeSyncer, l), redactor),
				wrapLogCore(zapcore.NewCore(consoleEncoder, zapcore.Lock(os.Stdout), lowPriority), redactor),
				wrapLogCore(zapcore.NewCore(consoleEncoder, zapcore.Lock(os.Stderr), highPriority), redactor),
			)
		} else {
			core = wrapLogCore(zapcore.NewCore(encoder, writeSyncer, l), redactor)
		}
		Lg = zap.New(core, zap.AddCaller())
		zap.ReplaceGlobals(Lg)
		Info("initialized logger module successful")
	})
	return
}

func getEncoder() zapcore.Encoder {
	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.EncodeTime = businessTimeEncoder
	encoderConfig.TimeKey = "time"
	encoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	encoderConfig.EncodeDuration = zapcore.SecondsDurationEncoder
	encoderConfig.EncodeCaller = zapcore.ShortCallerEncoder
	return zapcore.NewJSONEncoder(encoderConfig)
}

// dailyRotateWriter is a custom writer that supports automatic daily rotation.
type dailyRotateWriter struct {
	baseFilename string
	maxSize      int
	maxBackup    int
	maxAge       int
	daily        bool
	lumberjack   *lumberjack.Logger
	mutex        sync.Mutex
}

func (w *dailyRotateWriter) Write(p []byte) (n int, err error) {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	if w.daily {
		today := todayDateString()
		if today != currentDate {
			currentDate = today
			ext := filepath.Ext(w.baseFilename)
			base := w.baseFilename[:len(w.baseFilename)-len(ext)]
			newFilename := base + "-" + today + ext
			newLogger := &lumberjack.Logger{
				Filename:   newFilename,
				MaxSize:    w.maxSize,
				MaxBackups: w.maxBackup,
				MaxAge:     w.maxAge,
				LocalTime:  true,
			}
			w.lumberjack = newLogger
		}
	}
	return w.lumberjack.Write(p)
}

func (w *dailyRotateWriter) Sync() error {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return w.lumberjack.Close()
}

func getLogWriter(filename string, maxSize, maxBackup, maxAge int, daily bool) zapcore.WriteSyncer {
	var actualFilename string
	if daily {
		ext := filepath.Ext(filename)
		base := filename[:len(filename)-len(ext)]
		dateStr := todayDateString()
		actualFilename = base + "-" + dateStr + ext
	} else {
		actualFilename = filename
	}

	lumberJackLogger := &lumberjack.Logger{
		Filename:   actualFilename,
		MaxSize:    maxSize,
		MaxBackups: maxBackup,
		MaxAge:     maxAge,
		LocalTime:  true,
	}

	if daily {
		// Return the custom daily rotation writer.
		return zapcore.AddSync(&dailyRotateWriter{
			baseFilename: filename,
			maxSize:      maxSize,
			maxBackup:    maxBackup,
			maxAge:       maxAge,
			daily:        daily,
			lumberjack:   lumberJackLogger,
		})
	}

	return zapcore.AddSync(lumberJackLogger)
}

// Info logs at info level (skips this package frame so caller points to the business call site).
func Info(msg string, fields ...zap.Field) {
	ensureLg()
	Lg.WithOptions(zap.AddCallerSkip(1)).Info(msg, fields...)
}

// Warn logs at warn level.
func Warn(msg string, fields ...zap.Field) {
	ensureLg()
	Lg.WithOptions(zap.AddCallerSkip(1)).Warn(msg, fields...)
}

// Error logs at error level.
func Error(msg string, fields ...zap.Field) {
	ensureLg()
	Lg.WithOptions(zap.AddCallerSkip(1)).Error(msg, fields...)
}

// Debug logs at debug level.
func Debug(msg string, fields ...zap.Field) {
	ensureLg()
	Lg.WithOptions(zap.AddCallerSkip(1)).Debug(msg, fields...)
}

// Fatal logs at fatal level and exits.
func Fatal(msg string, fields ...zap.Field) {
	ensureLg()
	Lg.WithOptions(zap.AddCallerSkip(1)).Fatal(msg, fields...)
}

// Panic logs at panic level and panics.
func Panic(msg string, fields ...zap.Field) {
	if Lg == nil {
		panic(msg)
	}
	Lg.WithOptions(zap.AddCallerSkip(1)).Panic(msg, fields...)
}

// Sync flushes buffered log entries.
func Sync() {
	if Lg != nil {
		_ = Lg.Sync()
	}
}

// Close flushes buffered log entries and releases underlying resources
// (e.g. lumberjack file handles). After Close, the global logger Lg is
// set to nil and subsequent log calls will use a no-op fallback.
func Close() {
	if Lg != nil {
		_ = Lg.Sync()
		Lg = nil
	}
}

// Context keys for extracting values from context
type contextKey string

const (
	TraceIDKey    contextKey = "trace_id"
	RequestIDKey  contextKey = "request_id"
	UserIDKey     contextKey = "user_id"
	XReqIDKey     contextKey = "x-reqid"
	TenantIDKey   contextKey = "tenant_id"
	CallIDKey     contextKey = "call_id"
	CampaignIDKey contextKey = "campaign_id"
)

// InfoCtx logs at info level with context-derived fields.
func InfoCtx(ctx context.Context, msg string, fields ...zap.Field) {
	ensureLg()
	fields = appendContextFields(ctx, fields...)
	Lg.WithOptions(zap.AddCallerSkip(1)).Info(msg, fields...)
}

// WarnCtx logs at warn level with context-derived fields.
func WarnCtx(ctx context.Context, msg string, fields ...zap.Field) {
	ensureLg()
	fields = appendContextFields(ctx, fields...)
	Lg.WithOptions(zap.AddCallerSkip(1)).Warn(msg, fields...)
}

// ErrorCtx logs at error level with context-derived fields.
func ErrorCtx(ctx context.Context, msg string, fields ...zap.Field) {
	ensureLg()
	fields = appendContextFields(ctx, fields...)
	Lg.WithOptions(zap.AddCallerSkip(1)).Error(msg, fields...)
}

// DebugCtx logs at debug level with context-derived fields.
func DebugCtx(ctx context.Context, msg string, fields ...zap.Field) {
	ensureLg()
	fields = appendContextFields(ctx, fields...)
	Lg.WithOptions(zap.AddCallerSkip(1)).Debug(msg, fields...)
}

// FatalCtx logs at fatal level with context-derived fields and exits.
func FatalCtx(ctx context.Context, msg string, fields ...zap.Field) {
	ensureLg()
	fields = appendContextFields(ctx, fields...)
	Lg.WithOptions(zap.AddCallerSkip(1)).Fatal(msg, fields...)
}

// PanicCtx logs at panic level with context-derived fields and panics.
func PanicCtx(ctx context.Context, msg string, fields ...zap.Field) {
	fields = appendContextFields(ctx, fields...)
	if Lg == nil {
		panic(msg)
	}
	Lg.WithOptions(zap.AddCallerSkip(1)).Panic(msg, fields...)
}

// appendContextFields extracts trace_id, request_id, etc. from context.
func appendContextFields(ctx context.Context, fields ...zap.Field) []zap.Field {
	if ctx == nil {
		return fields
	}
	if traceID := ctx.Value(TraceIDKey); traceID != nil {
		fields = append(fields, zap.String(string(TraceIDKey), fmt.Sprintf("%v", traceID)))
	}
	if requestID := ctx.Value(RequestIDKey); requestID != nil {
		fields = append(fields, zap.String(string(XReqIDKey), fmt.Sprintf("%v", requestID)))
	}
	if userID := ctx.Value(UserIDKey); userID != nil {
		fields = append(fields, zap.String(string(UserIDKey), fmt.Sprintf("%v", userID)))
	}
	if tenantID := ctx.Value(TenantIDKey); tenantID != nil {
		fields = append(fields, zap.String(string(TenantIDKey), fmt.Sprintf("%v", tenantID)))
	}
	if callID := ctx.Value(CallIDKey); callID != nil {
		fields = append(fields, zap.String(string(CallIDKey), fmt.Sprintf("%v", callID)))
	}
	if campaignID := ctx.Value(CampaignIDKey); campaignID != nil {
		fields = append(fields, zap.String(string(CampaignIDKey), fmt.Sprintf("%v", campaignID)))
	}
	return fields
}

// GetDailyLogFilename returns the date-segmented log filename.
func GetDailyLogFilename(baseFilename string) string {
	ext := filepath.Ext(baseFilename)
	base := baseFilename[:len(baseFilename)-len(ext)]
	dateStr := todayDateString()
	return base + "-" + dateStr + ext
}

// WithFields creates zap.Field slice from a map.
func WithFields(fields map[string]interface{}) []zap.Field {
	zapFields := make([]zap.Field, 0, len(fields))
	for k, v := range fields {
		zapFields = append(zapFields, zap.Any(k, v))
	}
	return zapFields
}

// WithError creates an error zap.Field.
func WithError(err error) zap.Field {
	return zap.Error(err)
}

// Infof logs at info level with fmt.Sprintf-style formatting.
func Infof(format string, args ...interface{}) {
	if Default != nil {
		Default.Infof(format, args...)
		return
	}
	Info(fmt.Sprintf(format, args...))
}

// Warnf logs at warn level with fmt.Sprintf-style formatting.
func Warnf(format string, args ...interface{}) {
	if Default != nil {
		Default.Warnf(format, args...)
		return
	}
	Warn(fmt.Sprintf(format, args...))
}

// Errorf logs at error level with fmt.Sprintf-style formatting.
func Errorf(format string, args ...interface{}) {
	if Default != nil {
		Default.Errorf(format, args...)
		return
	}
	Error(fmt.Sprintf(format, args...))
}

// Debugf logs at debug level with fmt.Sprintf-style formatting.
func Debugf(format string, args ...interface{}) {
	if Default != nil {
		Default.Debugf(format, args...)
		return
	}
	Debug(fmt.Sprintf(format, args...))
}

// Fatalf logs at fatal level with fmt.Sprintf-style formatting.
func Fatalf(format string, args ...interface{}) {
	if Default != nil {
		Default.Fatalf(format, args...)
		return
	}
	Fatal(fmt.Sprintf(format, args...))
}

// Panicf logs at panic level with fmt.Sprintf-style formatting.
func Panicf(format string, args ...interface{}) {
	Panic(fmt.Sprintf(format, args...))
}

// InfofCtx logs at info level with context and fmt.Sprintf-style formatting.
func InfofCtx(ctx context.Context, format string, args ...interface{}) {
	InfoCtx(ctx, fmt.Sprintf(format, args...))
}

// WarnfCtx logs at warn level with context and fmt.Sprintf-style formatting.
func WarnfCtx(ctx context.Context, format string, args ...interface{}) {
	WarnCtx(ctx, fmt.Sprintf(format, args...))
}

// ErrorfCtx logs at error level with context and fmt.Sprintf-style formatting.
func ErrorfCtx(ctx context.Context, format string, args ...interface{}) {
	ErrorCtx(ctx, fmt.Sprintf(format, args...))
}

// DebugfCtx logs at debug level with context and fmt.Sprintf-style formatting.
func DebugfCtx(ctx context.Context, format string, args ...interface{}) {
	DebugCtx(ctx, fmt.Sprintf(format, args...))
}

func wrapLogCore(inner zapcore.Core, r *redactor) zapcore.Core {
	return WrapCoreWithReqIDPrefix(wrapCoreWithRedact(inner, r))
}

// InfoWithRedactedFields logs info with sensitive fields redacted.
func InfoWithRedactedFields(msg string, fields map[string]interface{}) {
	if Lg == nil {
		return
	}
	Lg.Info(msg, WithFields(RedactFields(fields))...)
}

// ErrorWithRedactedFields logs error with sensitive fields redacted.
func ErrorWithRedactedFields(msg string, fields map[string]interface{}) {
	if Lg == nil {
		return
	}
	Lg.Error(msg, WithFields(RedactFields(fields))...)
}
