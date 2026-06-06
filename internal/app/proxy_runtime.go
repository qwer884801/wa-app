package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	proxyruntimev1 "github.com/byte-v-forge/common-lib/gen/go/byte/v/forge/contracts/proxyruntime/v1"
	"github.com/byte-v-forge/common-lib/protojsonx"
	waappv1 "github.com/byte-v-forge/wa-app/gen/go/byte/v/forge/waapp/v1"
	"google.golang.org/protobuf/types/known/durationpb"
)

type DynamicProxyLease struct {
	AccountID string
	LeaseID   string
	ProxyURL  string
	ExpiresAt time.Time
}

type DynamicProxySessionMode string

const (
	DynamicProxySessionModeRotating DynamicProxySessionMode = "rotating"
	DynamicProxySessionModeSticky   DynamicProxySessionMode = "sticky"
)

type DynamicProxyLeaseRequest struct {
	Purpose       string
	CorrelationID string
	TTL           time.Duration
	Mode          DynamicProxySessionMode
}

type DynamicProxyRuntime struct {
	baseURL string
	client  *http.Client
}

const proxyRuntimeGatewayPort = "10810"

func NewDynamicProxyRuntime(baseURL string) *DynamicProxyRuntime {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}
	return &DynamicProxyRuntime{baseURL: baseURL, client: &http.Client{Timeout: 20 * time.Second}}
}

func (p *DynamicProxyRuntime) AcquireUSDynamicLease(ctx context.Context, leaseReq DynamicProxyLeaseRequest) (DynamicProxyLease, error) {
	if p == nil || p.baseURL == "" {
		return DynamicProxyLease{}, NewError(waappv1.WaErrorCode_WA_ERROR_CODE_VALIDATION_FAILED, "PROXY_RUNTIME_API_BASE_URL is required", false)
	}
	endpoint, err := p.endpoint("/leases/acquire")
	if err != nil {
		return DynamicProxyLease{}, err
	}
	purpose := firstNonEmpty(leaseReq.Purpose, "WA_DYNAMIC_PROXY")
	requestBody := &proxyruntimev1.AcquireProxyLeaseRequest{
		AccountId:       proxyLeaseAccountID(purpose, leaseReq.CorrelationID),
		Purpose:         purpose,
		ForceNew:        true,
		Policy:          proxyLeaseSessionPolicy(leaseReq),
		SelectionPolicy: &proxyruntimev1.ProxyDynamicIPSelectionPolicy{CountryCode: "US", Purpose: purpose, MaxAttempts: 10},
	}
	data, err := protojsonx.Marshal(requestBody)
	if err != nil {
		return DynamicProxyLease{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return DynamicProxyLease{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return DynamicProxyLease{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DynamicProxyLease{}, proxyRuntimeRouteError("dynamic lease", resp.StatusCode, body)
	}
	var acquired proxyruntimev1.AcquireProxyLeaseResponse
	if err := protojsonx.Unmarshal(body, &acquired); err != nil {
		return DynamicProxyLease{}, err
	}
	lease := acquired.GetLease()
	egress := acquired.GetEgress()
	if egress == nil {
		egress = lease.GetEgress()
	}
	proxyURL, err := p.dynamicLeaseProxyURL(egress)
	if err != nil {
		return DynamicProxyLease{}, err
	}
	expiresAt := time.Time{}
	if lease.GetExpiresAt() != nil {
		expiresAt = lease.GetExpiresAt().AsTime()
	}
	if expiresAt.IsZero() && leaseReq.TTL > 0 {
		expiresAt = time.Now().UTC().Add(leaseReq.TTL)
	}
	return DynamicProxyLease{AccountID: lease.GetAccountId(), LeaseID: lease.GetLeaseId(), ProxyURL: proxyURL, ExpiresAt: expiresAt}, nil
}

func (p *DynamicProxyRuntime) GatewayProxyURL(ctx context.Context, username string) (string, error) {
	if p == nil || p.baseURL == "" {
		return "", NewError(waappv1.WaErrorCode_WA_ERROR_CODE_VALIDATION_FAILED, "PROXY_RUNTIME_API_BASE_URL is required", false)
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return "", NewError(waappv1.WaErrorCode_WA_ERROR_CODE_VALIDATION_FAILED, "gateway username is required", false)
	}
	endpoint, err := p.endpoint("/settings/in-user-rules")
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", proxyRuntimeRouteError("gateway ingress", resp.StatusCode, body)
	}
	var settings proxyruntimev1.GetProxyRuntimeSettingsResponse
	if err := protojsonx.Unmarshal(body, &settings); err != nil {
		return "", err
	}
	for _, rule := range settings.GetSettings().GetIngressRules() {
		if !rule.GetEnabled() || strings.TrimSpace(rule.GetUsername()) != username {
			continue
		}
		return p.gatewayProxyURL(username, rule.GetPasswordValue())
	}
	return "", NewError(waappv1.WaErrorCode_WA_ERROR_CODE_ROUTE_UNAVAILABLE, fmt.Sprintf("proxy-runtime gateway user %q is unavailable", username), true)
}

func (p *DynamicProxyRuntime) ReleaseLease(ctx context.Context, lease DynamicProxyLease) {
	if p == nil || (strings.TrimSpace(lease.LeaseID) == "" && strings.TrimSpace(lease.AccountID) == "") {
		return
	}
	endpoint, err := p.endpoint("/leases/release")
	if err != nil {
		return
	}
	payload := map[string]string{}
	if strings.TrimSpace(lease.LeaseID) != "" {
		payload["lease_id"] = strings.TrimSpace(lease.LeaseID)
	} else {
		payload["account_id"] = strings.TrimSpace(lease.AccountID)
	}
	data, _ := json.Marshal(payload)
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err == nil && resp != nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		_ = resp.Body.Close()
	}
}

func (p *DynamicProxyRuntime) endpoint(path string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(p.baseURL), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid PROXY_RUNTIME_API_BASE_URL")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func proxyLeaseSessionPolicy(req DynamicProxyLeaseRequest) *proxyruntimev1.ProxySessionPolicy {
	policy := &proxyruntimev1.ProxySessionPolicy{
		Region:       "US",
		UpstreamKind: proxyruntimev1.ProxyUpstreamKind_PROXY_UPSTREAM_KIND_DYNAMIC_IP,
		Labels: map[string]string{
			"country_code": "US",
			"purpose":      firstNonEmpty(req.Purpose, "WA_DYNAMIC_PROXY"),
		},
	}
	if req.CorrelationID != "" {
		policy.Labels["correlation_id"] = req.CorrelationID
	}
	switch req.Mode {
	case DynamicProxySessionModeRotating:
		policy.Mode = proxyruntimev1.ProxySessionMode_PROXY_SESSION_MODE_ROTATING
		policy.RotationMode = proxyruntimev1.ProxyRotationMode_PROXY_ROTATION_MODE_PER_REQUEST
		if req.TTL > 0 {
			policy.StickyTtl = durationpb.New(req.TTL.Round(time.Second))
		}
	default:
		policy.Mode = proxyruntimev1.ProxySessionMode_PROXY_SESSION_MODE_STICKY
		policy.RotationMode = proxyruntimev1.ProxyRotationMode_PROXY_ROTATION_MODE_STICKY_SESSION
		ttl := req.TTL
		if ttl <= 0 {
			ttl = 10 * time.Minute
		}
		policy.StickyTtl = durationpb.New(ttl.Round(time.Second))
	}
	return policy
}

func proxyLeaseAccountID(purpose string, correlationID string) string {
	prefix := safeProxyLeaseToken(firstNonEmpty(purpose, "wa-dynamic-proxy"))
	seed := strings.Join([]string{purpose, correlationID, strconv.FormatInt(time.Now().UnixNano(), 10)}, ":")
	return "wa-" + prefix + "-" + stableID(seed)
}

func safeProxyLeaseToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			out.WriteRune(char)
		case char >= '0' && char <= '9':
			out.WriteRune(char)
		case char == '-' || char == '_':
			out.WriteByte('-')
		}
	}
	token := strings.Trim(out.String(), "-")
	if token == "" {
		return "dynamic"
	}
	if len(token) > 48 {
		return token[:48]
	}
	return token
}

