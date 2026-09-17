package httpapi

import (
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type computeIdentity string

func (c computeIdentity) GetRequestMetadata(context.Context, ...string) (map[string]string, error) {
	return map[string]string{"x-service-token": string(c)}, nil
}

// Private listeners are loopback-only. Shared hosts must provide TLS transport.
func (c computeIdentity) RequireTransportSecurity() bool { return false }
func (s *Server) computeOptions() []grpc.DialOption {
	options := []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	if s.ComputeToken != "" {
		options = append(options, grpc.WithPerRPCCredentials(computeIdentity(s.ComputeToken)))
	}
	return options
}
