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
import websockets

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

FAV_FILE = "favorites.json"
STATE_FILE = "pixiv_state.json"

def save_to_file(filename, data):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(f"Error saving {filename}: {e}")

def load_from_file(filename, default):
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {filename}: {e}")
    return default

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
    "pixiv_rankings": load_from_file(STATE_FILE, {}).get('rankings', []),
    "pixiv_index": load_from_file(STATE_FILE, {}).get('index', 0),
    "pixiv_favorites": load_from_file(FAV_FILE, [])
}

PORT = 25555
PORT_WS = 25556

media_manager = None
cur_media_session = None
session_event_tokens = []
main_async_loop = None
active_ws_clients = set()

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

async def broadcast_ws_media(payload):
    global active_ws_clients
    if not active_ws_clients:
        return
    msg = json.dumps(payload)
    disconnected = set()
    for ws in list(active_ws_clients):
        try:
            await ws.send(msg)
        except Exception:
            disconnected.add(ws)
    if disconnected:
        active_ws_clients.difference_update(disconnected)

def trigger_media_event():
    global main_async_loop
    if main_async_loop and main_async_loop.is_running():
        asyncio.run_coroutine_threadsafe(handle_media_event_async(), main_async_loop)

def on_session_changed_callback(sender, args):
    global media_manager, main_async_loop
    if media_manager and main_async_loop and main_async_loop.is_running():
        try:
            sess = media_manager.get_current_session()
            bind_active_session(sess)
        except:
            pass
    trigger_media_event()

def on_media_event_callback(sender, args):
    trigger_media_event()

def bind_active_session(session):
    global cur_media_session, session_event_tokens
    unbind_active_session()
    cur_media_session = session
    if cur_media_session:
        try:
            t1 = cur_media_session.add_playback_info_changed(on_media_event_callback)
            t2 = cur_media_session.add_media_properties_changed(on_media_event_callback)
            t3 = cur_media_session.add_timeline_properties_changed(on_media_event_callback)
            session_event_tokens = [t1, t2, t3]
        except Exception as e:
            session_event_tokens = []

def unbind_active_session():
    global cur_media_session, session_event_tokens
    if cur_media_session and session_event_tokens:
        try:
            cur_media_session.remove_playback_info_changed(session_event_tokens[0])
            cur_media_session.remove_media_properties_changed(session_event_tokens[1])
            cur_media_session.remove_timeline_properties_changed(session_event_tokens[2])
        except:
            pass
    cur_media_session = None
    session_event_tokens = []

async def get_media_info(fetch_props=False):
    global media_manager, cur_media_session, cached_title, cached_artist
    
    if media_manager is None:
        try:
            media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
            media_manager.add_current_session_changed(on_session_changed_callback)
            bind_active_session(media_manager.get_current_session())
        except:
            return {} 
    
    current_session = cur_media_session or media_manager.get_current_session()
    
    if current_session:
        playback_info = None
        try:
            playback_info = current_session.get_playback_info()
        except: pass

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

async def execute_media_command(command, param=None):
    global cur_media_session, media_manager, seek_target, seek_time
    # Ensure media_manager and session are present
    if media_manager is None:
        try:
            media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
            bind_active_session(media_manager.get_current_session())
        except:
            pass
    sess = cur_media_session or (media_manager.get_current_session() if media_manager else None)
    success = False
    
    if sess:
        try:
            if command == "playpause":
                success = await sess.try_toggle_play_pause_async()
            elif command == "next":
                success = await sess.try_skip_next_async()
            elif command == "prev":
                success = await sess.try_skip_previous_async()
            elif command == "seek" and param is not None:
                ticks = int(float(param) * 10000000)
                success = await sess.try_change_playback_position_async(ticks)
                seek_target = float(param)
                seek_time = time.time()
        except Exception:
            success = False

    # Fallback to keybd_event if direct SMTC call failed or was unavailable
    if not success and command in ("playpause", "next", "prev"):
        if command == "playpause":
            VK_CODE = 0xB3 
        elif command == "next":
            VK_CODE = 0xB0 
        elif command == "prev":
            VK_CODE = 0xB1 
        ctypes.windll.user32.keybd_event(VK_CODE, 0, 0, 0) 
        ctypes.windll.user32.keybd_event(VK_CODE, 0, 2, 0)
    
    # Immediately trigger an update
    trigger_media_event()

def media_command(command):
    global main_async_loop
    if main_async_loop and main_async_loop.is_running():
        asyncio.run_coroutine_threadsafe(execute_media_command(command), main_async_loop)
    else:
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
        cpu_name = cpu.Name
    except:
        cpu_name = "Error retrieving CPU"
        
    try:
        gpu = w.Win32_VideoController()[0]
        gpu_info = gpu.Name
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

# Global state for monitor_async
cur_playback_pos = 0.0
last_known_track_title = ""
last_known_track_duration = 0
is_reset_phase = False

async def handle_media_event_async():
    global system_state, cur_playback_pos, last_known_track_title, last_known_track_duration, is_reset_phase, fallback_duration
    try:
        media_data = await get_media_info(fetch_props=True)
    except:
        return

    status = media_data.get('media_status', 'Stopped')
    title = media_data.get('media_title', '')
    artist = media_data.get('media_artist', '')
    skipped_position = media_data.get('media_position', 0)
    current_duration = media_data.get('media_duration', 0)

    if title != last_known_track_title:
        last_known_track_title = title
        cur_playback_pos = 0.0
        is_reset_phase = True
        last_known_track_duration = current_duration
        fallback_duration = 0
        if title and title != "No Media":
            threading.Thread(target=fetch_itunes_duration, args=(title, artist), daemon=True).start()
    else:
        if current_duration > 0:
            last_known_track_duration = current_duration
        if skipped_position > 0:
            cur_playback_pos = skipped_position

    dur = last_known_track_duration if last_known_track_duration > 0 else fallback_duration
    media_data['media_duration'] = dur
    media_data['media_position'] = cur_playback_pos
    system_state.update(media_data)

    payload = {
        "type": "media_update",
        "media_title": title,
        "media_artist": artist,
        "media_status": status,
        "media_position": cur_playback_pos,
        "media_duration": dur,
        "server_time": time.time()
    }
    await broadcast_ws_media(payload)

