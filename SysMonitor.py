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
import urllib.request
import urllib.parse
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
fallback_duration = 0 

def fetch_itunes_duration(title, artist):
    global fallback_duration
    try:
        clean_title = title.split('(')[0].split('-')[0].strip()
        query = urllib.parse.quote(f"{clean_title} {artist}")
        url = f"https://itunes.apple.com/search?term={query}&entity=song&limit=1"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode())
            if data['resultCount'] > 0:
                fallback_duration = data['results'][0]['trackTimeMillis'] / 1000.0
    except:
        pass 

async def get_media_info():
    global media_manager, cached_title, cached_artist
    
    if media_manager is None:
        try:
            media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        except Exception:
            return system_state 
    
    current_session = media_manager.get_current_session()
    
    if current_session:
        playback_info = current_session.get_playback_info()
        status = playback_info.playback_status if playback_info else 0 
        
        if status == 4:
            status_str = "Playing"
        elif status == 5:
            status_str = "Paused"
        else:
            status_str = "Stopped"
        
        try:
            props = await current_session.try_get_media_properties_async()
            if props:
                cached_title = props.title
                cached_artist = props.artist
        except:
            pass
            
        if status_str == "Stopped":
            cached_title = "No Media"
            cached_artist = ""

        try:
            timeline = current_session.get_timeline_properties()
            if timeline:
                start = timeline.start_time.total_seconds()
                end = timeline.end_time.total_seconds()
                position = timeline.position.total_seconds()
                duration = end - start
                
                if duration < 0:
                    duration = 0
            else:
                position = 0
                duration = 0
        except:
            position = 0
            duration = 0

        return {
            "media_title": cached_title,
            "media_artist": cached_artist,
            "media_status": status_str,
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

def keyboard_jolt():
    """Rapidly double-taps the Play/Pause media key via hardware interrupt"""
    media_command("playpause")
    time.sleep(0.03)
    media_command("playpause")

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
    global system_state, seek_target, seek_time, media_manager, fallback_duration 
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    last_track_title = ""
    last_track_duration = 0 
    cur_pos = 0.0
    prev_skip_position = 0
    last_seek_target = -999.0
    reset = False
    startup = True
    
    hunting_for_duration = False 
    hunt_start_time = 0
    keyboard_jolt_fired = False
    hard_seek_fired = False
    
    psutil.cpu_percent(interval=None)
    
    tick = 0
    last_tick_time = time.time()
    
    while True:
        time.sleep(0.25)
        
        current_time = time.time()
        dt = current_time - last_tick_time
        last_tick_time = current_time
        
        if tick % 4 == 0:
            system_state['cpu_percent'] = psutil.cpu_percent(interval=None)
        
        try:
            media_data = loop.run_until_complete(get_media_info())
        except:
            media_data = {}
        
        status = media_data.get('media_status', 'Stopped')
        title = media_data.get('media_title', '')
        artist = media_data.get('media_artist', '')
        skipped_position = media_data.get('media_position', 0)
        current_duration = media_data.get('media_duration', 0) 
        
        if hunting_for_duration:
            if current_duration == 0 or current_duration == last_track_duration:
                media_manager = None 
                media_data['media_duration'] = fallback_duration 
                
                if status == 'Playing':
                    elapsed_hunt = current_time - hunt_start_time
                    
                    # KEYBOARD JOLT
                    """ if elapsed_hunt > 0.1 and not keyboard_jolt_fired:
                        keyboard_jolt()
                        keyboard_jolt_fired = True """
                        
                    """ # HARD SEEK JOLT
                    elif elapsed_hunt > 3.5 and not hard_seek_fired and fallback_duration == 0:
                        seek_target = cur_pos + 0.001 
                        seek_time = current_time
                        hard_seek_fired = True """
            else:
                hunting_for_duration = False
                last_track_duration = current_duration 
        
        if seek_target is not None:
            cur_pos = seek_target
            last_seek_target = seek_target 
            
            try:
                seek_loop = asyncio.new_event_loop()
                seek_loop.run_until_complete(media_seek(seek_target))
                seek_loop.close()
            except:
                pass
                
            seek_target = None
            
        if startup:
            prev_skip_position = skipped_position + 0.1
            last_track_title = title
            last_track_duration = current_duration
            startup = False
            
        ignore_smtc = (current_time - seek_time < 4.0)

        if abs(prev_skip_position - skipped_position) > 0.0000001:
            is_echo = (abs(skipped_position - last_seek_target) < 3.0) and (current_time - seek_time < 15.0)
            
            if not ignore_smtc and not is_echo: 
                if title == last_track_title:
                    if reset == False:
                        cur_pos = skipped_position
                    else:
                        reset = False
            prev_skip_position = skipped_position 
            
        if title != last_track_title:
            last_track_title = title
            cur_pos = 0
            reset = True
            
            hunting_for_duration = True 
            hunt_start_time = current_time 
            keyboard_jolt_fired = False
            hard_seek_fired = False
            media_manager = None 
            media_data['media_duration'] = 0 
            
            fallback_duration = 0
            threading.Thread(target=fetch_itunes_duration, args=(title, artist), daemon=True).start()
            
        elif status == 'Playing':
            cur_pos += dt
        elif status == 'Stopped':
            cur_pos = 0
            hunting_for_duration = False 
            media_data['media_title'] = "No Media"
            media_data['media_artist'] = ""
            media_data['media_duration'] = 0
        
        media_data['media_position'] = cur_pos
        system_state.update(media_data)
        
        if tick % 12 == 0:
            try:
                gpu_stats = gpustat.GPUStatCollection.new_query()
                system_state['gpu_percent'] = gpu_stats.gpus[0].utilization if gpu_stats.gpus else 0
            except:
                pass
                
            try:
                mem = psutil.virtual_memory()
                system_state['ram_percent'] = mem.percent
                system_state['ram_used'] = round(mem.used / (1024.0 ** 3) , 1)
            except:
                pass
            
        if tick % 240 == 0:
            try:
                system_state['disk_percent'] = psutil.disk_usage('/').percent
                system_state['disk_used'] = f"{round(psutil.disk_usage('/').used / (1024.0 ** 3), 1)} GB"
            except:
                pass 
            
        tick += 1
        if tick > 1000: 
            tick = 0
            
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
    
    if getattr(sys, 'frozen', False):
        exe_path = sys.executable
    else:
        exe_path = os.path.abspath(__file__)
        
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE
        )
        winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, exe_path)
        winreg.CloseKey(key)
    except Exception as e:
        print(f"Failed to add to startup: {e}")

if __name__ == '__main__':
    add_to_startup()
    run_server()