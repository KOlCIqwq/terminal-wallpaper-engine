import sys
import os
import http.server
import json
import platform
import psutil
import wmi
import pythoncom
import threading
import asyncio
import datetime
import time
import random
import ctypes
import urllib.request
import urllib.parse
from urllib.parse import urlparse, parse_qs
import winreg
from pycaw.pycaw import AudioUtilities
import pynvml

# Initialize NVML for GPU monitoring
try:
    pynvml.nvmlInit()
    nvml_available = True
except:
    nvml_available = False

try:
    from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
except ImportError:
    print("Please install winsdk: pip install winsdk")
    sys.exit(1)

if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

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
    "media_duration": 0,
    "sys_volume": 0,
    "sys_log": "Initializing monitor...",
    "conv_progress": -1
}

PORT = 25555

media_manager = None
seek_target = None
seek_time = 0

cached_title = ""
cached_artist = ""
fallback_duration = 0 

# Cache for /specs response to reduce CPU spike on frequent polling
last_specs_json = b""
last_specs_time = 0

volume_control = None
def get_volume_control():
    global volume_control
    if volume_control is None:
        try:
            pythoncom.CoInitialize()
            devices = AudioUtilities.GetSpeakers()
            volume_control = devices.EndpointVolume
        except:
            pass
    return volume_control
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

