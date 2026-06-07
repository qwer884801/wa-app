package config

import (
	"github.com/byte-v-forge/common-lib/envx"
)

type Config struct {
	ListenAddr                   string
	DashboardHTTPAddr            string
	DashboardStaticDir           string
	N8NWebhookBaseURL            string
	ProxyRuntimeAPIURL           string
	ProxyRuntimeLocalProtocol    string
	LongConnectionProxyUsername  string
	NumberProbeProxyUsername     string
	RegistrationProxyUsername    string
	AccountSettingsProxyUsername string
	LoginStateCheckProxyUsername string
	PlatformNATSURL              string
	PGDSN                        string
	RedisURL                     string
	DataDir                      string
}

func Load() Config {
	return Config{
		ListenAddr:                   envx.StringDefault("WA_APP_LISTEN_ADDR", ":50091"),
		DashboardHTTPAddr:            envx.StringDefault("WA_APP_DASHBOARD_HTTP_ADDR", ":8080"),
		DashboardStaticDir:           envx.StringDefault("WA_APP_DASHBOARD_STATIC_DIR", "/app/dashboard/wa"),
		N8NWebhookBaseURL:            envx.StringDefault("WA_N8N_WEBHOOK_BASE_URL", ""),
		ProxyRuntimeAPIURL:           envx.StringDefault("PROXY_RUNTIME_API_BASE_URL", ""),
		ProxyRuntimeLocalProtocol:    envx.StringDefault("PROXY_RUNTIME_LOCAL_PROTOCOL", "socks5"),
		LongConnectionProxyUsername:  envx.StringDefault("WA_LONG_CONNECTION_PROXY_USERNAME", "whatsapp"),
		NumberProbeProxyUsername:     envx.StringDefault("WA_NUMBER_PROBE_PROXY_USERNAME", "whatsapp-probe"),
		RegistrationProxyUsername:    envx.StringDefault("WA_REGISTRATION_PROXY_USERNAME", "whatsapp-reg"),
		AccountSettingsProxyUsername: envx.StringDefault("WA_ACCOUNT_SETTINGS_PROXY_USERNAME", "whatsapp-reg"),
		LoginStateCheckProxyUsername: envx.StringDefault("WA_LOGIN_STATE_CHECK_PROXY_USERNAME", "whatsapp-reg"),
		PlatformNATSURL:              envx.StringDefault("PLATFORM_NATS_URL", ""),
		PGDSN:                        envx.StringDefault("WA_APP_PG_DSN", ""),
		RedisURL:                     envx.StringDefault("PLATFORM_REDIS_URL", ""),
		DataDir:                      envx.StringDefault("WA_APP_DATA_DIR", "/var/lib/wa-app"),
	}
}
