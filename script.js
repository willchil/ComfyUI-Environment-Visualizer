import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/webxr/VRButton.js';

let camera, scene, renderer;
let environmentTexture, depthTexture;
let minDistance = 2.0;
let depthRange = 3.0;
let resolution = 2;
let meshDirty = false;
let environmentMesh;
let rotationGroup;

const rotation_angle = 30;
const resolutions = [512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192];

// Initialize a Map to track controller states for snap rotation
const controllerStates = new Map();

init();
animate();

async function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');

    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));

    rotationGroup = new THREE.Group(); // Initialize rotation group
    scene.add(rotationGroup);

    const minDistanceSlider = document.getElementById('minDistance');
    const depthRangeSlider = document.getElementById('depthRange');
    const resolutionSlider = document.getElementById('meshResolution');
    const environmentDirectorySelect = document.getElementById('environmentDirectory');

    document.getElementById('refreshButton').onclick = createEnvironmentMesh;

    minDistanceSlider.addEventListener('input', (event) => {
        minDistance = parseFloat(event.target.value);
        document.getElementById('minValue').textContent = minDistance;
        setMeshDirty(true);
    });
    depthRangeSlider.addEventListener('input', (event) => {
        depthRange = parseFloat(event.target.value);
        document.getElementById('rangeValue').textContent = depthRange;
        setMeshDirty(true);
    });
    resolutionSlider.addEventListener('input', (event) => {
        resolution = parseInt(event.target.value);
        document.getElementById('resolutionValue').textContent = resolutions[resolution];
        setMeshDirty(true);
    });

    const directories = await fetchEnvironments(); // Replace with actual directory fetch
    directories.forEach(dir => {
        const option = document.createElement('option');
        option.value = dir;
        option.textContent = dir;
        environmentDirectorySelect.appendChild(option);
    });

    environmentDirectorySelect.addEventListener('change', (event) => {
        loadEnvironmentTextures(event.target.value);
    });

    const urlParams = new URLSearchParams(window.location.search);
    const directory = urlParams.get('env') || directories[0];
    environmentDirectorySelect.value = directory;

    loadEnvironmentTextures(directory);

    window.addEventListener('resize', onWindowResize, false);

    // Recreate the mesh when entering VR
    renderer.xr.addEventListener('sessionstart', () => {
        if (meshDirty) {
            createEnvironmentMesh(); // Generate new mesh with updated settings
        }
    });

    // Event listener for keyboard input
    window.addEventListener('keydown', onKeyDown, false);
}

async function fetchEnvironments() {
    const response = await fetch('/list_environments');
    const data = await response.json();
    return data['environments'];
}

function setMeshDirty(dirty) {
    meshDirty = dirty;
    const refreshButton = document.getElementById('refreshButton');
    refreshButton.disabled = !meshDirty;
}

function loadEnvironmentTextures(environment) {
    const imageLoader = new THREE.ImageLoader();
    imageLoader.setCrossOrigin('anonymous');

    const skyboxPromise = new Promise((resolve, reject) => {
        imageLoader.load(`environments/${environment}/skybox.png`, resolve, undefined, reject);
    });

    const depthPromise = new Promise((resolve, reject) => {
        imageLoader.load(`environments/${environment}/depth.png`, resolve, undefined, reject);
    });

    Promise.all([skyboxPromise, depthPromise]).then(([skyboxImage, depthImage]) => {
        environmentTexture = new THREE.Texture(skyboxImage);
        environmentTexture.needsUpdate = true;

        depthTexture = new THREE.Texture(depthImage);
        depthTexture.needsUpdate = true;

        createEnvironmentMesh();
    }).catch((error) => {
        console.error('Error loading images:', error);
    });
}

// Function to create the sphere mesh with current settings
function createEnvironmentMesh() {
    // Remove the previous environment mesh if it exists
    if (environmentMesh) {
        rotationGroup.remove(environmentMesh);
        environmentMesh.geometry.dispose();
        environmentMesh.material.dispose();
    }

    // Create new sphere geometry with the selected resolution
    const verticesTheta = Math.min(resolutions[resolution], depthTexture.image.width);
    const verticesPhi = Math.min(resolutions[resolution] / 2, depthTexture.image.height);
    const sphereGeometry = new THREE.SphereGeometry(1, verticesTheta, verticesPhi);
    sphereGeometry.scale(-1, 1, 1); // Invert the sphere

    const material = new THREE.MeshBasicMaterial({ map: environmentTexture });
    environmentMesh = new THREE.Mesh(sphereGeometry, material);

    rotationGroup.add(environmentMesh);

    // Apply depth distortion to the new geometry
    applyDepthDistortion(sphereGeometry, depthTexture);

    setMeshDirty(false);
}

