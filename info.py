import sys
import os
import http.server
import json
import platform
import psutil
import wmi
import pythoncom

if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

PORT = 25555

class SystemInfoHandler(http.server.SimpleHTTPRequestHandler):
    # Cache specs so we don't query hardware on every request (slow)
    cached_specs = {}

    @classmethod
    def load_specs(cls):
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
        
        ram_gb = round(psutil.virtual_memory().total / (1024.0 ** 3), 1)
        ram_info = f"{ram_gb} GB"

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
        except Exception as e:
            gpu_info = "Error retrieving GPU"

        cls.cached_specs = {
            "os": os_info,
            "cpu": cpu_name,
            "gpu": gpu_info,
            "ram": ram_info
        }
        
    def log_message(self, format, *args):
        pass
    
    def do_GET(self):
        # Only allow the specific endpoint
        if self.path == '/specs':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*') 
            self.end_headers()
            
            # Send the cached JSON data
            self.wfile.write(json.dumps(self.cached_specs).encode())
        else:
            self.send_response(404)

def run_server():
    SystemInfoHandler.load_specs()
    
    # Start the server
    server_address = ('127.0.0.1', PORT)
    httpd = http.server.HTTPServer(server_address, SystemInfoHandler)
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()