async def get_media_info(fetch_props=False):
    global media_manager, cached_title, cached_artist
    
    if media_manager is None:
        try:
            media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        except:
            return {} 
    
    current_session = media_manager.get_current_session()
    
    if current_session:
        playback_info = current_session.get_playback_info()
        status = playback_info.playback_status if playback_info else 0 
        status_str = "Playing" if status == 4 else ("Paused" if status == 5 else "Stopped")
        
        if fetch_props:
            try:
                props = await current_session.try_get_media_properties_async()
                if props:
                    cached_title = props.title
                    cached_artist = props.artist
            except:
                pass
            
        if status_str == "Stopped" and not cached_title:
            cached_title = "No Media"
            cached_artist = ""

        try:
            timeline = current_session.get_timeline_properties()
            if timeline:
                start = timeline.start_time.total_seconds()
                end = timeline.end_time.total_seconds()
                position = timeline.position.total_seconds()
                duration = end - start
                snapshot_age = (datetime.datetime.now(datetime.timezone.utc) - timeline.last_updated_time).total_seconds()
                if duration < 0: duration = 0
            else:
                position, duration, snapshot_age = 0, 0, 0
        except:
            position, duration, snapshot_age = 0, 0, 0

        return {
            "media_title": cached_title,
            "media_artist": cached_artist,
            "media_status": status_str,
            "media_position": position,
            "media_duration": duration,
            "snapshot_age": snapshot_age
        }
    else:
        return {
            "media_title": "No Media",
            "media_artist": "",
            "media_status": "Stopped",
            "media_position": 0,
            "media_duration": 0,
            "snapshot_age": 0
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
    system_state['sys_log'] = "Hardware specs loaded"

async def monitor_async():
    global system_state, seek_target, seek_time, media_manager, fallback_duration 
    
    last_track_title = ""
    last_track_duration = 0 
    cur_pos = 0.0
    prev_skip_position = 0
    reset = False
    startup = True
    
    hunting_for_duration = False 
    
    psutil.cpu_percent(interval=None)
    pythoncom.CoInitialize() 

    tick = 0
    last_tick_time = time.time()
    
    # NVML handle for faster GPU polling
    nvml_handle = None
    if nvml_available:
        try:
            nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        except:
            pass
    
    while True:
        await asyncio.sleep(0.25)
        
        current_time = time.time()
        dt = current_time - last_tick_time
        last_tick_time = current_time
        
        if tick % 4 == 0:
            system_state['cpu_percent'] = psutil.cpu_percent(interval=None)
            vol_ctrl = get_volume_control()
            if vol_ctrl:
                try:
                    system_state['sys_volume'] = round(vol_ctrl.GetMasterVolumeLevelScalar() * 100)
                except:
                    pass
        
        # Only fetch props on startup, track change, or every 5 seconds
        fetch_props = startup or (tick % 20 == 0)
        try:
            media_data = await get_media_info(fetch_props=fetch_props)
        except:
            media_data = {}
        
        status = media_data.get('media_status', 'Stopped')
        title = media_data.get('media_title', '')
        artist = media_data.get('media_artist', '')
        skipped_position = media_data.get('media_position', 0)
        current_duration = media_data.get('media_duration', 0) 
        
        if current_duration > 0:
            last_track_duration = current_duration
            if hunting_for_duration:
                hunting_for_duration = False
                system_state['sys_log'] = "Duration fetched via SMTC"
        
        if current_duration <= 0:
            if last_track_duration > 0:
                media_data['media_duration'] = last_track_duration
            elif fallback_duration > 0:
                media_data['media_duration'] = fallback_duration   

        if seek_target is not None:
            cur_pos = seek_target
            seek_target = None
            
        snapshot_age = media_data.get('snapshot_age', 0)

        if startup:
            prev_skip_position = skipped_position + 0.1
            last_track_title = title
            last_track_duration = current_duration
            startup = False
            
        ignore_smtc = (current_time - seek_time < 1.0)

        if abs(prev_skip_position - skipped_position) > 0.0000001:
            gap = abs(cur_pos - skipped_position)
            is_echo = (gap < 6.0) and (current_time - seek_time < 15.0)
            
            if not ignore_smtc and not is_echo: 
                if title == last_track_title:
                    if reset == False:
                        catch_up_delay = snapshot_age if status == 'Playing' else 0.0
                        if catch_up_delay < 0 or catch_up_delay > 15.0:
                            catch_up_delay = 1.5 
                        cur_pos = skipped_position + catch_up_delay
                    else:
                        reset = False
            prev_skip_position = skipped_position
            
        if title != last_track_title:
            last_track_title = title
            cur_pos = 0
            reset = True
            hunting_for_duration = True 
            
            # Force property fetch on next tick
            startup = True
            
            media_data['media_duration'] = 0
            last_track_duration = 0
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
        
        # GPU and RAM every 3s
        if tick % 12 == 0:
            if nvml_handle:
                try:
                    util = pynvml.nvmlDeviceGetUtilizationRates(nvml_handle)
                    system_state['gpu_percent'] = util.gpu
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
        if tick > 1000: tick = 0

def monitor():
    asyncio.run(monitor_async())
            
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
            pass
        
class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range, Content-Type')
        self.end_headers()

    def do_GET(self):
        global system_state, last_specs_json, last_specs_time
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/specs':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            now = time.time()
            # Cache response for 150ms to prevent spikes from rapid polling
            if now - last_specs_time > 0.15:
                last_specs_json = json.dumps(system_state).encode()
                last_specs_time = now
            self.wfile.write(last_specs_json)
            
        elif parsed_path.path == '/media/playpause':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("playpause")
            system_state['sys_log'] = "Command: Play/Pause"
            
        elif parsed_path.path == '/media/next':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("next")
            system_state['sys_log'] = "Command: Next Track"
            
        elif parsed_path.path == '/media/prev':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            media_command("prev")
            system_state['sys_log'] = "Command: Prev Track"
            
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
                    system_state['sys_log'] = f"UI seek to {round(pos_sec)}s"
                except ValueError:
                    pass
        elif parsed_path.path == '/media/volume':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            query_components = parse_qs(parsed_path.query)
            if 'val' in query_components:
                try:
                    vol_val = float(query_components['val'][0]) / 100.0
                    vol_val = max(0.0, min(1.0, vol_val))
                    
                    vol_ctrl = get_volume_control()
                    if vol_ctrl:
                        vol_ctrl.SetMasterVolumeLevelScalar(vol_val, None)
                        system_state['sys_volume'] = round(vol_val * 100)
                        system_state['sys_log'] = f"Sys Vol override: {round(vol_val * 100)}%"
                except Exception as e:
                    pass
        elif parsed_path.path == '/media/convert':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            query_components = parse_qs(parsed_path.query)
            if 'path' in query_components:
                input_path = query_components['path'][0].strip('"')
                if os.path.exists(input_path):
                    output_path = input_path.rsplit('.', 1)[0] + '.ogg'
                    system_state['sys_log'] = f"Converting: {os.path.basename(input_path)}..."
                    
                    def do_convert(inp, outp):
                        import subprocess
                        import re
                        try:
                            dur_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inp]
                            dur_res = subprocess.run(dur_cmd, capture_output=True, text=True)
                            total_duration = float(dur_res.stdout.strip()) if dur_res.returncode == 0 else 0
                            
                            cmd = ['ffmpeg', '-y', '-i', inp, '-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis', '-q:a', '5', outp]
                            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, universal_newlines=True)
                            
                            for line in process.stdout:
                                match = re.search(r"time=(\d+):(\d+):(\d+.\d+)", line)
                                if match and total_duration > 0:
                                    hours, minutes, seconds = map(float, match.groups())
                                    current_time = hours * 3600 + minutes * 60 + seconds
                                    progress = min(100, int((current_time / total_duration) * 100))
                                    system_state['conv_progress'] = progress
                            
                            process.wait()
                            if process.returncode == 0:
                                system_state['conv_progress'] = 100
                                system_state['sys_log'] = f"Success! Created: {os.path.basename(outp)}"
                            else:
                                system_state['conv_progress'] = -1
                        except Exception as e:
                            system_state['conv_progress'] = -1
                        finally:
                            time.sleep(3)
                            if system_state['conv_progress'] == 100:
                                system_state['conv_progress'] = -1
                            
                    threading.Thread(target=do_convert, args=(input_path, output_path), daemon=True).start()
                    self.wfile.write(json.dumps({"status": "started", "output": output_path}).encode())
                else:
                    self.wfile.write(json.dumps({"status": "error", "message": "File not found"}).encode())
        
        elif parsed_path.path == '/media/browse':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            import subprocess
            # Expand filter to include images and videos
            cmd = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'All Supported|*.mp4;*.webm;*.ogg;*.mov;*.avi;*.mkv;*.png;*.jpg;*.jpeg;*.webp;*.gif|Videos|*.mp4;*.webm;*.ogg;*.mov;*.avi;*.mkv|Images|*.png;*.jpg;*.jpeg;*.webp;*.gif'; $f.ShowDialog() | Out-Null; $f.FileName"
            try:
                result = subprocess.check_output(["powershell", "-Command", cmd], text=True).strip()
                if result:
                    self.wfile.write(json.dumps({"status": "success", "path": result}).encode())
                    system_state['sys_log'] = f"Selected: {os.path.basename(result)}"
                else:
                    self.wfile.write(json.dumps({"status": "cancelled"}).encode())
            except:
                self.wfile.write(json.dumps({"status": "error"}).encode())

        elif parsed_path.path == '/video_proxy':
            query_components = parse_qs(parsed_path.query)
            if 'path' in query_components:
                file_path = query_components['path'][0].strip('"')
                if os.path.exists(file_path):
                    ext = file_path.lower().rsplit('.', 1)[-1]
                    if ext in ['ogg', 'ogv']: mime_type = 'video/ogg'
                    elif ext == 'webm': mime_type = 'video/webm'
                    elif ext == 'mp4': mime_type = 'video/mp4'
                    else: mime_type = 'application/octet-stream'
                    
                    file_size = os.path.getsize(file_path)
                    range_header = self.headers.get('Range')
                    start = 0
                    end = file_size - 1
                    
                    if range_header:
                        import re
                        match = re.search(r'bytes=(\d+)-(\d*)', range_header)
                        if match:
                            start = int(match.group(1))
                            if match.group(2):
                                end = int(match.group(2))
                        self.send_response(206)
                        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                    else:
                        self.send_response(200)
                    
                    chunk_size = end - start + 1
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-type', mime_type)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Length', str(chunk_size))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    
                    try:
                        with open(file_path, 'rb') as f:
                            f.seek(start)
                            remaining = chunk_size
                            while remaining > 0:
                                chunk = f.read(min(remaining, 64 * 1024))
                                if not chunk: break
                                self.wfile.write(chunk)
                                remaining -= len(chunk)
                    except:
                        pass
                    return
            self.send_response(404)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    t_static = threading.Thread(target=get_static, daemon=True)
    t_static.start()

    t_monitor = threading.Thread(target=monitor, daemon=True)
    t_monitor.start()
    
    # Use ThreadingHTTPServer to handle multiple concurrent video requests (metadata + chunks)
    from http.server import ThreadingHTTPServer
    server = ThreadingHTTPServer(('127.0.0.1', PORT), RequestHandler)
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
        pass

if __name__ == '__main__':
    add_to_startup()
    run_server()