function applyDepthDistortion(geometry, depthMap) {
    const depthData = getDepthData(depthMap);
    if (!depthData) {
        console.error('Depth data is invalid. Skipping depth distortion.');
        return;
    }

    const positionAttribute = geometry.attributes.position;
    const uv = geometry.attributes.uv;

    // Apply depth distortion to all vertices
    for (let i = 0; i < positionAttribute.count; i++) {
        const x = positionAttribute.getX(i);
        const y = positionAttribute.getY(i);
        const z = positionAttribute.getZ(i);

        const u = uv.getX(i);
        const v = 1 - uv.getY(i); // Flip v coordinate

        let depthValue = 1 - sampleDepth(depthData, u, v); // Invert depth value
        if (isNaN(depthValue)) depthValue = 0;

        const distortionFactor = minDistance + depthValue * depthRange;
        if (isNaN(distortionFactor)) continue;

        positionAttribute.setXYZ(i, x * distortionFactor, y * distortionFactor, z * distortionFactor);
    }

    // Synchronize seam vertices to remove the gap
    const widthSegments = geometry.parameters.widthSegments;
    const heightSegments = geometry.parameters.heightSegments;

    for (let phi = 0; phi <= heightSegments; phi++) {
        const firstIndex = phi * (widthSegments + 1);
        const lastIndex = firstIndex + widthSegments;

        // Get the position from the first vertex in the ring
        const x = positionAttribute.getX(firstIndex);
        const y = positionAttribute.getY(firstIndex);
        const z = positionAttribute.getZ(firstIndex);

        // Set the position of the last vertex in the ring to match the first
        positionAttribute.setXYZ(lastIndex, x, y, z);
    }

    positionAttribute.needsUpdate = true;
}

function getDepthData(depthTexture) {
    const image = depthTexture.image;
    if (!image || !image.width || !image.height) {
        console.error('Depth texture image is not properly loaded.');
        return null;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);

    try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        return data;
    } catch (e) {
        console.error('Failed to get depth data:', e);
        return null;
    }
}

function sampleDepth(depthData, u, v) {
    const width = depthTexture.image.width;
    const height = depthTexture.image.height;
    const x = Math.floor(u * width);
    const y = Math.floor(v * height);

    if (x < 0 || x >= width || y < 0 || y >= height) {
        return 0;
    }

    const index = (y * width + x) * 4;
    if (index < 0 || index >= depthData.length) {
        return 0;
    }

    return depthData[index] / 255; // Normalize to 0-1 range
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    if (renderer.xr.isPresenting) {
        processControllerInput();
    }
    renderer.render(scene, camera);
}

function processControllerInput() {
    const session = renderer.xr.getSession();
    if (session) {
        const inputSources = session.inputSources;
        inputSources.forEach(inputSource => {
            if (inputSource && inputSource.gamepad) {
                // Initialize state for this controller if not already done
                if (!controllerStates.has(inputSource)) {
                    controllerStates.set(inputSource, { rotatedLeft: false, rotatedRight: false });
                }
                const state = controllerStates.get(inputSource);

                const gp = inputSource.gamepad;
                const axisX = gp.axes[2];
                const deadzone = 0.2; // Threshold to prevent unintended rotations

                if (axisX < -deadzone) { // Joystick pushed to the left
                    if (!state.rotatedLeft) {
                        rotateSceneLeft();
                        state.rotatedLeft = true;
                    }
                } else if (axisX > deadzone) { // Joystick pushed to the right
                    if (!state.rotatedRight) {
                        rotateSceneRight();
                        state.rotatedRight = true;
                    }
                } else { // Joystick is in the center
                    // Reset rotation state to allow new rotations
                    if (state.rotatedLeft || state.rotatedRight) {
                        state.rotatedLeft = false;
                        state.rotatedRight = false;
                    }
                }
            }
        });
    }
}

// Handle keyboard input
function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
            rotateSceneLeft();
            event.preventDefault();
            break;
        case 'ArrowRight':
        case 'KeyD':
            rotateSceneRight();
            event.preventDefault();
            break;
        case 'ArrowDown':
        case 'ArrowUp':
            event.preventDefault();
            break;
    }
}

// Rotate the scene left
function rotateSceneLeft() {
    rotationGroup.rotation.y -= THREE.MathUtils.degToRad(rotation_angle);
}

// Rotate the scene right
function rotateSceneRight() {
    rotationGroup.rotation.y += THREE.MathUtils.degToRad(rotation_angle);
}