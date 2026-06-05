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
    "conv_progress": -1,
    "pixiv_rankings": [],
    "pixiv_index": 0
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
    
    psutil.cpu_percent(interval=None)
    pythoncom.CoInitialize() 

    tick = 0
    last_tick_time = time.time()
    
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
            startup = True
            media_data['media_duration'] = 0
            last_track_duration = 0
            fallback_duration = 0
            threading.Thread(target=fetch_itunes_duration, args=(title, artist), daemon=True).start()
            
        elif status == 'Playing':
            cur_pos += dt
        elif status == 'Stopped':
            cur_pos = 0
            media_data['media_title'] = "No Media"
            media_data['media_artist'] = ""
            media_data['media_duration'] = 0
        
        media_data['media_position'] = cur_pos
        system_state.update(media_data)
        
        if tick % 12 == 0:
            if nvml_handle:
                try:
                    util = pynvml.nvmlDeviceGetUtilizationRates(nvml_handle)
                    system_state['gpu_percent'] = util.gpu
                except: pass
            try:
                mem = psutil.virtual_memory()
                system_state['ram_percent'] = mem.percent
                system_state['ram_used'] = round(mem.used / (1024.0 ** 3) , 1)
            except: pass
            
        if tick % 240 == 0:
            try:
                system_state['disk_percent'] = psutil.disk_usage('/').percent
                system_state['disk_used'] = f"{round(psutil.disk_usage('/').used / (1024.0 ** 3), 1)} GB"
            except: pass 
            
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
        except: pass

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
        self.end_headers()

    def do_POST(self):
        global system_state
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/media/pixiv_save':
            try:
                length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(length)
                data = json.loads(post_data)
                if 'rankings' in data: system_state['pixiv_rankings'] = data['rankings']
                if 'index' in data: system_state['pixiv_index'] = data['index']
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode())
                print(f"PIXIV STATE SAVED: {len(system_state['pixiv_rankings'])} items")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
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
            if now - last_specs_time > 0.15:
                last_specs_json = json.dumps(system_state).encode()
                last_specs_time = now
            self.wfile.write(last_specs_json)
            
        elif parsed_path.path == '/media/pixiv_load':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            state = {'rankings': system_state['pixiv_rankings'], 'index': system_state['pixiv_index']}
            self.wfile.write(json.dumps(state).encode())
            
        elif parsed_path.path == '/media/playpause':
            self.send_response(200); self.end_headers()
            media_command("playpause")
            
        elif parsed_path.path == '/media/next':
            self.send_response(200); self.end_headers()
            media_command("next")
            
        elif parsed_path.path == '/media/prev':
            self.send_response(200); self.end_headers()
            media_command("prev")
            
        elif parsed_path.path == '/media/seek':
            self.send_response(200); self.end_headers()
            q = parse_qs(parsed_path.query)
            if 'pos' in q:
                try:
                    pos = float(q['pos'][0])
                    global seek_target, seek_time
                    seek_target = pos; seek_time = time.time()
                    loop = asyncio.new_event_loop()
                    loop.run_until_complete(media_seek(pos)); loop.close()
                except: pass

        elif parsed_path.path == '/media/volume':
            self.send_response(200); self.end_headers()
            q = parse_qs(parsed_path.query)
            if 'val' in q:
                try:
                    v = max(0.0, min(1.0, float(q['val'][0]) / 100.0))
                    ctrl = get_volume_control()
                    if ctrl: ctrl.SetMasterVolumeLevelScalar(v, None)
                except: pass

        elif parsed_path.path == '/media/convert':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            q = parse_qs(parsed_path.query)
            if 'path' in q:
                inp = q['path'][0].strip('"').replace('\\', '/')
                if os.path.exists(inp):
                    outp = inp.rsplit('.', 1)[0] + '.webm'
                    system_state['sys_log'] = f"Converting..."
                    def do_convert(i, o):
                        import subprocess, re
                        try:
                            dur_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', i]
                            res = subprocess.run(dur_cmd, capture_output=True, text=True)
                            total = float(res.stdout.strip()) if res.returncode == 0 else 0
                            cmd = ['ffmpeg', '-y', '-i', i, '-c:v', 'libvpx', '-crf', '4', '-b:v', '12M', '-deadline', 'realtime', '-cpu-used', '4', '-c:a', 'libvorbis', o]
                            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, universal_newlines=True)
                            for line in proc.stdout:
                                m = re.search(r"time=(\d+):(\d+):(\d+.\d+)", line)
                                if m and total > 0:
                                    h, mi, s = map(float, m.groups())
                                    system_state['conv_progress'] = min(99, int(((h*3600 + mi*60 + s) / total) * 100))
                            proc.wait()
                            if proc.returncode == 0:
                                system_state['conv_progress'] = 100
                                time.sleep(5)
                        except: pass
                        finally: system_state['conv_progress'] = -1
                    threading.Thread(target=do_convert, args=(inp, outp), daemon=True).start()
                    self.wfile.write(json.dumps({"status": "started"}).encode())
                else: self.wfile.write(json.dumps({"status": "error"}).encode())

        elif parsed_path.path == '/media/browse':
            self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Content-type', 'application/json'); self.end_headers()
            import subprocess
            cmd = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'All Supported|*.mp4;*.webm;*.ogg;*.mov;*.avi;*.mkv;*.png;*.jpg;*.jpeg;*.webp;*.gif|Videos|*.mp4;*.webm;*.ogg;*.mov;*.avi;*.mkv|Images|*.png;*.jpg;*.jpeg;*.webp;*.gif'; $f.ShowDialog() | Out-Null; $f.FileName"
            try:
                res = subprocess.check_output(["powershell", "-Command", cmd], text=True).strip()
                if res: self.wfile.write(json.dumps({"status": "success", "path": res}).encode())
                else: self.wfile.write(json.dumps({"status": "cancelled"}).encode())
            except: self.wfile.write(json.dumps({"status": "error"}).encode())

        elif parsed_path.path == '/video_proxy':
            q = parse_qs(parsed_path.query)
            if 'path' in q:
                fp = q['path'][0].strip('"').replace('\\', '/')
                if os.path.exists(fp):
                    ext = fp.lower().rsplit('.', 1)[-1]
                    mime = 'video/webm' if ext == 'webm' else ('video/mp4' if ext == 'mp4' else 'application/octet-stream')
                    size = os.path.getsize(fp)
                    rh = self.headers.get('Range')
                    s, e = 0, size - 1
                    status = 200
                    if rh:
                        import re
                        m = re.search(r'bytes=(\d+)-(\d*)', rh)
                        if m:
                            s = int(m.group(1))
                            if m.group(2): e = int(m.group(2))
                            status = 206
                    cs = e - s + 1
                    self.send_response(status)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-type', mime)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Length', str(cs))
                    if status == 206: self.send_header('Content-Range', f'bytes {s}-{e}/{size}')
                    self.end_headers()
                    try:
                        with open(fp, 'rb') as f:
                            f.seek(s); rem = cs
                            while rem > 0:
                                chunk = f.read(min(rem, 64 * 1024))
                                if not chunk: break
                                self.wfile.write(chunk); rem -= len(chunk)
                    except: pass
                    return
            self.send_response(404); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

def run_server():
    threading.Thread(target=get_static, daemon=True).start()
    threading.Thread(target=monitor, daemon=True).start()
    from http.server import ThreadingHTTPServer
    server = ThreadingHTTPServer(('127.0.0.1', PORT), RequestHandler)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
        
def add_to_startup():
    app_name = "SysMonitor" 
    exe_path = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, exe_path); winreg.CloseKey(key)
    except: pass

if __name__ == '__main__':
    add_to_startup()
    run_server()