![Thumbnail](./demo_new.gif)

# SysMonitor

SysMonitor is a background Windows service and companion backend for Wallpaper Engine and custom desktop widgets. It streams real-time hardware telemetry and hooks into Windows System Media Transport Controls (SMTC) to deliver event-driven media sync, timeline tracking, lyrics alignment, and remote playback control.

It provides both a low-latency **WebSocket server (port 25556)** for real-time media events and an **HTTP REST API (port 25555)** for hardware metrics, system controls, and asset conversion.

---

## Features

- **Event-Driven Media Sync:** Subscribes directly to Windows SMTC events (`PlaybackInfoChanged`, `MediaPropertiesChanged`, `TimelinePropertiesChanged`) for instant state updates.
- **WebSocket Streaming:** Pushes track changes, play/pause states, and timeline snapshots down an open socket (`ws://127.0.0.1:25556`) with sub-millisecond latency.
- **Hardware Telemetry:** Monitors CPU, GPU (NVIDIA NVML), RAM, and Disk metrics via `psutil`, `wmi`, and `pynvml`.
- **Bidirectional Media Controls:** Native Windows media controls (Play/Pause, Next, Previous, Seek) accessible via WebSocket messages or HTTP endpoints.
- **Video Conversion & Proxy:** Built-in background ffmpeg converter for local WebM conversion and video streaming with range-request support.
- **Auto-Startup:** Automatically registers with the current user's Windows startup registry key on launch.

---

## Installation & Running

### Option 1: Running the Prebuilt Executable

1. Download `SysMonitor.exe` into your project folder.
2. Double-click `SysMonitor.exe` to start the service.
3. *Note on Antivirus:* Because the service registers itself into the user's startup key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), Windows Defender or antivirus software may show a prompt on first run.

### Option 2: Running from Source

**Prerequisites:** Python 3.10+ on Windows 10/11.

```powershell
# Create virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Install required dependencies
pip install -r requirements.txt

# Start the monitor
python SysMonitor.py
```

---

## Building the Executable (.exe)

To bundle the script into a single, windowless background executable:

```powershell
# Using PyInstaller directly
pyinstaller --onefile --noconsole SysMonitor.py

# Or using the included spec file
pyinstaller SysMonitor.spec
```

The compiled binary will be placed in `dist/SysMonitor.exe`.

---

## API Reference

### 1. WebSocket Interface (`ws://127.0.0.1:25556`)

Connect to `ws://127.0.0.1:25556` for sub-millisecond media updates.

#### Incoming Messages (Server -> Client)
Sent immediately upon connection and whenever track, playback status, or seek position changes:

```json
{
  "type": "media_update",
  "media_title": "Track Title",
  "media_artist": "Artist Name",
  "media_status": "Playing",
  "media_position": 42.5,
  "media_duration": 210.0,
  "server_time": 1725450000.123
}
```

#### Outgoing Commands (Client -> Server)
Send JSON payloads over the socket for instant control:

- **Play / Pause:** `{ "action": "playpause" }`
- **Next Track:** `{ "action": "next" }`
- **Previous Track:** `{ "action": "prev" }`
- **Seek:** `{ "action": "seek", "pos": 120.0 }`

---

### 2. HTTP REST API (`http://127.0.0.1:25555`)

#### System & Media Specs
- **Endpoint:** `GET /specs`
- **Description:** Returns current hardware specifications, utilization percentages, volume, and media state.

**Example Response:**
```json
{
  "os": "Microsoft Windows 11 Pro",
  "cpu_name": "AMD Ryzen 7 5800X 8-Core Processor",
  "gpu_name": "NVIDIA GeForce RTX 3080",
  "ram_total": "32.0 GB",
  "disk_total": "1000.5 GB",
  "cpu_percent": 14.2,
  "gpu_percent": 6,
  "ram_percent": 42.1,
  "ram_used": 13.5,
  "disk_percent": 58.4,
  "disk_used": "584.2 GB",
  "sys_volume": 45,
  "media_title": "Song Title",
  "media_artist": "Artist",
  "media_status": "Playing",
  "media_position": 45.2,
  "media_duration": 212.0
}
```

#### Media Controls
- `GET /media/playpause` — Toggle playback.
- `GET /media/next` — Skip to next track.
- `GET /media/prev` — Return to previous track.
- `GET /media/seek?pos={seconds}` — Seek track to target second.
- `GET /media/volume?val={0-100}` — Set system master volume.

#### Utilities & Media Storage
- `GET /media/browse` — Opens native Windows file dialog to select background media.
- `GET /media/convert?path={filepath}` — Converts MP4 to background WebM via ffmpeg.
- `GET /video_proxy?path={filepath}` — Streams video file with byte-range HTTP streaming support.
- `GET /media/pixiv_load` / `POST /media/pixiv_save` — Reads/saves ranking index state.
- `GET /media/pixiv_fav_load` / `POST /media/pixiv_fav_save` — Reads/saves favorites list.

---

## Polling & Update Intervals

To ensure low CPU overhead while remaining responsive:
- **WebSocket media updates:** Event-driven (near 0 ms delay).
- **CPU & Volume:** Sampled every second.
- **GPU & RAM:** Sampled every 3 seconds.
- **Disk Usage:** Sampled once per minute.

