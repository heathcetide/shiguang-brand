// Package logger provides structured logging for LingByte.
//
// Initialization:
//
//	Call logger.InitTimezone(constants.TimezoneShanghai) once at startup to set the
//	process-wide time.Local, then call logger.Init(&cfg.Log, cfg.Server.Mode)
//	to configure the zap logger. InitTimezone must run before Init so
//	timestamps and daily log rotation boundaries use the correct timezone.
//
// Features:
//   - JSON file output with lumberjack rotation (optional daily filenames)
//   - Colored console output in local/dev/prod modes (stdout info, stderr error)
//   - Sensitive field redaction (LOG_SENSITIVE_FIELDS)
//   - Request ID prefixing and Gin helpers (FromGin, GinZapFields)
//   - Context-aware logging (InfoCtx, ErrorCtx, ...)
//   - SafeGo for panic-safe background goroutines
//   - Log retention purge (PurgeExpiredLogFiles)
package logger
