![Thumbnail](./demo_new.gif)

# SysMonitor API

SysMonitor is a lightweight, background Windows service built in Python. It continuously monitors your system's hardware utilization (CPU, GPU, RAM, and Disk) and hooks into the Windows Global System Media Transport Controls to provide real-time media playback information. 

It exposes all of this data—along with media playback controls—via a local HTTP REST API on port `25555`.

## Features

* **Hardware Monitoring:** Real-time stats for CPU, GPU, RAM, and Disk usage using `psutil`, `wmi`, and `gpustat`.
* **Media Tracking:** Real-time tracking of the currently playing media (Title, Artist, Status, Position, Duration) via Windows SDK.
* **Media Controls:** Play, pause, skip, and seek tracks remotely through API endpoints.

## Installation & Usage

### Running the Executable
1. Download the `SysMonitor.exe` file.
2. Double-click it to run. 
3. *Note:* Because the script automatically adds itself to the Windows startup registry (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), your antivirus or Windows Defender might flag it. This is normal behavior for startup scripts.

### Get System & Media Specs

**Endpoint:** `GET /specs`

Returns a JSON object containing the current static hardware names, real-time usage percentages, and current media playback status.

**Example Response:**

```json
{
    "os": "Microsoft Windows 11 Pro",
    "cpu_name": "AMD Ryzen 7 5800X 8-Core Processor",
    "gpu_name": "NVIDIA GeForce RTX 3080",
    "ram_total": "32.0 GB",
    "disk_total": "1000.5 GB",
    "cpu_percent": 15.2,
    "gpu_percent": 8,
    "ram_percent": 45.0,
    "ram_used": 14.4,
    "disk_percent": 60.1,
    "disk_used": "601.3 GB",
    "media_title": "Never Gonna Give You Up",
    "media_artist": "Rick Astley",
    "media_status": "Playing",
    "media_position": 45.2,
    "media_duration": 212.0
}
```

To minimize overhead, CPU is checked every second, media text every 2 seconds, GPU/RAM every 3 seconds, and disk usage once a minute.

### Media Controls

You can control your Windows media playback by sending GET requests to the following endpoints. This works with Spotify, YouTube (via supported browsers), Apple Music, and most native Windows media players.
- Play / Pause:
```GET /media/playpause```
- Next Track:
```GET /media/next```
- Previous Track:
```GET /media/prev```
- Seek to Specific Time:
```GET /media/seek?pos={seconds}```
(Example: http://127.0.0.1:25555/media/seek?pos=120 will skip exactly to the 2-minute mark of the current track).
