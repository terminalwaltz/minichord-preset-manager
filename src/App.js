import React, { useState, useEffect } from "react";
import MiniChordController from "./minichordcontroller";
import "./styles.css";

function PresetManager() {
  const [presetState, setPresetState] = useState({
    presets: Array.from({ length: 12 }, (_, id) => ({
      id,
      title: `Preset ${id + 1}`,
      author: "",
      note: "",
      values: new Array(256).fill(0),
    })),
  });
  const [selected, setSelected] = useState([]);
  const [controller, setController] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState({
    connected: false,
    message: "minichord unconnected",
  });
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [activeBank, setActiveBank] = useState(-1);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [bulkEditAddress, setBulkEditAddress] = useState(null);
  const [bulkEditValue, setBulkEditValue] = useState(null);

  const getPresetColor = (preset) => {
    const hue = preset.values[20] || 0;
    return `hsl(${hue}, 100%, 50%)`;
  };

  useEffect(() => {
    let isMounted = true;
    console.log(">> Initializing MiniChordController");
    const ctrl = new MiniChordController();
    setController(ctrl);
    ctrl.onConnectionChange = (connected, message) => {
      if (!isMounted) return;
      console.log("Connection change:", { connected, message });
      setConnectionStatus({
        connected,
        message: connected ? "minichord connected" : message || "minichord disconnected",
      });
    };
    ctrl.onDataReceived = (data) => {
      if (!isMounted) return;
      console.log("Single preset data received:", data);
      setPresetState((prev) => {
        const newPresets = [...prev.presets];
        if (data.bankNumber !== undefined) {
          newPresets[data.bankNumber] = {
            ...newPresets[data.bankNumber],
            values: data.parameters.map((v, i) =>
              ctrl.potentiometer_memory_adress.includes(i)
                ? 512
                : ctrl.volume_memory_adress.includes(i)
                ? 50
                : v === undefined
                ? prev.presets[data.bankNumber].values[i]
                : v
            ),
          };
          setActiveBank(data.bankNumber);
        }
        return { presets: newPresets };
      });
    };
    ctrl.onAllPresetsReceived = (allPresets) => {
      if (!isMounted) return;
      console.log("All presets received:", allPresets);
      setIsLoadingPresets(false);
      setPresetState((prev) => ({
        presets: allPresets.map((preset, index) => ({
          id: index,
          title: prev.presets[index]?.title || `Preset ${index + 1}`,
          author: prev.presets[index]?.author || "",
          note: prev.presets[index]?.note || "",
          values: preset.parameters.map((v) => Math.max(0, Math.min(32767, v))),
        })),
      }));
    };
    ctrl.initialize().then((success) => {
      if (!isMounted) return;
      console.log("MIDI initialization:", success ? "successful" : "failed");
      if (success && ctrl.isConnected()) {
        setConnectionStatus({
          connected: true,
          message: "minichord connected",
        });
        setIsLoadingPresets(true);
        ctrl.fetchAllPresets().then((success) => {
          if (!isMounted) return;
          if (!success) {
            setIsLoadingPresets(false);
            setConnectionStatus({
              connected: false,
              message: "Failed to fetch presets: no device connected",
            });
          }
        }).catch((error) => {
          if (!isMounted) return;
          console.error("Error fetching presets:", error);
          setIsLoadingPresets(false);
          setConnectionStatus({
            connected: false,
            message: `Failed to fetch presets: ${error.message}`,
          });
        });
      } else {
        console.error("MIDI initialization failed: no device found");
        setConnectionStatus({
          connected: false,
          message: "minichord not found",
        });
      }
    }).catch((error) => {
      if (!isMounted) return;
      console.error("MIDI initialization error:", error);
      setConnectionStatus({
        connected: false,
        message: `minichord error: ${error.message}`,
      });
    });
    return () => {
      isMounted = false;
      ctrl.onConnectionChange = null;
      ctrl.onDataReceived = null;
      ctrl.onAllPresetsReceived = null;
    };
  }, []);

  const handleFetchAllPresets = () => {
    if (controller && controller.isConnected()) {
      setIsLoadingPresets(true);
      controller.fetchAllPresets().then((success) => {
        if (success) {
          console.log(">> Fetch all presets initiated");
        } else {
          setIsLoadingPresets(false);
          setConnectionStatus({
            connected: false,
            message: "Failed to fetch presets: no device connected",
          });
        }
      }).catch((error) => {
        console.error("Error fetching presets:", error);
        setIsLoadingPresets(false);
        setConnectionStatus({
          connected: false,
          message: `Failed to fetch presets: ${error.message}`,
        });
      });
    } else {
      alert("No device connected");
    }
  };

const scaledAddresses = [
  24, 25, 26, 27, 28, 29, 32, 41, 46, 50, 51, 55, 58, 60, 61, 63, 64, 68, 71,
  76, 79, 80, 81, 82, 83, 84, 85, 86, 89, 90, 91, 92, 94, 95, 96, 97, 121,
  123, 124, 126, 127, 129, 130, 131, 132, 133, 134, 144, 145, 149, 154, 155,
  157, 158, 159, 161, 162, 163, 167, 170, 178, 179, 180, 181, 182, 183, 184,
  185, 190, 193, 194, 195, 196, 197
];

const handleBulkEdit = async () => {
  if (bulkEditAddress == null || bulkEditValue == null) {
    alert("Please enter a valid address (0-255) and value");
    return;
  }
  if (bulkEditAddress < 0 || bulkEditAddress > 255) {
    alert("Address must be 0-255");
    return;
  }

  const isScaled = scaledAddresses.includes(bulkEditAddress);
  const maxValue = isScaled ? 100 : 16383;
  const adjustedValue = isScaled ? Math.round(bulkEditValue * 100) : bulkEditValue;

  if (bulkEditValue < 0 || bulkEditValue > maxValue) {
    alert(`Value must be 0-${maxValue} for address ${bulkEditAddress}${isScaled ? " (scaled to 0-100.0)" : ""}`);
    return;
  }

  if (!controller || !controller.isConnected()) {
    console.error(">> No device connected for bulk edit upload");
    alert("No device connected");
    return;
  }

  setPresetState((prev) => {
    const newPresets = [...prev.presets];
    const targetIndexes = selected.length > 0 ? selected : prev.presets.map((_, i) => i);

    targetIndexes.forEach((index) => {
      newPresets[index] = {
        ...newPresets[index],
        values: newPresets[index].values.map((v, i) =>
          i === bulkEditAddress ? adjustedValue : v
        ),
      };
    });

    // Perform upload inside the callback to ensure newPresets is available
    const presetsToUpload = newPresets
      .filter((_, index) => selected.length > 0 ? selected.includes(index) : true)
      .map((preset, index) => ({
        value: btoa(preset.values.join(';')),
        name: preset.title,
        author: preset.author,
        description: preset.note,
      }));

    console.log(`>> Bulk edit: Setting address ${bulkEditAddress} to ${adjustedValue} for presets ${selected.length > 0 ? selected.join(',') : 'all'}`);

    // Async upload inside setState callback
    (async () => {
      try {
        setIsLoadingPresets(true);
        const success = await controller.uploadAllPresets(presetsToUpload);
        setIsLoadingPresets(false);
        if (success) {
          console.log(">> Bulk edit upload successful");
          alert("Bulk edit applied and uploaded successfully");
        } else {
          console.error(">> Bulk edit upload failed");
          alert("Failed to upload presets: device not connected or invalid data");
        }
      } catch (error) {
        setIsLoadingPresets(false);
        console.error(`>> Error uploading presets: ${error.message}`);
        alert(`Error uploading presets: ${error.message}`);
      }
    })();

    return { presets: newPresets };
  });
};

// Add new function for uploading reordered presets
const handleUploadOrder = async () => {
  if (!controller || !controller.isConnected()) {
    console.error(">> No device connected for preset order upload");
    alert("No device connected");
    return;
  }

  const presetsToUpload = presetState.presets.map((preset) => ({
    value: btoa(preset.values.join(';')),
    name: preset.title,
    author: preset.author,
    description: preset.note,
  }));

  console.log(">> Initiating preset order upload");
  try {
    setIsLoadingPresets(true);
    const success = await controller.uploadAllPresets(presetsToUpload);
    setIsLoadingPresets(false);
    if (success) {
      console.log(">> Preset order upload successful");
      alert("Preset order uploaded successfully");
    } else {
      console.error(">> Preset order upload failed");
      alert("Failed to upload preset order: device not connected or invalid data");
    }
  } catch (error) {
    setIsLoadingPresets(false);
    console.error(`>> Error uploading preset order: ${error.message}`);
    alert(`Error uploading preset order: ${error.message}`);
  }
};

  const handlePresetSelect = (index) => {
    setSelected((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
  };

const handleDrop = (index) => {
  if (draggedIndex === null || draggedIndex === index) return;

  setPresetState((prev) => {
    const newPresets = [...prev.presets];
    const [draggedPreset] = newPresets.splice(draggedIndex, 1);
    newPresets.splice(index, 0, draggedPreset);
    newPresets.forEach((preset, i) => (preset.id = i));
    console.log(`>> Reordered presets: ${newPresets.map(p => p.id).join(',')}`);
    return { presets: newPresets };
  });

  setDraggedIndex(null);
};



const handleFileUpload = async (event) => {
  console.log(">> File upload triggered");
  if (!controller || !controller.isConnected()) {
    console.error("Error: Controller not initialized or not connected");
    alert("No device connected");
    return;
  }
  const fileInput = event.target;
  const file = fileInput.files[0];
  if (!file) {
    console.error("Error: No file selected");
    alert("No file selected");
    return;
  }
  console.log(`>> Reading file: ${file.name}, size: ${file.size} bytes, type: ${file.type}`);
  const reader = new FileReader();
  reader.onload = async () => {
    console.log(">> Starting reader.onload");
    if (!reader.result) {
      console.error("Error: FileReader result is undefined or empty");
      alert("Failed to read file: No content");
      return;
    }
    try {
      console.log(">> Parsing JSON");
      const jsonData = JSON.parse(reader.result);
      console.log(">> JSON parsed, preset count:", jsonData.presets?.length || 0);

      if (!jsonData.presets || !Array.isArray(jsonData.presets)) {
        console.error(`Error: JSON must contain a 'presets' array, got ${typeof jsonData.presets}`);
        alert("Invalid JSON: Expected 'presets' array");
        return;
      }
      console.log(">> Presets array validated, length:", jsonData.presets.length);

      const validPresets = [];
      const newPresetState = jsonData.presets.map((preset, index) => {
        console.log(`>> Processing preset ${index}`);
        let parameters = new Array(256).fill(0); // Default to zeros
        let base64Value = preset?.value || "";
        let presetName = preset?.name || `Preset ${index + 1}`;
        let presetAuthor = preset?.author || "";
        let presetDescription = preset?.description || "";

        if (!base64Value || typeof base64Value !== 'string') {
          console.warn(`Warning: Preset ${index} missing or invalid 'value' field, using default values`);
        } else {
          try {
            console.log(`>> Raw Base64 for preset ${index}: ${base64Value.substring(0, 50)}...`);
            const numberString = atob(base64Value.replace(/[^A-Za-z0-9+/=]/g, '')).replace(/;+$/, '');
            console.log(`>> Decoded string length for preset ${index}: ${numberString.length}`);
            parameters = numberString.split(';').map(num => {
              const value = parseInt(num, 10);
              return isNaN(value) || value < 0 || value > 16383 ? 0 : value;
            });
            console.log(`>> Parsed ${parameters.length} parameters for preset ${index}`);
            if (parameters.length !== 256) {
              console.warn(`Warning: Preset ${index} has ${parameters.length} parameters, expected 256. Padding with zeros.`);
              while (parameters.length < 256) {
                parameters.push(0);
              }
            }
          } catch (error) {
            console.error(`Error: Failed to decode Base64 for preset ${index}: ${error.message}`);
            console.warn(`Warning: Using default values for preset ${index}`);
            parameters = new Array(256).fill(0);
          }
        }

        validPresets.push({
          value: btoa(parameters.join(';')),
          name: presetName,
          author: presetAuthor,
          description: presetDescription,
        });
        console.log(`>> Added preset ${index} to validPresets`);

        return {
          id: index,
          title: presetName,
          author: presetAuthor,
          note: presetDescription,
          values: parameters,
        };
      });

      setPresetState({ presets: newPresetState });
      console.log(">> Valid presets count:", validPresets.length);
      if (validPresets.length === 0) {
        console.error("Error: No valid presets to upload");
        alert("No valid presets to upload");
        return;
      }

      try {
        console.log(">> Calling uploadAllPresets with", validPresets.length, "valid presets");
        const success = await controller.uploadAllPresets(validPresets);
        if (success) {
          console.log(">> Finished uploadAllPresets");
          alert("Presets uploaded successfully");
        } else {
          console.error("Error: uploadAllPresets failed");
          alert("Failed to upload presets: Device not connected or invalid data");
        }
      } catch (error) {
        console.error(`Error: Failed to upload presets: ${error.message}`);
        alert(`Error uploading presets: ${error.message}`);
      }
    } catch (error) {
      console.error("Error in reader.onload:", error);
      alert(`Error processing file: ${error.message}`);
    }
  };
  reader.onerror = () => {
    console.error("Error reading file:", reader.error);
    alert(`Error reading file: ${reader.error}`);
  };
  reader.readAsText(file);
  fileInput.value = '';
};

const handleSavePresets = () => {
  console.log(">> Saving presets to JSON");
  const jsonData = {
    presets: presetState.presets.map(preset => ({
      name: preset.title,
      author: preset.author,
      description: preset.note,
      value: btoa(preset.values.join(';'))
    }))
  };
  const jsonString = JSON.stringify(jsonData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'minichord_presets.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log(">> Presets saved to file");
};

  const handleResetMemory = () => {
    if (controller && controller.isConnected()) {
      controller.resetMemory();
      setPresetState({
        presets: Array.from({ length: 12 }, (_, id) => ({
          id,
          title: `Preset ${id + 1}`,
          author: "",
          note: "",
          values: new Array(256).fill(0),
        })),
      });
    }
  };

  const handlePresetChange = (index, field, value) => {
    setPresetState((prev) => {
      const newPresets = [...prev.presets];
      newPresets[index] = { ...newPresets[index], [field]: value };
      return { presets: newPresets };
    });
  };

  return (
    <div className="preset-manager">
      <h1>MiniChord Preset Manager</h1>
      <div className="connection-status">
        {connectionStatus.connected ? (
          <span className="connected">
            <span className="dot"></span> {connectionStatus.message}
          </span>
        ) : (
          <span className="disconnected">
            <span className="dot"></span> {connectionStatus.message}
          </span>
        )}
      </div>
      {isLoadingPresets && <div className="loading">Loading presets...</div>}
      <div className="controls">
        <button onClick={handleSavePresets} disabled={!controller?.isConnected()}>
          Export Presets (JSON)
        </button>
        <input
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          style={{ display: "none" }}
          id="file-upload"
        />
        <label htmlFor="file-upload">
          <button
            type="button"
            disabled={!controller?.isConnected()}
            onClick={() => document.getElementById("file-upload").click()}
          >
            Import Presets (JSON)
          </button>
        </label>
        <button
          onClick={handleResetMemory}
          disabled={!controller?.isConnected()}
        >
          Wipe Memory
        </button>
        <button
          onClick={handleFetchAllPresets}
          disabled={!controller?.isConnected()}
        >
          Fetch All Presets
        </button>
        <button
        onClick={() => setSelected(presetState.presets.map((_, index) => index))}
        disabled={!controller?.isConnected()}
      >
        Select All Presets
      </button>
        <button
          onClick={handleUploadOrder}
          disabled={!controller?.isConnected()}
        >
          Upload Order
        </button>
        <div className="bulk-edit">
          <input
            type="number"
            min="0"
            max="255"
            placeholder="Address (0-255)"
            onChange={(e) => setBulkEditAddress(Number(e.target.value))}
          />
          <input
            type="number"
            min="0"
            max="32767"
            placeholder="Value (0-32767)"
            onChange={(e) => setBulkEditValue(Number(e.target.value))}
          />
          <button
            onClick={handleBulkEdit}
            disabled={!controller?.isConnected() || selected.length === 0}
          >
            Apply to Selected
          </button>
        </div>
      </div>
      <div className="presets">
        {presetState.presets.map((preset, index) => (
          <div
            key={preset.id}
            className={`preset ${selected.includes(index) ? "selected" : ""} ${
              activeBank === index ? "active" : ""
            }`}
            style={{ borderColor: getPresetColor(preset) }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              handleDragStart(index);
            }}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => {
              e.stopPropagation();
              handleDrop(index);
            }}
            onClick={(e) => {
              e.stopPropagation();
              handlePresetSelect(index);
            }}
          >
            <input
              type="text"
              value={preset.title}
              onChange={(e) => handlePresetChange(index, "title", e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Preset Title"
            />
            <input
              type="text"
              value={preset.author}
              onChange={(e) => handlePresetChange(index, "author", e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Author"
            />
            <textarea
              value={preset.note}
              onChange={(e) => handlePresetChange(index, "note", e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Note"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PresetManager;