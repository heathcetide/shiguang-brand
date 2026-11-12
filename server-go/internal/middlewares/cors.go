package middlewares

import "strings"

// ResolveCORSOrigins keeps explicit allowlists authoritative and never adds
// development origins in production. Local defaults match Expo Web and Vite.
func ResolveCORSOrigins(environment, configured string) string {
	if configured != "" || environment == "prod" {
		return configured
	}
	return strings.Join([]string{
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"http://localhost:8081",
		"http://127.0.0.1:8081",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:19006",
		"http://127.0.0.1:19006",
	}, ",")
}
