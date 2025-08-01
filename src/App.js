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
          values: preset.parameters,
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

  const handleBulkEdit = () => {
    if (bulkEditAddress == null || bulkEditValue == null) {
      alert("Please enter a valid address (0-255) and value (0-32767)");
      return;
    }
    if (bulkEditAddress < 0 || bulkEditAddress > 255 || bulkEditValue < 0 || bulkEditValue > 32767) {
      alert("Address must be 0-255 and value must be 0-32767");
      return;
    }
    setPresetState((prev) => {
      const newPresets = [...prev.presets];
      selected.forEach((index) => {
        newPresets[index] = {
          ...newPresets[index],
          values: newPresets[index].values.map((v, i) =>
            i === bulkEditAddress ? bulkEditValue : v
          ),
        };
      });
      if (controller && controller.isConnected()) {
        controller.uploadAllPresets(newPresets);
      }
      return { presets: newPresets };
    });
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
    const newPresets = [...presetState.presets];
    const [draggedPreset] = newPresets.splice(draggedIndex, 1);
    newPresets.splice(index, 0, draggedPreset);
    newPresets.forEach((preset, i) => (preset.id = i));
    setPresetState({ presets: newPresets });
    setDraggedIndex(null);
    if (controller && controller.isConnected()) {
      controller.uploadAllPresets(newPresets);
    }
  };

  const handleFileUpload = (event) => {
    console.log(">> File upload triggered");
    const file = event.target.files[0];
    if (!file) {
      console.log(">> No file selected");
      return;
    }
    console.log(">> Reading file:", file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        console.log(">> Parsing JSON");
        const jsonData = JSON.parse(e.target.result);
        if (validatePresetData(jsonData)) {
          console.log(">> Valid preset data, updating state");
          const newPresets = jsonData.presets.map((preset, index) => ({
            id: index,
            title: preset.name || `Preset ${index + 1}`,
            author: preset.author || "",
            note: preset.description || "",
            values: atob(preset.value)
              .split(";")
              .map(Number)
              .slice(0, 256),
          }));
          setPresetState({ presets: newPresets });
          if (controller && controller.isConnected()) {
            console.log(">> Sending SysEx for import");
            controller.uploadAllPresets(newPresets);
          }
        } else {
          console.error(">> Invalid preset file format");
          alert("Invalid preset file format");
        }
      } catch (error) {
        console.error(">> Error reading preset file:", error);
        alert("Error reading preset file");
      }
    };
    reader.readAsText(file);
  };

  const validatePresetData = (data) => {
    return (
      data &&
      data.presets &&
      Array.isArray(data.presets) &&
      data.presets.length === 12 &&
      data.presets.every((preset) => {
        try {
          const values = atob(preset.value).split(";").map(Number);
          return (
            preset.name &&
            typeof preset.name === "string" &&
            typeof preset.author === "string" &&
            typeof preset.description === "string" &&
            values.length === 256 &&
            values.every((v) => !isNaN(v) && v >= 0 && v <= 32767)
          );
        } catch (e) {
          return false;
        }
      })
    );
  };

  const handleSavePresets = () => {
    const jsonData = {
      presets: presetState.presets.map((preset) => ({
        name: preset.title,
        author: preset.author,
        value: btoa(preset.values.join(";")),
        description: preset.note,
      })),
    };
    const dataStr = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "minichord_presets.json";
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem("presets", dataStr);
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