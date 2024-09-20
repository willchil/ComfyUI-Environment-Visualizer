import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

let visualizerWindow = null;
let visualizerUrl = null;

app.registerExtension({
  name: "ComfyUI.EnvironmentVisualizerExtension",
  async setup() {
    const menu = document.querySelector(".comfy-menu");
		const separator = document.createElement("hr");

		separator.style.margin = "20px 0";
		separator.style.width = "100%";
		menu.append(separator);

		const managerButton = document.createElement("button");
		managerButton.textContent = "Environment Visualizer";
		managerButton.onclick = async function() {
        if (visualizerUrl == null) {
          try {
            let responseData = await api.fetchApi("/get_url", {
              method: "POST",
            });
  
            // Error handling
            if (responseData.status != 200) {
              console.log(
                "Error [" + responseData.status + "] > " + responseData.statusText
              );
              return;
            }
            responseData = await responseData?.json();
            if (!responseData || responseData == undefined || !responseData.hasOwnProperty("port")) {
              console.log("Error: Could not get environment visualizer URL.");
              return;
            }

            const currentUrl = new URL(window.location.href);
            visualizerUrl = `https://${currentUrl.hostname}:${responseData.port}`;
          } catch (e) {
            throw new Error(e);
          }
        }

        // Open or focus the visualizer window
        if (!visualizerWindow || visualizerWindow.closed) {
          visualizerWindow = window.open(visualizerUrl, '_blank');
        } else {
          visualizerWindow.focus();
        }
        
			}
		menu.append(managerButton);
  },
});