import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

let visualizerWindow = null;
let visualizerUrl = null;

app.registerExtension({
  name: "ComfyUI.EnvironmentVisualizerExtension",
  async setup() {
    
    // Add separator on ComfyUI sidebar
		const separator = document.createElement("hr");
		separator.style.margin = "20px 0";
		separator.style.width = "100%";
    const menu = document.querySelector(".comfy-menu");
		menu.append(separator);

    // Add environment visualizer link button below separator
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

    // Register listener for node completion
    api.addEventListener("executed", nodeCompletedHandler)
  },
});

function nodeCompletedHandler(event) {
  if (event.detail.output && event.detail.output.env_port && event.detail.output.env_name) {
    const port = event.detail.output.env_port.join('');
    const name = event.detail.output.env_name.join('');
    const currentUrl = new URL(window.location.href);
    const url = `https://${currentUrl.hostname}:${port}/environments.html?env=${name}`;
    window.open(url, '_blank');
  }
}