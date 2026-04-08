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
import ctypes
from urllib.parse import urlparse, parse_qs
import winreg

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

# Cache the media manager globally
media_manager = None
seek_target = None
seek_time = 0

cached_title = ""
cached_artist = ""

async def get_media_info(fetch_text = False):
    global media_manager, cached_title, cached_artist
    
    # Only ask Windows for the manager once
    if media_manager is None:
        try:
            media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        except Exception:
            return system_state # Fallback if Windows media is unavailable
    
    current_session = media_manager.get_current_session()
    
    if current_session:
        playback_info = current_session.get_playback_info()
        status = playback_info.playback_status if playback_info else 0 # 4=Playing, 5=Paused
        
        if status == 4:
            status_str = "Playing"
        elif status == 5:
            status_str = "Paused"
        else:
            status_str = "Stopped"
        
        if fetch_text:
            try:
                props = await current_session.try_get_media_properties_async()
                cached_title = props.title
                cached_artist = props.artist
            except:
                pass
            
        if status_str == "Stopped":
            cached_title = "No Media"
            cached_artist = ""

        timeline = current_session.get_timeline_properties()
        position = timeline.position.total_seconds() if timeline else 0
        duration = timeline.end_time.total_seconds() if timeline else 0

        return {
            "media_title": cached_title,
            "media_artist": cached_artist,
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
        valid_gpus = [gpu.Name for gpu in gpus]
        if valid_gpus:
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
    global system_state, seek_target, seek_time
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    last_track_title = ""
    cur_pos = 0.0
    prev_skip_position = 0
    last_seek_target = -999.0
    reset = False
    startup = True
    
    # "Prime" the CPU reader outside the loop
    psutil.cpu_percent(interval=None)
    
    tick = 0
    last_tick_time = time.time()
    
    while True:
        # Check media fast
        time.sleep(0.25)
        
        current_time = time.time()
        dt = current_time - last_tick_time
        last_tick_time = current_time
        
        # CPU check every sec
        if tick % 4 == 0:
            system_state['cpu_percent'] = psutil.cpu_percent(interval=None)
        
        # fetch every 8th, 2sec
        should_fetch_text = (tick % 8 == 0) or startup
        
        try:
            media_data = loop.run_until_complete(get_media_info(fetch_text=should_fetch_text))
        except:
            media_data = {}
        
        status = media_data.get('media_status', 'Stopped')
        title = media_data.get('media_title', '')
        skipped_position = media_data.get('media_position', 0)
        
        # Instantly apply custom seek from the frontend
        if seek_target is not None:
            cur_pos = seek_target
            last_seek_target = seek_target # track the requested pos
            seek_target = None
            
        if startup:
            prev_skip_position = skipped_position + 0.1
            last_track_title = title
            startup = False
            
        # Block the Windows API from sending old data for 4s after seeking
        ignore_smtc = (current_time - seek_time < 4.0)

        # always track api  
        if abs(prev_skip_position - skipped_position) > 0.0000001:
            # If we get a new position from Windows, but it exactly matches the seek we just performed,
            # it is just a severely delayed "echo" ping from the media player. We flag it to be ignored
            is_echo = (abs(skipped_position - last_seek_target) < 3.0) and (current_time - seek_time < 15.0)
            
            if not ignore_smtc and not is_echo: # Only allow it to drag the clock if we are NOT in cooldown
                if title == last_track_title:
                    if reset == False:
                        cur_pos = skipped_position
                    else:
                        reset = False
            prev_skip_position = skipped_position # Always keep track of what Windows says
            
        if title != last_track_title:
            last_track_title = title
            cur_pos = 0
            reset = True
        elif status == 'Playing':
            cur_pos += dt
        elif status == 'Stopped':
            cur_pos = 0
            # Force everything to blank states
            media_data['media_title'] = "No Media"
            media_data['media_artist'] = ""
            media_data['media_duration'] = 0
        
        media_data['media_position'] = cur_pos
        system_state.update(media_data)
        
        #print(f"[Python] Windows API: {skipped_position:.2f}s | Python Sending: {cur_pos:.2f}s | Status: {status} | Ignoring API: {ignore_smtc}")
        # check gpu and ram every 3rd loop 
        if tick % 12 == 0:
            try:
                gpu_stats = gpustat.GPUStatCollection.new_query()
                system_state['gpu_percent'] = gpu_stats.gpus[0].utilization if gpu_stats.gpus else 0
            except:
                pass
                
            mem = psutil.virtual_memory()
            system_state['ram_percent'] = mem.percent
            system_state['ram_used'] = round(mem.used / (1024.0 ** 3) , 1)
            
        # check the disk every minute
        if tick % 240 == 0:
            try:
                system_state['disk_percent'] = psutil.disk_usage('/').percent
                system_state['disk_used'] = f"{round(psutil.disk_usage('/').used / (1024.0 ** 3), 1)} GB"
            except:
                pass 
            
        tick += 1
        if tick > 1000: 
            tick = 0

def media_command(command):
    if command == "playpause":
        VK_CODE = 0xB3 
    elif command == "next":
        VK_CODE = 0xB0 
    elif command == "prev":
        VK_CODE = 0xB1 
    else:
        return
        
    ctypes.windll.user32.keybd_event(VK_CODE, 0, 0, 0) 
    ctypes.windll.user32.keybd_event(VK_CODE, 0, 2, 0) 
        
async def media_seek(position_seconds):
    global media_manager
    if media_manager is None:
        media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        
    current_session = media_manager.get_current_session()
    
    if current_session:
        try:
            ticks = int(position_seconds * 10000000)
            await current_session.try_change_playback_position_async(ticks)
        except Exception as e:
            print(f"Seek failed: {e}")
        
class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/specs':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(system_state).encode())
            
        elif parsed_path.path == '/media/playpause':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("playpause")
            
        elif parsed_path.path == '/media/next':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("next")
            
        elif parsed_path.path == '/media/prev':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("prev")
            
        elif parsed_path.path == '/media/seek':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            query_components = parse_qs(parsed_path.query)
            if 'pos' in query_components:
                try:
                    pos_sec = float(query_components['pos'][0])
                    global seek_target, seek_time
                    seek_target = pos_sec
                    seek_time = time.time()
                    # Create a quick loop to execute the seek
                    seek_loop = asyncio.new_event_loop()
                    seek_loop.run_until_complete(media_seek(pos_sec))
                    seek_loop.close()
                except ValueError:
                    pass
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    t_static = threading.Thread(target=get_static, daemon=True)
    t_static.start()

    t_monitor = threading.Thread(target=monitor, daemon=True)
    t_monitor.start()
    
    server = http.server.HTTPServer(('127.0.0.1', PORT), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
        
def add_to_startup():
    app_name = "SysMonitor" 
    
    # Get the path of the current executable
    if getattr(sys, 'frozen', False):
        exe_path = sys.executable
    else:
        # Fallback if running as a normal .py script
        exe_path = os.path.abspath(__file__)
        
    try:
        # Open the registry key where startup programs are listed
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE
        )
        # Set the value
        winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, exe_path)
        winreg.CloseKey(key)
    except Exception as e:
        print(f"Failed to add to startup: {e}")

if __name__ == '__main__':
    add_to_startup()
    run_server()