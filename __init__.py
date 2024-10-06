from .node import EnvironmentVisualizer
from .node import InterpolateEdges
from .node import MapEquirectangular
from .server import run_https_server
import threading

NODE_CLASS_MAPPINGS = {
    "EnvironmentVisualizer": EnvironmentVisualizer,
    "InterpolateEdges": InterpolateEdges,
    "MapEquirectangular": MapEquirectangular
}

WEB_DIRECTORY = "./web"

server_thread = threading.Thread(target=run_https_server)
server_thread.start()