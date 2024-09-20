from .node import EnvironmentVisualizer
from .node import InterpolateEdges
from .server import run_https_server
import threading

NODE_CLASS_MAPPINGS = {
    "EnvironmentVisualizer": EnvironmentVisualizer,
    "InterpolateEdges": InterpolateEdges
}

WEB_DIRECTORY = "./web"

server_thread = threading.Thread(target=run_https_server)
server_thread.start()
