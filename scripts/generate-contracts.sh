#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROTOC_GEN_GO:=protoc-gen-go}"
: "${PROTOC_GEN_GO_GRPC:=protoc-gen-go-grpc}"
.venv/bin/python -m grpc_tools.protoc -I packages/contracts/proto \
  --plugin="protoc-gen-go=$(command -v "$PROTOC_GEN_GO")" \
  --plugin="protoc-gen-go-grpc=$(command -v "$PROTOC_GEN_GO_GRPC")" \
  --python_out=packages/contracts/gen/python --grpc_python_out=packages/contracts/gen/python \
  --go_out=packages/contracts/gen/go --go_opt=paths=source_relative \
  --go-grpc_out=packages/contracts/gen/go --go-grpc_opt=paths=source_relative \
  packages/contracts/proto/twin.proto
.venv/bin/python scripts/generate_contract_docs.py
