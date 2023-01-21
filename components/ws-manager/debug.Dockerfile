FROM cgr.dev/chainguard/wolfi-base:latest

# Ensure latest packages are present, like security updates.
RUN  apk upgrade --no-cache \
  && apk add --no-cache ca-certificates

COPY ws-manager /app/ws-manager
ENTRYPOINT [ "/app/ws-manager" ]
CMD [ "-v", "help" ]