from .server import SERVER_PORT
from .map_equirectangular import map_equirectangular

from server import PromptServer

from aiohttp import web
from PIL import Image
import os
import numpy as np
import time
import re
import torch


@PromptServer.instance.routes.post("/get_url")
async def get_url(_):
    return web.json_response({"port": str(SERVER_PORT)})


class MapEquirectangular:

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE", ),
                "equirectangular_width": ("INT", {"default": 2048}),
                "hfov": ("FLOAT", {"default": 60.0, "min": 0.0, "max": 180.0, "step": 1.0}),
                "yaw": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "pitch": ("FLOAT", {"default": 0.0, "min": -90.0, "max": 90.0, "step": 1.0}),
                "roll": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0})
            },
        }
    
    RETURN_TYPES = ("IMAGE", )
    OUTPUT_NODE = False
    FUNCTION = "map"
    CATEGORY = "image/equirectangular"
    DESCRIPTION = "Takes an image and some camera parameters, and projects it onto an equirectangular image."

    def map(self, image, equirectangular_width, hfov, yaw, pitch, roll):

        B = image.shape[0]
        processed_images = []

        for i in range(B):
            # Process the image using the method
            processed_image = map_equirectangular(
                image[i],
                hfov,
                yaw,
                pitch,
                roll,
                equirectangular_width
            )
            # Append the processed image to the list
            processed_images.append(processed_image)

        # Aggregate the processed images into a tensor of shape [B, H, W, C]
        output_tensor = torch.stack(processed_images, dim=0)

        return (output_tensor,)

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
    CATEGORY = "image/equirectangular"
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
        if depth is not None and texture.shape[0] != depth.shape[0]:
            raise Exception("Number of environment textures and depth maps must be equivalent.")
        
        if name:
            name = re.sub(r'[\\/*?:"<>|]', '_', name)
            name = name.rstrip(' .')
            if len(name) > 25:
                name = name[:25] + '...'
        else:
            name = str(int(time.time()))

        for (batch_number, texture1) in enumerate(texture):
            name = self.get_unique_name(self.save_directory, name)
            new_directory = os.path.join(self.save_directory, name)
            os.makedirs(new_directory)
            self.save_tensor_image(texture1, os.path.join(new_directory, 'skybox.png'))
            if depth is not None:
                self.save_tensor_image(depth[batch_number], os.path.join(new_directory, 'depth.png'))
        
        if open_automatically:
            completion_data = {
                "env_name": name,
                "env_port": str(SERVER_PORT)
            }
            return { "ui": completion_data }
        else:
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
    CATEGORY = "image/equirectangular"
    DESCRIPTION = "Make the vertical edges of the given images blend seamlessly, using linear interpolation. Works best with depth maps."

    def interpolate_edges(self, image, distance):

        smoothed = image.clone()
        _, _, W, _ = smoothed.shape

        # Ensure smoothing distance fits within the image
        distance = min(distance, W // 2)

        # Compute the left and right edge pixels
        left_edge = smoothed[:, :, 0, :]          # Shape: [B, H, C]
        right_edge = smoothed[:, :, W - 1, :]     # Shape: [B, H, C]

        # Calculate the average value of the edges
        avg_value = (left_edge + right_edge) / 2.0  # Shape: [B, H, C]

        # Compute offsets from the average
        offset_left = (left_edge - avg_value).unsqueeze(2)   # Shape: [B, H, 1, C]
        offset_right = (right_edge - avg_value).unsqueeze(2) # Shape: [B, H, 1, C]

        # Create blend factors
        blend_factors = torch.linspace(1, 0, steps=distance, device=smoothed.device).view(1, 1, distance, 1)  # Shape: [1, 1, distance, 1]

        # Compute adjustments
        adjustment_left = blend_factors * offset_left  # Shape: [B, H, distance, C]
        adjustment_right = blend_factors * offset_right  # Shape: [B, H, distance, C]

        # Apply adjustments to the left edge
        smoothed[:, :, :distance, :] -= adjustment_left

        # Apply adjustments to the right edge
        indices_right = W - 1 - torch.arange(distance, device=smoothed.device)
        smoothed[:, :, indices_right, :] -= adjustment_right

        return (smoothed,)