async def monitor_async():
    global system_state, seek_target, seek_time, media_manager, fallback_duration, main_async_loop
    global cur_playback_pos, last_known_track_title, last_known_track_duration, is_reset_phase
    
    main_async_loop = asyncio.get_running_loop()
    
    last_track_title = ""
    last_track_duration = 0 
    cur_pos = 0.0
    prev_skip_position = 0
    reset = False
    startup = True
    
    # Initialize SMTC Manager and subscribe
    try:
        media_manager = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        media_manager.add_current_session_changed(on_session_changed_callback)
        bind_active_session(media_manager.get_current_session())
    except Exception as e:
        print(f"SMTC init error: {e}")

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
        
        fetch_props = startup or (tick % 8 == 0)
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
        
        cur_playback_pos = cur_pos
        last_known_track_title = title
        last_known_track_duration = media_data.get('media_duration', 0)
        
        media_data['media_position'] = cur_pos
        system_state.update(media_data)

        # Send real-time snapshot over WebSocket
        if active_ws_clients:
            payload = {
                "type": "media_update",
                "media_title": title,
                "media_artist": artist,
                "media_status": status,
                "media_position": cur_pos,
                "media_duration": media_data.get('media_duration', 0),
                "server_time": current_time
            }
            await broadcast_ws_media(payload)
        
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

async def ws_handler(websocket):
    global active_ws_clients, cur_playback_pos, last_known_track_title, last_known_track_duration, system_state
    active_ws_clients.add(websocket)
    try:
        # Send initial snapshot immediately upon connect
        init_payload = {
            "type": "media_update",
            "media_title": system_state.get('media_title', ''),
            "media_artist": system_state.get('media_artist', ''),
            "media_status": system_state.get('media_status', 'Stopped'),
            "media_position": system_state.get('media_position', 0),
            "media_duration": system_state.get('media_duration', 0),
            "server_time": time.time()
        }
        await websocket.send(json.dumps(init_payload))

        async for raw in websocket:
            try:
                data = json.loads(raw)
                action = data.get("action")
                pos = data.get("pos")
                if action:
                    await execute_media_command(action, param=pos)
            except Exception as e:
                pass
    finally:
        active_ws_clients.discard(websocket)

async def run_async_services():
    global main_async_loop
    main_async_loop = asyncio.get_running_loop()
    ws_server = await websockets.serve(ws_handler, "127.0.0.1", PORT_WS)
    monitor_task = asyncio.create_task(monitor_async())
    await asyncio.gather(ws_server.wait_closed(), monitor_task)

def monitor():
    asyncio.run(run_async_services())
            
async def media_seek(position_seconds):
    await execute_media_command("seek", position_seconds)

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
                
                # Permanent save to disk
                save_to_file(STATE_FILE, {'rankings': system_state['pixiv_rankings'], 'index': system_state['pixiv_index']})

                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode())
                print(f"PIXIV STATE SAVED TO DISK: {len(system_state['pixiv_rankings'])} items")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
        elif parsed_path.path == '/media/pixiv_fav_save':
            try:
                length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(length)
                data = json.loads(post_data)
                if 'favorites' in data: system_state['pixiv_favorites'] = data['favorites']

                # Permanent save to disk
                save_to_file(FAV_FILE, system_state['pixiv_favorites'])

                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode())
                print(f"PIXIV FAVORITES SAVED TO DISK: {len(system_state['pixiv_favorites'])} items")
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
            
        elif parsed_path.path == '/media/pixiv_fav_load':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            state = {'favorites': system_state['pixiv_favorites']}
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
                    media_command("seek") # handled via media_seek
                    global main_async_loop
                    if main_async_loop and main_async_loop.is_running():
                        asyncio.run_coroutine_threadsafe(media_seek(pos), main_async_loop)
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
                    # Save directly into project folder for stability
                    outp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'background.webm').replace('\\', '/')
                    system_state['sys_log'] = f"Converting to local storage..."
                    def do_convert(i, o):
                        import subprocess, re
                        try:
                            dur_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', i]
                            res = subprocess.run(dur_cmd, capture_output=True, text=True)
                            total = float(res.stdout.strip()) if res.returncode == 0 else 0
                            
                            # Performance Profile: 30FPS, Realtime deadline, and lighter bitrate (3M)
                            # This ensures the video is extremely easy for the browser to decode in the background.
                            cmd = ['ffmpeg', '-y', '-i', i, '-r', '30', '-c:v', 'libvpx', '-crf', '15', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '5', '-g', '120', '-c:a', 'libvorbis', o]
                            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, universal_newlines=True)
                            for line in proc.stdout:
                                m = re.search(r"time=(\d+):(\d+):(\d+.\d+)", line)
                                if m and total > 0:
                                    h, mi, s = map(float, m.groups())
                                    system_state['conv_progress'] = min(99, int(((h*3600 + mi*60 + s) / total) * 100))
                            proc.wait()
                            if proc.returncode == 0:
                                system_state['conv_progress'] = 100
                                print("LOCAL VIDEO READY: background.webm")
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
                    
                    f = open(fp, 'rb')
                    f.seek(s)
                    self.wfile.write(f.read(cs))
                    f.close()
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
