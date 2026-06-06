package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/byte-v-forge/common-lib/grpchealth"
	"github.com/byte-v-forge/common-lib/natseventbus"
	waappv1 "github.com/byte-v-forge/wa-app/gen/go/byte/v/forge/waapp/v1"
	"github.com/byte-v-forge/wa-app/internal/app"
	"github.com/byte-v-forge/wa-app/internal/config"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := newDurableStore(ctx, cfg)
	if err != nil {
		log.Fatalf("initialize wa-app durable store: %v", err)
	}
	defer store.Close()

	runtime, err := newRuntimeState(ctx, cfg)
	if err != nil {
		log.Fatalf("initialize wa-app runtime state: %v", err)
	}
	defer func() { _ = runtime.Close() }()

	clock := app.SystemClock{}
	ids := app.RandomIDGenerator{}
	engine, err := app.NewNativeEngine(store, clock, ids)
	if err != nil {
		log.Fatalf("initialize wa-app native engine: %v", err)
	}
	service := app.NewServer(store, runtime, engine, clock, ids)
	service.SetDynamicProxyRuntime(app.NewDynamicProxyRuntime(cfg.ProxyRuntimeAPIURL))
	service.SetLongConnectionProxyUsername(cfg.LongConnectionProxyUsername)
	platformBus, err := newPlatformEventBus(cfg)
	if err != nil {
		log.Fatalf("initialize wa-app platform event bus: %v", err)
	}
	if platformBus != nil {
		defer platformBus.Close()
		service.SetPlatformPublisher(platformBus)
	}

	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		log.Fatalf("listen %s: %v", cfg.ListenAddr, err)
	}
	server := grpc.NewServer()
	waappv1.RegisterWaDiscoveryServiceServer(server, service)
	waappv1.RegisterWaProfileServiceServer(server, service)
	waappv1.RegisterWaRegistrationServiceServer(server, service)
	waappv1.RegisterWaMessagingServiceServer(server, service)
	waappv1.RegisterWaExtractionServiceServer(server, service)
	waappv1.RegisterWaToolingServiceServer(server, service)
	waappv1.RegisterWaAccountSettingsServiceServer(server, service)
	grpchealth.RegisterServing(server)

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		log.Printf("wa-app-service listening on %s", cfg.ListenAddr)
		if err := server.Serve(listener); err != nil && groupCtx.Err() == nil {
			return err
		}
		return nil
	})
	group.Go(func() error {
		<-groupCtx.Done()
		server.GracefulStop()
		return nil
	})
	group.Go(func() error {
		return runDashboardHTTP(groupCtx, cfg.DashboardHTTPAddr, cfg.DashboardStaticDir, cfg.N8NWebhookBaseURL, cfg.ProxyRuntimeAPIURL, service, newWAActionHandler(service))
	})
	group.Go(func() error {
		return service.RunLongConnections(groupCtx)
	})
	if err := group.Wait(); err != nil {
		stop()
		log.Fatalf("wa-app-service failed: %v", err)
	}
}

func newDurableStore(ctx context.Context, cfg config.Config) (app.Store, error) {
	if strings.TrimSpace(cfg.PGDSN) != "" {
		return app.NewPostgresStore(ctx, cfg.PGDSN)
	}
	log.Printf("WA_APP_PG_DSN is not configured; wa-app uses sqlite durable store in %s", cfg.DataDir)
	return app.NewSQLiteStore(ctx, cfg.DataDir)
}

func newRuntimeState(ctx context.Context, cfg config.Config) (app.RuntimeState, error) {
	if strings.TrimSpace(cfg.RedisURL) != "" {
		return app.NewRedisRuntime(ctx, cfg.RedisURL)
	}
	log.Printf("PLATFORM_REDIS_URL is not configured; wa-app uses sqlite runtime state in %s", cfg.DataDir)
	return app.NewSQLiteRuntime(ctx, cfg.DataDir)
}

func newPlatformEventBus(cfg config.Config) (*natseventbus.Bus, error) {
	if strings.TrimSpace(cfg.PlatformNATSURL) == "" {
		log.Printf("PLATFORM_NATS_URL is not configured; WA platform events are disabled")
		return nil, nil
	}
	return natseventbus.ConnectRequired(
		natseventbus.Config{URL: cfg.PlatformNATSURL, ClientName: "wa-app-service"},
		"connect WA platform events",
	)
}
