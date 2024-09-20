from .server import get_lan_ip
from .server import SERVER_PORT
from server import PromptServer
from aiohttp import web
from PIL import Image
import os
import numpy as np
import webbrowser
import time
import re


@PromptServer.instance.routes.post("/get_url")
async def get_url(_):
    return web.json_response({"port": str(SERVER_PORT)})


class EnvironmentVisualizer:

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "texture": ("IMAGE", ),
                "name": ("STRING", ),
                "open_automatically": ("BOOLEAN", {"default": True, "label_on": "enabled", "label_off": "disabled"}),
            },
            "optional": {
                "depth": ("IMAGE", ),
            }
        }
               
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save_environment"
    CATEGORY = "image"
    DESCRIPTION = "Saves the texture and depth map, to be viewed in an immersive WebXR environment."

    save_directory = os.path.join(os.path.dirname(__file__), 'environments')


    @staticmethod
    def save_tensor_image(image, path):
        i = 255. * image.cpu().numpy()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        img.save(path, pnginfo=None, compress_level=4)


    @staticmethod
    def get_unique_name(path, name):
        existing_names = os.listdir(path)
        counter = 2
        new_name = name
        while new_name in existing_names:
            new_name = f"{name} {counter}"
            counter += 1
        return new_name


    def save_environment(self, texture, name, open_automatically, depth=None):
        if depth and texture.shape[0] != depth.shape[0]:
            raise Exception("Number of environment textures and depth maps must be equivalent.")
        
        if name:
            name = re.sub(r'[\\/*?:"<>|]', '_', name)
            name = name.rstrip(' .')
            if len(name) > 25:
                name = name[:25] + '...'
        else:
            name = str(int(time.time()))

        for (batch_number, texture1) in enumerate(texture):
            new_name = self.get_unique_name(self.save_directory, name)
            new_directory = os.path.join(self.save_directory, new_name)
            os.makedirs(new_directory)
            self.save_tensor_image(texture1, os.path.join(new_directory, 'skybox.png'))
            if depth:
                self.save_tensor_image(depth[batch_number], os.path.join(new_directory, 'depth.png'))
        
        if open_automatically:
            webbrowser.open(f"https://{get_lan_ip()}:{SERVER_PORT}/environments.html?env={new_name}")

        return {}
    


class InterpolateEdges:

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", ),
                "distance": ("INT", ),
            }
        }
               
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "interpolate_edges"
    CATEGORY = "image"
    DESCRIPTION = "Make the vertical edges of the given images blend seamlessly, using linear interpolation. Works best with depth maps."

    def interpolate_edges(self, image, distance):

        # Get the shape of the tensor
        smoothed = image.clone()
        B, H, W, C = smoothed.shape
        
        # Ensure smoothing_pixels is valid
        assert distance <= W // 2, "Smoothing pixels must be less than half of the image width."

        # Iterate over each image in the batch
        for b in range(B):
            # Iterate over each channel in the image
            for c in range(C):
                # Iterate over each horizontal row of pixels
                for h in range(H):
                    # Get the left and right edge pixels
                    left_edge = smoothed[b, h, 0, c]
                    right_edge = smoothed[b, h, W-1, c]
                    
                    # Calculate the average value of the edges
                    avg_value = (left_edge + right_edge) / 2.0
                    
                    # Interpolate the edge pixels
                    offset_left = left_edge - avg_value
                    offset_right = right_edge - avg_value
                    for i in range(distance):
                        blend_factor = (distance - i) / distance
                        smoothed[b, h, i, c] -= blend_factor * offset_left
                        smoothed[b, h, W - 1 - i, c] -= blend_factor * offset_right

        return (smoothed,)