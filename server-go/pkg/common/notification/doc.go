// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package notification provides a unified, provider-agnostic notification
// framework supporting email, SMS, instant messaging (IM), webhooks, and
// in-app inbox messages.
//
// # Architecture
//
// The core abstraction is the [Channel] interface. Each channel type
// (email, SMS, IM, webhook, inbox) implements this interface with its
// own provider subpackages:
//
//   - notification/email   — SMTP and cloud email providers
//   - notification/sms     — 17+ SMS providers (Aliyun, Tencent, Twilio, ...)
//   - notification/im      — WeCom, Feishu/Lark
//   - notification/webhook — HTTP callback dispatcher with retry
//   - notification/inbox   — In-app notification store
//
// A [Dispatcher] manages multiple channels and provides multi-channel
// failover: if one channel fails, the next enabled channel is tried.
//
// # Decoupled design
//
// Unlike monolithic notification systems, this package has no hard
// dependency on a specific database or ORM. Logging and template loading
// are pluggable via the [LogStore] and [TemplateStore] interfaces.
// Applications wire concrete implementations (e.g. a gorm-backed store)
// at startup.
//
// # Quick start
//
//	dispatcher := notification.NewDispatcher()
//	dispatcher.AddChannel("email-primary", emailChannel)
//	dispatcher.AddChannel("email-backup", emailBackupChannel)
//
//	err := dispatcher.Send(ctx, notification.Message{
//	    Type:    notification.TypeEmail,
//	    To:      "user@example.com",
//	    Subject: "Welcome",
//	    Body:    "Hello!",
//	})
package notification
