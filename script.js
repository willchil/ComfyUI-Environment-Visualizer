import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js';
import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/webxr/VRButton.js';

let camera, scene, renderer;
let environmentTexture, depthTexture = null;
let minDistance = 2.0;
let depthRange = 3.0;
let resolution = 2;
let meshDirty = false;
let environmentMesh;
let rotationGroup;

const rotation_angle = 30; // Degrees
const resolutions = [512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192];

// Variables for mouse interaction
let isUserInteracting = false,
    onPointerDownMouseX = 0,
    onPointerDownMouseY = 0,
    lon = 0,
    lat = 0,
    onPointerDownLon = 0,
    onPointerDownLat = 0;

// Sensitivity parameters
let rotationSensitivityX = 0.1; // Horizontal rotation sensitivity
let rotationSensitivityY = 0.1; // Vertical rotation sensitivity

const controllers = []; // Array to hold controllers
const controllerStates = new Map(); // Map to hold controller states
const hands = []; // Array to hold hand controllers

const max_lat = 85;

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

    const directories = await fetchEnvironments();
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

    // Recreate the mesh when entering VR and reset latitudinal rotation
    renderer.xr.addEventListener('sessionstart', () => {
        if (meshDirty) {
            createEnvironmentMesh(); // Generate new mesh with updated settings
        }
        lat = 0; // Reset latitudinal rotation when entering VR mode
    });

    // Event listener for keyboard input
    window.addEventListener('keydown', onKeyDown, false);

    // Event listeners for mouse interaction
    renderer.domElement.addEventListener('mousedown', onPointerDown, false);
    renderer.domElement.addEventListener('mousemove', onPointerMove, false);
    renderer.domElement.addEventListener('mouseup', onPointerUp, false);
    renderer.domElement.addEventListener('mouseleave', onPointerUp, false);

    // Event listeners for touch interaction (mobile devices)
    renderer.domElement.addEventListener('touchstart', onPointerDown, false);
    renderer.domElement.addEventListener('touchmove', onPointerMove, false);
    renderer.domElement.addEventListener('touchend', onPointerUp, false);

    // Initialize controllers
    for (let i = 0; i <= 1; i++) {
        const controller = renderer.xr.getController(i);
        controller.addEventListener('selectstart', onSelectStart);
        controller.addEventListener('selectend', onSelectEnd);
        scene.add(controller);
        controllers.push(controller);
    }

    // Initialize hands for hand tracking
    for (let i = 0; i <= 1; i++) {
        const hand = renderer.xr.getHand(i);
        hand.userData.isPinching = false;
        hand.userData.isSelecting = false;
        scene.add(hand);
        hands.push(hand);
    }
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

    // Load skybox.png
    const skyboxPromise = new Promise((resolve, reject) => {
        imageLoader.load(`environments/${environment}/skybox.png`, resolve, undefined, reject);
    });

    // Load depth.png, but resolve to null if it fails (making depth optional)
    const depthPromise = new Promise((resolve) => {
        imageLoader.load(`environments/${environment}/depth.png`, resolve, undefined, () => {
            console.warn(`Depth map not found for environment "${environment}". Proceeding without depth deformation.`);
            resolve(null); // Resolve with null if depth.png is not found
        });
    });

    Promise.all([skyboxPromise, depthPromise]).then(([skyboxImage, depthImage]) => {
        // Set environment texture
        environmentTexture = new THREE.Texture(skyboxImage);
        environmentTexture.needsUpdate = true;

        if (depthImage) {
            // If depthImage is loaded, set depthTexture
            depthTexture = new THREE.Texture(depthImage);
            depthTexture.needsUpdate = true;
        } else {
            // If depthImage is not available, set depthTexture to null
            depthTexture = null;
        }

        // Only enable configuration options if depth data is available
        const elements = ['minDistance', 'depthRange', 'meshResolution', 'refreshButton'];
        for (let element of elements) {
            document.getElementById(element).disabled = !depthImage;
        }

        createEnvironmentMesh();
    }).catch((error) => {
        console.error('Error loading skybox image:', error);
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

    // Determine geometry resolution based on whether depthTexture is available
    let verticesTheta, verticesPhi;
    if (depthTexture && depthTexture.image) {
        verticesTheta = Math.min(resolutions[resolution], depthTexture.image.width);
        verticesPhi = Math.min(Math.floor(resolutions[resolution] / 2), depthTexture.image.height);
    } else {
        // Fallback to default resolution
        verticesTheta = resolutions[0];
        verticesPhi = Math.floor(resolutions[0] / 2);
    }

    // Create new sphere geometry with the selected resolution
    const sphereGeometry = new THREE.SphereGeometry(1, verticesTheta, verticesPhi);
    const scale = depthTexture ? 1 : 100;
    sphereGeometry.scale(-scale, scale, scale); // Invert the sphere

    const material = new THREE.MeshBasicMaterial({ map: environmentTexture });
    environmentMesh = new THREE.Mesh(sphereGeometry, material);

    rotationGroup.add(environmentMesh);

    // Apply depth distortion only if depthTexture is available
    if (depthTexture) {
        applyDepthDistortion(sphereGeometry, depthTexture);
    } else {
        console.log('Creating environment mesh without depth deformation.');
    }

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

    // Update rotation based on accumulated lon and lat
    rotationGroup.rotation.y = THREE.MathUtils.degToRad(lon);
    rotationGroup.rotation.x = THREE.MathUtils.degToRad(lat);

    renderer.render(scene, camera);
}

function processControllerInput() {
    const session = renderer.xr.getSession();
    if (session) {
        const inputSources = session.inputSources;

        // Handle joystick snap rotation
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

        // Handle trigger drag rotation
        controllers.forEach(controller => {
            if (controller.userData.isSelecting) {
                if (controller.userData.needsInitialPosition) {
                    // Record initial positions
                    const initialHeadPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
                    const initialControllerPosition = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);

                    // Compute initial vector from head to controller
                    const initialControllerVector = new THREE.Vector3().subVectors(initialControllerPosition, initialHeadPosition);

                    // Project onto XZ plane
                    initialControllerVector.y = 0;
                    if (initialControllerVector.lengthSq() === 0) return; // Avoid division by zero
                    initialControllerVector.normalize();

                    controller.userData.initialControllerVectorXZ = initialControllerVector;
                    controller.userData.needsInitialPosition = false;
                    controller.userData.initialLon = lon; // Store initial lon
                } else {
                    // Get current positions
                    const currentHeadPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
                    const currentControllerPosition = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);

                    // Compute current vector from head to controller
                    const currentControllerVector = new THREE.Vector3().subVectors(currentControllerPosition, currentHeadPosition);

                    // Project onto XZ plane
                    currentControllerVector.y = 0;
                    if (currentControllerVector.lengthSq() === 0) return; // Avoid division by zero
                    currentControllerVector.normalize();

                    // Compute angle difference between initial and current vectors
                    const initialVector = controller.userData.initialControllerVectorXZ;
                    const dot = initialVector.dot(currentControllerVector);
                    const crossY = initialVector.x * currentControllerVector.z - initialVector.z * currentControllerVector.x; // Cross product in Y

                    let angle = Math.atan2(crossY, dot); // Angle in radians
                    angle = THREE.MathUtils.radToDeg(angle); // Convert to degrees

                    // Invert the angle to change rotation direction
                    lon = controller.userData.initialLon - angle;
                }
            }
        });

        // Handle hand tracking pinch gesture rotation
        hands.forEach(hand => {
            const indexTip = hand.joints['index-finger-tip'];
            const thumbTip = hand.joints['thumb-tip'];

            if (indexTip && thumbTip) {
                // Compute the distance between the index tip and thumb tip
                const distance = indexTip.position.distanceTo(thumbTip.position);
                const pinchThreshold = 0.02; // Adjust the threshold as needed (e.g., 2 cm)

                const wasPinching = hand.userData.isPinching;
                const isPinching = distance < pinchThreshold;

                if (isPinching && !wasPinching) {
                    // Pinch started
                    hand.userData.isPinching = true;
                    onSelectStart({ target: hand });
                } else if (!isPinching && wasPinching) {
                    // Pinch ended
                    hand.userData.isPinching = false;
                    onSelectEnd({ target: hand });
                }

                // Handle rotation if the hand is selecting (pinching)
                if (hand.userData.isSelecting) {
                    if (hand.userData.needsInitialPosition) {
                        // Record initial positions
                        const initialHeadPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
                        const wrist = hand.joints['wrist'];
                        if (!wrist) return; // If wrist joint not available, skip
                        const initialHandPosition = new THREE.Vector3().setFromMatrixPosition(wrist.matrixWorld);

                        // Compute initial vector from head to hand
                        const initialHandVector = new THREE.Vector3().subVectors(initialHandPosition, initialHeadPosition);

                        // Project onto XZ plane
                        initialHandVector.y = 0;
                        if (initialHandVector.lengthSq() === 0) return; // Avoid division by zero
                        initialHandVector.normalize();

                        hand.userData.initialHandVectorXZ = initialHandVector;
                        hand.userData.needsInitialPosition = false;
                        hand.userData.initialLon = lon; // Store initial lon
                    } else {
                        // Get current positions
                        const currentHeadPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
                        const wrist = hand.joints['wrist'];
                        if (!wrist) return;
                        const currentHandPosition = new THREE.Vector3().setFromMatrixPosition(wrist.matrixWorld);

                        // Compute current vector from head to hand
                        const currentHandVector = new THREE.Vector3().subVectors(currentHandPosition, currentHeadPosition);

                        // Project onto XZ plane
                        currentHandVector.y = 0;
                        if (currentHandVector.lengthSq() === 0) return; // Avoid division by zero
                        currentHandVector.normalize();

                        // Compute angle difference between initial and current vectors
                        const initialVector = hand.userData.initialHandVectorXZ;
                        const dot = initialVector.dot(currentHandVector);
                        const crossY = initialVector.x * currentHandVector.z - initialVector.z * currentHandVector.x; // Cross product in Y

                        let angle = Math.atan2(crossY, dot); // Angle in radians
                        angle = THREE.MathUtils.radToDeg(angle); // Convert to degrees

                        // Invert the angle to change rotation direction
                        lon = hand.userData.initialLon - angle;
                    }
                }
            }
        });
    }
}

