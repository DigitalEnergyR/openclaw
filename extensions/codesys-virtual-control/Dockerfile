# CODESYS Virtual Control SL - Containerized PLC Runtime
#
# This Dockerfile provides a ready-to-use CODESYS Virtual Control SL image
# with OPC UA enabled by default. The official CODESYS image is used as the
# base; this layer adds the default configuration for OpenClaw integration.
#
# Usage:
#   docker build -t openclaw/codesys-virtual-control -f extensions/codesys-virtual-control/Dockerfile .
#   docker run -d --name codesys-virtual-plc \
#     --privileged \
#     -p 4840:4840 \
#     -p 11740:11740 \
#     -p 8080:8080 \
#     openclaw/codesys-virtual-control
#
# Ports:
#   4840  - OPC UA server (primary communication channel)
#   11740 - CODESYS gateway (for IDE connection)
#   8080  - Web visualization
#
# The container requires --privileged for the CODESYS runtime to manage
# its internal real-time scheduling and shared memory.

FROM codesys/codesys-virtual-control-sl:latest

LABEL org.opencontainers.image.title="CODESYS Virtual Control SL"
LABEL org.opencontainers.image.description="Your PLC in a container - CODESYS Virtual Control SL with OPC UA for OpenClaw integration"
LABEL org.opencontainers.image.vendor="OpenClaw"

# OPC UA server
EXPOSE 4840/tcp
# CODESYS gateway
EXPOSE 11740/tcp
# Web visualization
EXPOSE 8080/tcp

# Health check: verify OPC UA port is listening
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD nc -z localhost 4840 || exit 1
