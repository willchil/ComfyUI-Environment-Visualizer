from .node import EnvironmentVisualizer
from .node import InterpolateEdges
from .server import run_https_server
import threading

NODE_CLASS_MAPPINGS = {
    "Environment Visualizer": EnvironmentVisualizer,
    "Interpolate Edges": InterpolateEdges
}

server_thread = threading.Thread(target=run_https_server)
server_thread.start()
