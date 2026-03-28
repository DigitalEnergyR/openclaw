# CODESYS Virtual Control SL

**Your PLC in a container** - Run a CODESYS Virtual Control SL soft-PLC runtime as a Docker container and interact with it through OPC UA, all managed by OpenClaw.

## What is CODESYS Virtual Control SL?

CODESYS Virtual Control SL is a software PLC (Programmable Logic Controller) that runs entirely in software, inside a Docker container. It provides a full IEC 61131-3 runtime environment that you can program using the CODESYS IDE, with OPC UA as the primary communication interface.

## Architecture

```
┌────────────────────────────────┐
│         OpenClaw Agent         │
│  (plc_read, plc_write, etc.)  │
└──────────┬─────────────────────┘
           │ OPC UA (port 4840)
           ▼
┌────────────────────────────────┐
│  CODESYS Virtual Control SL   │
│  ┌──────────────────────────┐  │
│  │   IEC 61131-3 Runtime    │  │
│  │   (Structured Text, LD,  │  │
│  │    FBD, IL, SFC, CFC)    │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │     OPC UA Server        │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │   Web Visualization      │  │
│  └──────────────────────────┘  │
│         Docker Container       │
└────────────────────────────────┘
```

## Quick Start

### 1. Start the PLC container

```bash
docker compose -f extensions/codesys-virtual-control/docker-compose.yml up -d
```

### 2. Enable the extension in OpenClaw config

```json
{
  "plugins": {
    "codesys-virtual-control": {
      "enabled": true
    }
  }
}
```

### 3. Use the tools

Once running, the following agent tools are available:

| Tool | Description |
|------|-------------|
| `plc_status` | Check container and OPC UA connection status |
| `plc_start` | Start the CODESYS container |
| `plc_stop` | Stop the CODESYS container |
| `plc_logs` | View container logs |
| `plc_connect` | Connect OPC UA client to the runtime |
| `plc_read` | Read PLC variables via OPC UA |
| `plc_write` | Write values to PLC variables |
| `plc_browse` | Browse the OPC UA address space |
| `plc_call_method` | Call OPC UA methods |

## Configuration

All settings are optional and have sensible defaults:

```json
{
  "plugins": {
    "codesys-virtual-control": {
      "image": "codesys/codesys-virtual-control-sl:latest",
      "containerName": "codesys-virtual-plc",
      "opcuaEndpoint": "opc.tcp://localhost:4840",
      "autoStart": true,
      "ports": {
        "opcua": 4840,
        "gateway": 11740,
        "webVisu": 8080
      }
    }
  }
}
```

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 4840 | OPC UA | Primary communication channel for reading/writing PLC variables |
| 11740 | CODESYS Gateway | Connect from the CODESYS IDE to deploy/debug applications |
| 8080 | Web Visualization | Browser-based HMI for CODESYS web visualizations |

## OPC UA Node IDs

CODESYS exposes PLC variables through OPC UA with node IDs following the pattern:

```
ns=4;s=Application.PLC_PRG.myVariable
```

Use `plc_browse` to discover available nodes in the address space.

## Requirements

- Docker (or Podman) installed and running
- The CODESYS Virtual Control SL container requires `--privileged` mode
- A valid CODESYS license for production use (evaluation mode available)
