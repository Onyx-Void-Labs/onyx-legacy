FROM rust:1.82-slim AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src/ ./src/
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/onyx-home-station /usr/local/bin/onyx-station

ENV ONYX_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 4433/udp

ENTRYPOINT ["onyx-station"]
CMD ["run"]
