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
