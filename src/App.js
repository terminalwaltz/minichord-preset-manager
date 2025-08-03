import React, { useState, useEffect } from "react";
import MiniChordController from "./minichordcontroller";
import "./styles.css";
import parametersData from './parameters.json';

// Combine parameters, use parameters.json ranges
const validParameters = [
  ...parametersData.global_parameter.map(param => ({
    address: param.sysex_adress,
    name: param.name,
    displayName: `global::${param.name.replace(/\b\w/g, c => c.toUpperCase())}`,
    data_type: param.data_type,
    min_value: param.data_type === "bool" ? 0 : param.min_value,
    max_value: param.data_type === "bool" ? 1 : param.max_value,
    tooltip: param.tooltip
  })),
  ...parametersData.harp_parameter.map(param => ({
    address: param.sysex_adress,
    name: param.name,
    displayName: `harp::${param.name.replace(/\b\w/g, c => c.toUpperCase())}`,
    data_type: param.data_type,
    min_value: param.data_type === "bool" ? 0 : param.min_value,
    max_value: param.data_type === "bool" ? 1 : param.max_value,
    tooltip: param.tooltip
  })),
  ...parametersData.chord_parameter.map(param => ({
    address: param.sysex_adress,
    name: param.name,
    displayName: `chord::${param.name.replace(/\b\w/g, c => c.toUpperCase())}`,
    data_type: param.data_type,
    min_value: param.data_type === "bool" ? 0 : param.min_value,
    max_value: param.data_type === "bool" ? 1 : param.max_value,
    tooltip: param.tooltip
  }))
]
  .filter(param => param.address >= 10 && param.address <= 219)
  .sort((a, b) => a.address - b.address);

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
  const [isUploading, setIsUploading] = useState(false); // New state to prevent concurrent uploads
  const [bulkEdits, setBulkEdits] = useState([{ address: null, value: null }]);

  const getPresetColor = (preset) => {
    const hue = preset.values[20] || 0;
    return `hsl(${hue}, 100%, 50%)`;
  };

  // Consolidated success alert function
  const showUploadSuccess = (message) => {
    console.log(`>> Showing success alert: ${message}`);
    alert(message);
  };

  const addBulkEdit = () => {
    setBulkEdits([...bulkEdits, { address: null, value: null }]);
  };

  const removeBulkEdit = (index) => {
    if (bulkEdits.length === 1) return;
    setBulkEdits(bulkEdits.filter((_, i) => i !== index));
  };

  const updateBulkEdit = (index, field, value) => {
    console.log(`>> updateBulkEdit: index=${index}, field=${field}, value=${value}, address=${bulkEdits[index]?.address}, param=${validParameters.find(p => p.address === bulkEdits[index]?.address)?.displayName}`);
    setBulkEdits((prev) =>
      prev.map((edit, i) =>
        i === index
          ? {
              ...edit,
              [field]: field === "address" ? (value ? Number(value) : null) : (value === "" ? null : Number(value)),
            }
          : edit
      )
    );
  };

  const handleBulkEdit = async () => {
    console.log(">> handleBulkEdit: bulkEdits=", JSON.stringify(bulkEdits));
    if (isUploading) {
      console.log(">> handleBulkEdit: Upload already in progress, skipping");
      return;
    }

    // Validate all bulk edits
    for (const edit of bulkEdits) {
      if (edit.address == null || edit.value == null) {
        alert("Please select a parameter and value for all fields");
        return;
      }
      if (edit.address < 10 || edit.address > 219) {
        alert(`Parameter address ${edit.address} must be between 10 and 219`);
        return;
      }
      const param = validParameters.find((p) => p.address === edit.address);
      if (!param) {
        alert(`Invalid parameter address: ${edit.address}`);
        return;
      }
      const isFloat = param.data_type === "float";
      const isBool = param.data_type === "bool";
      const maxValue = isBool ? 1 : param.max_value || (isFloat ? 100 : 16383);
      const minValue = isBool ? 0 : param.min_value || 0;
      const adjustedValue = isFloat ? Math.round(edit.value * 100) : Math.round(edit.value);
      if (edit.value < minValue || edit.value > maxValue) {
        alert(
          `Value for ${param.displayName} must be between ${minValue} and ${maxValue}${
            isFloat ? " (maps to 0-100.0 in firmware)" : isBool ? " (0 = off, 1 = on)" : ""
          }`
        );
        return;
      }
      if (isBool && ![0, 1].includes(adjustedValue)) {
        alert(`Value for ${param.displayName} must be 0 or 1 (boolean)`);
        return;
      }
    }

    if (!controller || !controller.isConnected()) {
      console.error(">> No device connected for bulk edit upload");
      alert("No device connected");
      return;
    }

    setIsUploading(true); // Lock uploads
    setPresetState((prev) => {
      const newPresets = [...prev.presets];
      const targetIndexes = selected.length > 0 ? selected : prev.presets.map((_, i) => i);

      targetIndexes.forEach((index) => {
        newPresets[index] = {
          ...newPresets[index],
          values: newPresets[index].values.map((v, i) => {
            const edit = bulkEdits.find((e) => e.address === i);
            if (edit) {
              const param = validParameters.find((p) => p.address === edit.address);
              const isFloat = param.data_type === "float";
              return isFloat ? Math.round(edit.value * 100) : Math.round(edit.value);
            }
            return v;
          }),
        };
      });

      const presetsToUpload = newPresets
        .filter((_, index) => selected.length > 0 ? selected.includes(index) : true)
        .map((preset) => ({
          value: btoa(preset.values.join(';')),
          name: preset.title,
          author: preset.author,
          description: preset.note,
        }));

      console.log(
        `>> Bulk edit: Setting ${bulkEdits
          .map((e) => {
            const param = validParameters.find((p) => p.address === e.address);
            return `${param.displayName} (address ${e.address}) to ${e.value}`;
          })
          .join(", ")} for presets ${selected.length > 0 ? selected.join(',') : 'all'}`
      );

      (async () => {
        try {
          setIsLoadingPresets(true);
          const success = await controller.uploadAllPresets(presetsToUpload);
          setIsLoadingPresets(false);
          setIsUploading(false); // Unlock uploads
          if (success) {
            console.log(">> Bulk edit upload successful");
            showUploadSuccess("Bulk edit applied and uploaded successfully");
            setBulkEdits([{ address: null, value: null }]);
          } else {
            console.error(">> Bulk edit upload failed");
            alert("Failed to upload presets: device not connected or invalid data");
          }
        } catch (error) {
          setIsLoadingPresets(false);
          setIsUploading(false); // Unlock uploads
          console.error(`>> Error uploading presets: ${error.message}`);
          alert(`Error uploading presets: ${error.message}`);
        }
      })();

      return { presets: newPresets };
    });
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

  const handleUploadOrder = async () => {
    if (!controller || !controller.isConnected()) {
      console.error(">> No device connected for preset order upload");
      alert("No device connected");
      return;
    }
    if (isUploading) {
      console.log(">> handleUploadOrder: Upload already in progress, skipping");
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
      setIsUploading(true); // Lock uploads
      setIsLoadingPresets(true);
      const success = await controller.uploadAllPresets(presetsToUpload);
      setIsLoadingPresets(false);
      setIsUploading(false); // Unlock uploads
      if (success) {
        console.log(">> Preset order upload successful");
        showUploadSuccess("Preset order uploaded successfully");
      } else {
        console.error(">> Preset order upload failed");
        alert("Failed to upload preset order: device not connected or invalid data");
      }
    } catch (error) {
      setIsLoadingPresets(false);
      setIsUploading(false); // Unlock uploads
      console.error(`>> Error uploading preset order: ${error.message}`);
      alert(`Error uploading preset order: ${error.message}`);
    }
  };

  const handleFileUpload = async (event) => {
    console.log(">> File upload triggered");
    if (!controller || !controller.isConnected()) {
      console.error("Error: Controller not initialized or not connected");
      alert("No device connected");
      return;
    }
    if (isUploading) {
      console.log(">> handleFileUpload: Upload already in progress, skipping");
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
          let parameters = new Array(256).fill(0);
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
          setIsUploading(true); // Lock uploads
          setIsLoadingPresets(true);
          const success = await controller.uploadAllPresets(validPresets);
          setIsLoadingPresets(false);
          setIsUploading(false); // Unlock uploads
          if (success) {
            console.log(">> File upload successful");
            showUploadSuccess("Presets uploaded successfully");
          } else {
            console.error("Error: uploadAllPresets failed");
            alert("Failed to upload presets: Device not connected or invalid data");
          }
        } catch (error) {
          setIsLoadingPresets(false);
          setIsUploading(false); // Unlock uploads
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

  const handlePresetChange = (index, field, value) => {
    setPresetState((prev) => {
      const newPresets = [...prev.presets];
      newPresets[index] = { ...newPresets[index], [field]: value };
      return { presets: newPresets };
    });
  };

  return (
    <div className="preset-manager">
      <h1>minichord preset manager</h1>
      <div id="status_zone" className={connectionStatus.connected ? "connected" : "disconnected"}>
        <span id="dot"></span>
        <span id="status_value"></span>
      </div>
      {isLoadingPresets && <div className="loading">Loading presets...</div>}
      <div className="controls">
        <div className="button-container">
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
            disabled={!controller?.isConnected() || isUploading}
          >
            Upload Order
          </button>
        </div>
        <div className="bulk-edit-container">
          <div className="bulk-edit">
            {bulkEdits.map((edit, index) => (
              <div key={index} className="bulk-edit-row">
                <select
                  value={edit.address ?? ""}
                  onChange={(e) => updateBulkEdit(index, "address", e.target.value)}
                  title={validParameters.find((p) => p.address === edit.address)?.tooltip || "Select a parameter"}
                >
                  <option value="" disabled>Select Parameter</option>
                  {validParameters.map((param) => (
                    <option key={param.address} value={param.address}>
                      {param.displayName} (Address {param.address})
                    </option>
                  ))}
                </select>
                {validParameters.find((p) => p.address === edit.address)?.data_type === "bool" ? (
                  <select
                    key={`bool-select-${edit.address}`}
                    value={edit.value ?? ""}
                    onChange={(e) => updateBulkEdit(index, "value", e.target.value)}
                    className="bool-select"
                  >
                    <option value="" disabled>Select Value</option>
                    <option value="0">Off (0)</option>
                    <option value="1">On (1)</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    min={validParameters.find((p) => p.address === edit.address)?.min_value || 0}
                    max={validParameters.find((p) => p.address === edit.address)?.max_value || 16383}
                    step={validParameters.find((p) => p.address === edit.address)?.data_type === "float" ? "0.1" : "1"}
                    placeholder={
                      validParameters.find((p) => p.address === edit.address)?.data_type === "float"
                        ? `Value (0-${validParameters.find((p) => p.address === edit.address)?.max_value || 100}, maps to 0-100.0)`
                        : `Value (0-${validParameters.find((p) => p.address === edit.address)?.max_value || 16383})`
                    }
                    value={edit.value ?? ""}
                    onChange={(e) => updateBulkEdit(index, "value", e.target.value)}
                  />
                )}
                {bulkEdits.length > 1 && (
                  <button
                    className="remove-bulk-edit"
                    onClick={() => removeBulkEdit(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              className="add-bulk-edit"
              onClick={addBulkEdit}
              disabled={bulkEdits.length >= validParameters.length}
            >
              Add Parameter
            </button>
            <span className="bulk-edit-note">
              {bulkEdits.every((edit) => edit.address)
                ? bulkEdits
                    .map((edit) => {
                      const param = validParameters.find((p) => p.address === edit.address);
                      return param.data_type === "bool"
                        ? `Select Off (0) or On (1) for ${param.displayName}`
                        : param.data_type === "float"
                        ? `Enter ${param.min_value}-${param.max_value} for ${param.displayName} (maps to 0-100.0 in firmware)`
                        : `Enter ${param.min_value}-${param.max_value} for ${param.displayName}`;
                    })
                    .join("; ")
                : "Select parameters to set value ranges"}
            </span>
            <button
              onClick={handleBulkEdit}
              disabled={!controller?.isConnected() || isUploading}
            >
              Apply to {selected.length > 0 ? "Selected" : "All"}
            </button>
          </div>
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