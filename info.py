import sys
import os
import http.server
import json
import platform
import psutil
import wmi
import pythoncom
import threading
import gpustat
import asyncio
import datetime
import time
import random

try:
    from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
except ImportError:
    print("Please install winsdk: pip install winsdk")
    sys.exit(1)

if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

# A dict to keep the resources data
system_state = {
    "os": "Loading...",
    "cpu_name": "Loading...",
    "gpu_name": "Loading...",
    "ram_total": "Loading...",
    "disk_total":"Loading...",
    "cpu_percent": 0,
    "gpu_percent": 0,
    "ram_percent": 0,
    "ram_used": 0,
    "disk_percent": 0,
    "disk_used": 0,
    "media_title": "Stopped",
    "media_artist": "",
    "media_status": "Closed",
    "media_position": 0,
    "media_duration": 0
}

PORT = 25555

async def get_media_info():
    # Connect to Windows Media OSD
    sessions = await GlobalSystemMediaTransportControlsSessionManager.request_async()
    
    current_session = sessions.get_current_session()
    
    if current_session:
        playback_info = current_session.get_playback_info()
        if playback_info:
            status = playback_info.playback_status # 4=Playing, 5=Paused
        
        # Get Track Info
        try:
            props = await current_session.try_get_media_properties_async()
            title = props.title
            artist = props.artist
        except:
            title = "Unknown"
            artist = "Unknown"

        # Get Timeline (Position/Duration)
        timeline = current_session.get_timeline_properties()
        
        position = 0
        duration = 0
        
        if timeline:
            # winsdk returns datetime.timedelta objects
            position = timeline.position.total_seconds()
            duration = timeline.end_time.total_seconds()

        return {
            "media_title": title,
            "media_artist": artist,
            "media_status": "Playing" if status == 4 else "Paused",
            "media_position": position,
            "media_duration": duration
        }
    else:
        return {
            "media_title": "No Media",
            "media_artist": "",
            "media_status": "Stopped",
            "media_position": 0,
            "media_duration": 0
        }

def get_static():
    global system_state
    pythoncom.CoInitialize()
        
    w = wmi.WMI()
    try:
        os_info = w.Win32_OperatingSystem()[0].Caption
    except:
        os_info = f"{platform.system()} {platform.release()}"
        
    try:
        cpu = w.Win32_Processor()[0]
        cpu_name = cpu.Name.strip()
    except:
        cpu_name = platform.processor()
        
    gpu_info = "Unknown GPU"
    try:
        gpus = w.Win32_VideoController()
        valid_gpus = []
        for gpu in gpus:
            # Filter out some generic drivers if necessary
            valid_gpus.append(gpu.Name)
        
        if valid_gpus:
            # Join multiple GPUs with a separator
            gpu_info = " + ".join(valid_gpus)
    except:
        gpu_info = "Error retrieving GPU"
        
    disk = round(psutil.disk_usage('/').total / (1024.0 ** 3), 1)
    disk_total = f"{disk} GB"
        
    ram_gb = round(psutil.virtual_memory().total / (1024.0 ** 3), 1)
    ram_info = f"{ram_gb} GB"
        
    system_state['os'] = os_info
    system_state['cpu_name'] = cpu_name
    system_state['gpu_name'] = gpu_info
    system_state['disk_total'] = disk_total
    system_state['ram_total'] = ram_info


def monitor():
    global system_state
    
    last_track_title = ""
    cur_pos = 0.0
    prev_skip_position = 0
    reset = False
    startup = True
    
    while True:
        interval = random.uniform(0.55,0.7)
        
        cpu = psutil.cpu_percent(interval = interval)
        gpu_stats = gpustat.GPUStatCollection.new_query()
        for gpu in gpu_stats.gpus:
            # Later adapt to multiple gpu
            gpu_per = gpu.utilization 
        mem = psutil.virtual_memory()
        ram_p = mem.percent
        ram_u = round(mem.used / (1024.0 ** 3) , 1)
        disk_per = psutil.disk_usage('/').percent
        disk_usage = f"{round(psutil.disk_usage('/').used / (1024.0 ** 3), 1)} GB"
        
        try:
            media_data = asyncio.run(get_media_info())
        except:
            media_data = {}
        
        status = media_data['media_status'] # "Playing" or "Paused"
        title = media_data['media_title']
        skipped_position = media_data['media_position']
        
        if startup:
            prev_skip_position = skipped_position + 0.1
            last_track_title = title
            startup = False
        
        '''
        1. Skip on current -> skipped_position will change on where user landed
        2. User skip track -> skipped_position += 5 (?) random, but title != last_track_title, so reset cur_pos
        3. User skip after skipping track -> skipped_postion != prev_skip_position, since we already registered title = last_track_title. Don't reset
        '''
        
        if abs(prev_skip_position - skipped_position) > 0.0000001:
            prev_skip_position = skipped_position
            if title == last_track_title:
                # case 1 and case 3
                if reset == False:
                    cur_pos = skipped_position
                else:
                    reset = False
        
        # Track change
        if title != last_track_title:
            last_track_title = title
            cur_pos = 0
            reset = True
        # Paused
        elif status == 'Paused':
            pass
        else:
            cur_pos += 1
        
        media_data['media_position'] = cur_pos
        system_state.update(media_data)
        
        print(cur_pos)
        
        system_state['cpu_percent'] = cpu
        system_state['gpu_percent'] = gpu_per
        system_state['ram_percent'] = ram_p
        system_state['ram_used'] = ram_u
        system_state['disk_percent'] = disk_per
        system_state['disk_used'] = disk_usage
        
        #print(system_state)
        
class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Silence console logs

    def do_GET(self):
        if self.path == '/specs':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            # Send the current state of the global dictionary
            self.wfile.write(json.dumps(system_state).encode())
        else:
            self.send_response(404)

def run_server():
    t_static = threading.Thread(target=get_static, daemon=True)
    t_static.start()

    t_monitor = threading.Thread(target=monitor, daemon=True)
    t_monitor.start()
    
    # Start the server
    print(f"Server listening on http://127.0.0.1:{PORT}/specs")
    server = http.server.HTTPServer(('127.0.0.1', PORT), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping server...")
        server.server_close()


if __name__ == '__main__':
    run_server()