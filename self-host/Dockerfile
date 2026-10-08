FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /work && chown 1000:1000 /work
USER 1000:1000
WORKDIR /work
CMD ["sleep", "infinity"]
