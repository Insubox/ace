# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f cloud/Dockerfile .
FROM rust:1.99.0-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
COPY applications ./applications
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export CARGO_HTTP_CAINFO=/run/secrets/proxy_ca; fi; \
    cargo +1.99.0 build --release --locked -p ace-cli

# Version must match @cloudflare/sandbox in package-lock.json.
FROM docker.io/cloudflare/sandbox:1.0.0 AS sandbox-tools
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=build /src/target/release/ace /usr/local/bin/ace
COPY --chmod=0644 cloud/export_run.py /opt/ace/export_run.py
COPY --chmod=0644 cloud/export_native.py /opt/ace/export_native.py
RUN chmod 0755 /opt/ace && mkdir -p /workspace && chown 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000
CMD ["sleep", "infinity"]