// Handle keyboard input
function onKeyDown(event) {
    const isVRPresenting = renderer.xr.isPresenting;
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
        case 'ArrowUp':
        case 'KeyW':
            if (!isVRPresenting) {
                rotateSceneDown();
                event.preventDefault();
            }
            break;
        case 'ArrowDown':
        case 'KeyS':
            if (!isVRPresenting) {
                rotateSceneUp();
                event.preventDefault();
            }
            break;
    }
}

// Rotate the scene left
function rotateSceneLeft() {
    lon -= rotation_angle;
}

// Rotate the scene right
function rotateSceneRight() {
    lon += rotation_angle;
}

// Rotate the scene up
function rotateSceneUp() {
    lat += rotation_angle;
    // Clamp latitude to prevent flipping over the poles
    lat = Math.max(-max_lat, Math.min(max_lat, lat));
}

// Rotate the scene down
function rotateSceneDown() {
    lat -= rotation_angle;
    // Clamp latitude to prevent flipping over the poles
    lat = Math.max(-max_lat, Math.min(max_lat, lat));
}

// Mouse and touch event handlers for rotation
function onPointerDown(event) {
    isUserInteracting = true;
    event.preventDefault();

    if (event.type === 'touchstart') {
        onPointerDownMouseX = event.touches[0].pageX;
        onPointerDownMouseY = event.touches[0].pageY;
    } else {
        onPointerDownMouseX = event.clientX;
        onPointerDownMouseY = event.clientY;
    }

    onPointerDownLon = lon;
    onPointerDownLat = lat;
}

function onPointerMove(event) {
    if (isUserInteracting) {
        let clientX, clientY;
        if (event.type === 'touchmove') {
            clientX = event.touches[0].pageX;
            clientY = event.touches[0].pageY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        lon = (onPointerDownMouseX - clientX) * rotationSensitivityX + onPointerDownLon;

        if (!renderer.xr.isPresenting) {
            lat = (onPointerDownMouseY - clientY) * rotationSensitivityY + onPointerDownLat;
            lat = Math.max(-max_lat, Math.min(max_lat, lat)); // Clamp latitude to prevent flipping over the poles
        }
    }
}

function onPointerUp() {
    isUserInteracting = false;
}

function onSelectStart(event) {
    const controller = event.target;
    controller.userData.isSelecting = true;
    controller.userData.needsInitialPosition = true; // We need to record initial positions in the next frame
}

function onSelectEnd(event) {
    const controller = event.target;
    controller.userData.isSelecting = false;
    controller.userData.initialControllerVectorXZ = null;
    controller.userData.needsInitialPosition = false;
}