import torch
import torch.nn.functional as F
import math


def map_equirectangular(input_tensor, HFOV, yaw, pitch, roll, output_width=4096):
    """
    Maps an input image tensor to an equirectangular panoramic image using PyTorch tensors.

    Parameters:
        input_tensor (torch.Tensor): Input image as a tensor with shape [H, W, C] in RGB or RGBA format.
        HFOV (float): Horizontal Field of View in degrees.
        yaw (float): Yaw rotation in degrees.
        pitch (float): Pitch rotation in degrees.
        roll (float): Roll rotation in degrees.
        output_width (int): Width of the output equirectangular image (Height will be output_width // 2).

    Returns:
        equirect_image (torch.Tensor): Equirectangular image tensor with shape [output_width // 2, output_width, 4].
    """
    if input_tensor.ndim != 3:
        raise ValueError("Input tensor must be a 3-dimensional array [H, W, C].")

    H_in, W_in, C = input_tensor.shape

    # Handle images with or without an alpha channel
    if C == 4:
        # Input has alpha channel; preserve RGB and ignore input alpha
        input_image = input_tensor[:, :, :3].clone()
    elif C == 3:
        input_image = input_tensor.clone()
    else:
        raise ValueError("Input tensor must have 3 (RGB) or 4 (RGBA) channels.")

    # Calculate Vertical Field of View (VFOV) to match FOV per pixel
    VFOV = HFOV * (H_in / W_in)

    # Convert FOV from degrees to radians
    HFOV_rad = torch.deg2rad(torch.tensor(HFOV, dtype=input_tensor.dtype, device=input_tensor.device))
    VFOV_rad = torch.deg2rad(torch.tensor(VFOV, dtype=input_tensor.dtype, device=input_tensor.device))

    # Compute focal lengths
    fx = (W_in / 2) / torch.tan(HFOV_rad / 2)
    fy = (H_in / 2) / torch.tan(VFOV_rad / 2)

    # Principal point (assuming centered)
    cx = W_in / 2
    cy = H_in / 2

    # Compute the rotation matrix from yaw, pitch, roll
    def rotation_matrix(yaw, pitch, roll):
        # Convert angles from degrees to radians
        yaw_rad = math.radians(yaw)
        pitch_rad = math.radians(pitch)
        roll_rad = math.radians(roll)

        # Rotation matrices around x, y, z axes
        Rx = torch.tensor([
            [1, 0, 0],
            [0, math.cos(pitch_rad), -math.sin(pitch_rad)],
            [0, math.sin(pitch_rad), math.cos(pitch_rad)]
        ], dtype=input_tensor.dtype, device=input_tensor.device)

        Ry = torch.tensor([
            [math.cos(yaw_rad), 0, math.sin(yaw_rad)],
            [0, 1, 0],
            [-math.sin(yaw_rad), 0, math.cos(yaw_rad)]
        ], dtype=input_tensor.dtype, device=input_tensor.device)

        Rz = torch.tensor([
            [math.cos(roll_rad), -math.sin(roll_rad), 0],
            [math.sin(roll_rad), math.cos(roll_rad), 0],
            [0, 0, 1]
        ], dtype=input_tensor.dtype, device=input_tensor.device)

        # Combined rotation matrix
        R = Rz @ Ry @ Rx
        return R

    # Compute rotation matrix and ensure it's contiguous
    R = rotation_matrix(yaw, pitch, roll).T  # Transpose for inverse rotation

    # Equirectangular image dimensions (Height is half of Width)
    W_out = output_width
    H_out = output_width // 2  # Enforce 2:1 aspect ratio

    # Create a meshgrid for the equirectangular image
    theta = (torch.linspace(0, W_out - 1, W_out, dtype=input_tensor.dtype, device=input_tensor.device) / W_out) * 2 * math.pi - math.pi  # theta from -π to π
    phi = (0.5 - (torch.linspace(0, H_out - 1, H_out, dtype=input_tensor.dtype, device=input_tensor.device) / H_out)) * math.pi       # phi from -π/2 to π/2

    # Use torch.meshgrid with proper ordering to get [H_out, W_out]
    phi_grid, theta_grid = torch.meshgrid(phi, theta, indexing='ij')  # Shape: [H_out, W_out]

    # Spherical to Cartesian coordinates (direction vectors)
    x_s = torch.cos(phi_grid) * torch.sin(theta_grid)  # Shape: [H_out, W_out]
    y_s = -torch.sin(phi_grid)                        # Shape: [H_out, W_out]
    z_s = torch.cos(phi_grid) * torch.cos(theta_grid)  # Shape: [H_out, W_out]

    # Stack into direction vectors
    dirs = torch.stack((x_s, y_s, z_s), dim=-1)  # Shape: [H_out, W_out, 3]

    # Rotate direction vectors to camera coordinate system
    dirs_cam = torch.matmul(dirs, R)  # Shape: [H_out, W_out, 3]
    dx_c, dy_c, dz_c = dirs_cam[..., 0], dirs_cam[..., 1], dirs_cam[..., 2]

    # Compute valid_mask before division to avoid divide by zero
    epsilon = torch.tensor(1e-6, dtype=input_tensor.dtype, device=input_tensor.device)
    valid_mask = dz_c > epsilon  # Points in front of the camera

    # Compute x_im and y_im
    x_im = (dx_c / dz_c) * fx + cx
    y_im = (dy_c / dz_c) * fy + cy

    # Update valid_mask with x_im and y_im in valid image range
    valid_mask &= (x_im >= 0) & (x_im < W_in) & (y_im >= 0) & (y_im < H_in)
    valid_mask &= torch.isfinite(x_im) & torch.isfinite(y_im)

    # Prepare grid for grid_sample
    # Normalize x_im and y_im to [-1, 1]
    grid_x = (x_im / (W_in - 1)) * 2 - 1  # Shape: [H_out, W_out]
    grid_y = (y_im / (H_in - 1)) * 2 - 1  # Shape: [H_out, W_out]

    # Ensure grid_x and grid_y are within [-1, 1]
    grid_x = torch.clamp(grid_x, -1.0, 1.0)
    grid_y = torch.clamp(grid_y, -1.0, 1.0)

    # Stack to create grid of shape [1, H_out, W_out, 2]
    grid = torch.stack((grid_x, grid_y), dim=-1)  # Shape: [H_out, W_out, 2]
    grid = grid.unsqueeze(0)  # Shape: [1, H_out, W_out, 2]

    # Ensure grid is contiguous
    grid = grid.contiguous()

    # Prepare input image tensor
    # Convert to float and permute to [C, H, W]
    input_image = input_image.to(dtype=input_tensor.dtype, device=input_tensor.device).permute(2, 0, 1).unsqueeze(0)  # Shape: [1, C, H_in, W_in]

    # Perform remapping using grid_sample
    remapped = F.grid_sample(input_image, grid, mode='bilinear', padding_mode='zeros', align_corners=True)  # Shape: [1, C, H_out, W_out]

    # Create an alpha channel based on valid_mask
    alpha = valid_mask.unsqueeze(0).unsqueeze(0).float()  # Shape: [1, 1, H_out, W_out]

    # Mask the remapped RGB image with the alpha channel to set invalid regions to zero
    remapped = remapped * alpha  # Zero out invalid regions

    # Combine the remapped RGB image with the alpha channel to create RGBA image
    equirect_image = torch.cat((remapped, alpha), dim=1)  # Shape: [1, C, H_out, W_out]

    # Squeeze the batch dimension and permute to [H_out, W_out, C+1]
    equirect_image = equirect_image.squeeze(0).permute(1, 2, 0)  # Shape: [H_out, W_out, C]

    equirect_image = equirect_image.clamp(0, 1)
    return equirect_image