func (p *DynamicProxyRuntime) dynamicLeaseProxyURL(endpoint *proxyruntimev1.ProxyEndpoint) (string, error) {
	if endpoint == nil || endpoint.GetPort() == 0 {
		return "", fmt.Errorf("proxy-runtime dynamic lease has no egress endpoint")
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(p.baseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("invalid PROXY_RUNTIME_API_BASE_URL")
	}
	host := strings.TrimSpace(endpoint.GetHost())
	if isLocalProxyHost(host) {
		host = base.Hostname()
	}
	if host == "" {
		return "", fmt.Errorf("proxy-runtime dynamic lease has no egress host")
	}
	labels := endpoint.GetLabels()
	proxyURL := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort(host, strconv.Itoa(int(endpoint.GetPort()))),
	}
	if username := strings.TrimSpace(labels["proxy_username"]); username != "" {
		proxyURL.User = url.UserPassword(username, labels["proxy_password"])
	}
	return proxyURL.String(), nil
}

func (p *DynamicProxyRuntime) gatewayProxyURL(username string, password string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(p.baseURL), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid PROXY_RUNTIME_API_BASE_URL")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", fmt.Errorf("invalid PROXY_RUNTIME_API_BASE_URL")
	}
	gateway := &url.URL{
		Scheme: "http",
		User:   url.UserPassword(username, password),
		Host:   net.JoinHostPort(host, proxyRuntimeGatewayPort),
	}
	return gateway.String(), nil
}

func isLocalProxyHost(host string) bool {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	return host == "" || host == "0.0.0.0" || host == "127.0.0.1" || host == "localhost" || host == "::" || host == "::1"
}

func proxyRuntimeRouteError(resource string, statusCode int, body []byte) error {
	message := fmt.Sprintf("proxy-runtime %s unavailable: HTTP %d", strings.TrimSpace(resource), statusCode)
	if detail := proxyRuntimeErrorDetail(body); detail != "" {
		message += ": " + detail
	}
	return NewError(waappv1.WaErrorCode_WA_ERROR_CODE_ROUTE_UNAVAILABLE, message, true)
}

func proxyRuntimeErrorDetail(body []byte) string {
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	detail := strings.Join(strings.Fields(payload.Message), " ")
	if detail == "" || strings.Contains(detail, "://") {
		return ""
	}
	const maxDetailLength = 180
	if len(detail) > maxDetailLength {
		return detail[:maxDetailLength]
	}
	return detail
}
