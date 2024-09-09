import http.server
import ssl
import os
import json
import socket


SERVER_PORT = 4443
filename = os.path.dirname(__file__)

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def translate_path(self, path):
        # Override to serve files relative to the script's directory
        path = super().translate_path(path)
        rel_path = os.path.relpath(path, os.getcwd())
        return os.path.join(filename, rel_path)

    def do_GET(self):
        # Serve a specific file regardless of the requested path
        if self.path == '/':  # If the root path is requested
            self.path = '/environments.html'
            return super().do_GET()
        elif self.path == '/list_environments':
            # Return a list of all environment directories
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            environments = self.get_environment_directories()
            response = json.dumps({'environments': environments})
            self.wfile.write(response.encode('utf-8'))
        else:
            return super().do_GET()
    
    def get_environment_directories(self):
        environments_path = os.path.join(filename, 'environments')
        if os.path.exists(environments_path) and os.path.isdir(environments_path):
            return [d for d in os.listdir(environments_path) if os.path.isdir(os.path.join(environments_path, d))]
        return []

def run_https_server():
    # Generate self-signed certificate if none exists
    pem_path = os.path.join(filename, 'server.pem')
    if not os.path.exists(pem_path):
        os.system('openssl req -new -x509 -keyout server.pem -out server.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"')

    handler = CORSRequestHandler
    httpd = http.server.HTTPServer(('0.0.0.0', SERVER_PORT), handler)

    # Create SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=pem_path)

    # Wrap the socket
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    
    print(f"Serving HTTPS on https://{get_lan_ip()}:{SERVER_PORT}")
    httpd.serve_forever()

def get_lan_ip():
    hostname = socket.gethostname()
    return socket.gethostbyname(hostname)

if __name__ == "__main__":
    run_https_server()
