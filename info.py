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
}

PORT = 25555

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
    while True:
        cpu = psutil.cpu_percent(interval = 1) # blocks for 1 sec
        gpu_stats = gpustat.GPUStatCollection.new_query()
        for gpu in gpu_stats.gpus:
            # Later adapt to multiple gpu
            gpu_per = gpu.utilization 
        mem = psutil.virtual_memory()
        ram_p = mem.percent
        ram_u = round(mem.used / (1024.0 ** 3) , 1)
        disk_per = psutil.disk_usage('/').percent
        disk_usage = f"{round(psutil.disk_usage('/').used / (1024.0 ** 3), 1)} GB"
        
        system_state['cpu_percent'] = cpu
        system_state['gpu_percent'] = gpu_per
        system_state['ram_percent'] = ram_p
        system_state['ram_used'] = ram_u
        system_state['disk_percent'] = disk_per
        system_state['disk_used'] = disk_usage
        
        print(system_state)
        
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