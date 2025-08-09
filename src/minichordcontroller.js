class MiniChordController {
  constructor() {
    this.device = false;
    this.parameter_size = 256;
    this.preset_number = 12;
    this.color_hue_sysex_adress = 20;
    this.base_adress_rythm = 220;
    this.potentiometer_memory_adress = [4, 5, 6];
    this.modulation_adress = [14, 10, 12, 16];
    this.volume_memory_adress = [2, 3];
    this.active_bank_number = -1;
    this.min_firmware_accepted = 0.02;
    this.firmware_adress = 7;
    this.float_multiplier = 100.0;
    this.MIDI_request_option = {
      sysex: true,
      software: false,
    };
    this.onConnectionChange = null;
    this.onDataReceived = null;
    this.onAllPresetsReceived = null;
    this.json_reference = "../json/minichord.json";
    this.sysexBuffer = []; // Buffer for accumulating SysEx chunks
  }

  async initialize() {
    try {
      console.log(">> Requesting MIDI access");
      const midiAccess = await navigator.requestMIDIAccess(this.MIDI_request_option);
      console.log(">> MIDI access granted");
      this.handleMIDIAccess(midiAccess);
      midiAccess.onstatechange = (event) => this.handleStateChange(event);
      return this.device !== false;
    } catch (error) {
      console.error(">> ERROR: MIDI access failed:", error);
      if (this.onConnectionChange) {
        this.onConnectionChange(false, `MIDI access failed: ${error.message}`);
      }
      return false;
    }
  }

  handleMIDIAccess(midiAccess) {
    console.log(">> Available outputs:");
    for (const entry of midiAccess.outputs) {
      const output = entry[1];
      if (output.name.includes("minichord") && (output.name.includes("1") || output.name === "minichord")) {
        console.log(
          `>>>> minichord sysex control port [type:'${output.type}'] id: '${output.id}' manufacturer: '${output.manufacturer}' name: '${output.name}' version: '${output.version}'`
        );
        this.device = output;
        const sysex_message = [0xF0, 0, 0, 0, 0, 0xF7];
        try {
          this.device.send(sysex_message);
          console.log(">> Sent initial SysEx message");
        } catch (error) {
          console.error(">> ERROR: Failed to send initial SysEx:", error);
        }
      } else {
        console.log(
          `>>>> Other port [type:'${output.type}'] id: '${output.id}' manufacturer: '${output.manufacturer}' name: '${output.name}' version: '${output.version}'`
        );
      }
    }
    console.log(">> Available inputs:");
    for (const entry of midiAccess.inputs) {
      const input = entry[1];
      if (input.name.includes("minichord") && (input.name.includes("1") || input.name === "minichord")) {
        input.onmidimessage = (message) => this.processCurrentData(message);
        console.log(
          `>>>> minichord sysex control port [type:'${input.type}'] id: '${input.id}' manufacturer: '${input.manufacturer}' name: '${input.name}' version: '${input.version}'`
        );
      } else {
        console.log(
          `>>>> Other port [type:'${input.type}'] id: '${input.id}' manufacturer: '${input.manufacturer}' name: '${input.name}' version: '${input.version}'`
        );
      }
    }
    if (this.device === false) {
      console.log(">> ERROR: no minichord device found");
      if (this.onConnectionChange) {
        this.onConnectionChange(false, "Make sure the minichord is connected to the computer and turned on");
      }
    } else {
      console.log(">> minichord successfully connected");
      if (this.onConnectionChange) {
        this.onConnectionChange(true, "minichord connected");
      }
    }
  }

  handleStateChange(event) {
    console.log(">> MIDI state change received:", event.port.name, event.port.state);
    if (
      event.port.state === "disconnected" &&
      this.device !== false &&
      (event.port.name === "minichord Port 1" || event.port.name === "minichord")
    ) {
      console.log(">> minichord was disconnected");
      this.device = false;
      if (this.onConnectionChange) {
        this.onConnectionChange(false, "minichord disconnected, please reconnect");
      }
    }
    if (
      event.port.state === "connected" &&
      this.device === false &&
      (event.port.name === "minichord Port 1" || event.port.name === "minichord")
    ) {
      console.log(">> a new device was connected");
      this.handleMIDIAccess(event.target);
    }
  }

processCurrentData(midiMessage) {
  const data = midiMessage.data;
  // Accumulate SysEx chunks
  if (data[0] === 0xF0) {
    this.sysexBuffer = [...data];
    console.log(">> Started SysEx message, length:", data.length);
  } else if (this.sysexBuffer.length > 0) {
    this.sysexBuffer = [...this.sysexBuffer, ...data];
    console.log(">> Appended SysEx chunk, total length:", this.sysexBuffer.length);
  } else {
    console.log(">> Ignoring non-SysEx message or invalid continuation");
    return;
  }

  // Check for complete SysEx message
  if (this.sysexBuffer.length > 0 && this.sysexBuffer[this.sysexBuffer.length - 1] === 0xF7) {
    console.log(">> Complete SysEx message received, length:", this.sysexBuffer.length);

    const expectedSinglePresetLength = 516; // F0 00 00 02 bank 512_bytes F7
    const expectedLegacyPresetLength = 514; // F0 512_bytes F7
    const expectedAllPresetsLength = 6146; // F0 00 00 04 00 6144_bytes F7

    // Check if it's a valid SysEx message
    if (this.sysexBuffer.length < 6 || this.sysexBuffer[0] !== 0xF0) {
      console.log(">> Ignoring invalid SysEx message (incorrect format or too short), first 10 bytes:", 
        this.sysexBuffer.slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join(' '));
      this.sysexBuffer = [];
      return;
    }

    // Handle legacy messages (514 bytes, command 0x00)
    if (this.sysexBuffer.length === expectedLegacyPresetLength) {
      console.log(">> Processing legacy single preset (command 0x00)");
      const bank = this.sysexBuffer[3] + (this.sysexBuffer[4] << 7); // Bank from parameter 1 (LSB-first)
      const payloadStart = 1; // Parameters start after F0

      const processedData = {
        parameters: new Array(this.parameter_size).fill(0),
        rhythmData: [],
        bankNumber: bank,
        firmwareVersion: 0,
      };

      // Extract 256 parameters
      for (let i = 0; i < this.parameter_size; i++) {
        const offset = payloadStart + 2 * i;
        if (offset + 1 >= this.sysexBuffer.length) {
          console.warn(`>> Warning: Legacy SysEx too short for 256 parameters, length: ${this.sysexBuffer.length}`);
          this.sysexBuffer = [];
          return;
        }
        const sysex_value = this.sysexBuffer[offset] + (this.sysexBuffer[offset + 1] << 7); // LSB-first
        if (i === this.firmware_adress) {
          processedData.firmwareVersion = sysex_value / this.float_multiplier;
          if (processedData.firmwareVersion < this.min_firmware_accepted) {
            alert("Please update the minichord firmware");
          }
        } else if (i >= this.base_adress_rythm && i < this.base_adress_rythm + 16) {
          const j = i - this.base_adress_rythm;
          const rhythmBits = [];
          for (let k = 0; k < 7; k++) {
            rhythmBits[k] = !!(sysex_value & (1 << k));
          }
          processedData.rhythmData[j] = rhythmBits;
          processedData.parameters[i] = sysex_value; // Explicitly set to preserve original value
        } else {
          processedData.parameters[i] = sysex_value;
        }
      }

      this.active_bank_number = processedData.bankNumber;
      console.log(`>> Processed legacy single preset for bank ${bank}, first 5 parameters:`, 
        processedData.parameters.slice(0, 5), `firmware: ${processedData.firmwareVersion}`);
      if (this.onDataReceived) {
        this.onDataReceived(processedData);
      }
    } 
    // Handle new format messages (516 or 6146 bytes)
    else if (this.sysexBuffer[1] === 0x00 && this.sysexBuffer[2] === 0x00) {
      const command = this.sysexBuffer[3];
      const bank = this.sysexBuffer[4];

      // Process new single preset (command 0x02, 516 bytes)
      if (command === 0x02 && this.sysexBuffer.length === expectedSinglePresetLength) {
        console.log(">> Processing new single preset (command 0x02)");
        const processedData = {
          parameters: new Array(this.parameter_size).fill(0),
          rhythmData: [],
          bankNumber: bank,
          firmwareVersion: 0,
        };

        // Extract 256 parameters from bytes 5 to 516
        for (let i = 0; i < this.parameter_size; i++) {
          const offset = 5 + 2 * i;
          const sysex_value = this.sysexBuffer[offset] + (this.sysexBuffer[offset + 1] << 7); // LSB-first
          if (i === this.firmware_adress) {
            processedData.firmwareVersion = sysex_value / this.float_multiplier;
            if (processedData.firmwareVersion < this.min_firmware_accepted) {
              alert("Please update the minichord firmware");
            }
          } else if (i >= this.base_adress_rythm && i < this.base_adress_rythm + 16) {
            const j = i - this.base_adress_rythm;
            const rhythmBits = [];
            for (let k = 0; k < 7; k++) {
              rhythmBits[k] = !!(sysex_value & (1 << k));
            }
            processedData.rhythmData[j] = rhythmBits;
            processedData.parameters[i] = sysex_value; // Explicitly set to preserve original value
          } else {
            processedData.parameters[i] = sysex_value;
          }
        }

        this.active_bank_number = processedData.bankNumber;
        console.log(`>> Processed new single preset for bank ${bank}, first 5 parameters:`, 
          processedData.parameters.slice(0, 5), `firmware: ${processedData.firmwareVersion}`);
        if (this.onDataReceived) {
          this.onDataReceived(processedData);
        }
      } 
      // Process all presets (command 0x04, 6146 bytes)
      else if (command === 0x04 && this.sysexBuffer.length === expectedAllPresetsLength) {
        console.log(`>> Processing all presets data (${this.sysexBuffer.length} bytes)`);
        const allPresets = [];
        for (let bank = 0; bank < this.preset_number; bank++) {
          const parameters = new Array(this.parameter_size).fill(0);
          for (let i = 0; i < this.parameter_size; i++) {
            const offset = 5 + bank * this.parameter_size * 2 + 2 * i;
            const sysex_value = this.sysexBuffer[offset] + (this.sysexBuffer[offset + 1] << 7); // LSB-first
            parameters[i] = sysex_value;
          }
          allPresets[bank] = { bankNumber: bank, parameters };
        }
        if (this.onAllPresetsReceived) {
          this.onAllPresetsReceived(allPresets);
        }
      } 
      else {
        console.log(`>> Ignoring SysEx message with command 0x${command.toString(16)}, length: ${this.sysexBuffer.length}, first 10 bytes:`, 
          this.sysexBuffer.slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
    } 
    else {
      console.log(">> Ignoring SysEx message with invalid header, length:", this.sysexBuffer.length, 
        "first 10 bytes:", this.sysexBuffer.slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
    this.sysexBuffer = []; // Reset buffer
  } else if (this.sysexBuffer.length > 6146) {
    console.log(">> SysEx buffer overflow, resetting");
    this.sysexBuffer = [];
  }
}

sendParameter(address, value) {
  if (!this.device) {
    console.error(">> ERROR: Cannot send parameter, no device connected");
    return false;
  }
  // Special case: Request current bank data (triggers case 5 in firmware)
  if (address === 0 && value === 0) {
    const sysex_message = [0xF0, 0x00, 0x00, 0x05, 0x00, 0xF7];
    try {
      this.device.send(sysex_message);
      console.log(">> Sent current bank request (case 5)");
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send current bank request: ${error.message}`);
      return false;
    }
  }
  // Standard parameter update
  const first_byte = parseInt(value % 128);
  const second_byte = parseInt(value / 128);
  const first_byte_address = parseInt(address % 128);
  const second_byte_address = parseInt(address / 128);
  const sysex_message = [0xF0, first_byte_address, second_byte_address, first_byte, second_byte, 0xF7];
  try {
    this.device.send(sysex_message);
    console.log(`>> Sent parameter: address=${address}, value=${value}`);
    return true;
  } catch (error) {
    console.error(`>> ERROR: Failed to send parameter: ${error.message}`);
    return false;
  }
}

  async fetchAllPresets() {
    if (!this.device) {
      console.error(">> ERROR: Cannot fetch presets, no device connected");
      return false;
    }
    const sysex_message = [0xF0, 0, 0, 4, 0, 0xF7];
    try {
      this.device.send(sysex_message);
      console.log(">> Sent fetchAllPresets command");
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send fetchAllPresets: ${error.message}`);
      return false;
    }
  }

  async uploadPreset(bank, parameters) {
    if (!this.device) {
      console.error(">> ERROR: No device connected");
      return false;
    }
    if (!Array.isArray(parameters) || parameters.length !== 256) {
      console.error(`>> ERROR: Invalid parameters array, got length ${parameters?.length || 'undefined'}`);
      return false;
    }

    console.log(`>> Uploading preset for bank ${bank}`);
    // Construct 516-byte SysEx: F0 00 00 02 bank 512_bytes F7
    const sysex = new Uint8Array(516);
    sysex[0] = 0xF0; // SysEx start
    sysex[1] = 0x00; // Manufacturer ID (simplified)
    sysex[2] = 0x00;
    sysex[3] = 0x02; // Command: bulk preset upload
    sysex[4] = bank; // Bank number (0–11)

    // Pack 256 parameters as 512 bytes (2 bytes per parameter, LSB-first)
    for (let i = 0; i < 256; i++) {
      const value = Math.max(0, Math.min(16383, parameters[i]));
      sysex[5 + 2 * i] = value & 0x7F; // LSB
      sysex[5 + 2 * i + 1] = (value >> 7) & 0x7F; // MSB
    }
    sysex[515] = 0xF7; // SysEx end

    // Log first and last few bytes for debugging
    console.log(`>> SysEx message for bank ${bank}, first 10 bytes:`, Array.from(sysex.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log(`>> SysEx message for bank ${bank}, last 10 bytes:`, Array.from(sysex.slice(506, 516)).map(b => b.toString(16).padStart(2, '0')).join(' '));

    try {
      await this.device.send(sysex);
      console.log(`>> Successfully sent SysEx for bank ${bank}`);
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send SysEx for bank ${bank}: ${error.message}`);
      return false;
    }
  }

  async uploadAllPresets(presets, targetIndexes) {
    if (!this.device) {
      console.error(">> ERROR: Cannot send presets, no device connected");
      return false;
    }
    if (!Array.isArray(presets) || presets.length === 0) {
      console.error(`Error: Expected non-empty presets array, got ${presets?.length || 'undefined'}`);
      return false;
    }
    if (!Array.isArray(targetIndexes) || targetIndexes.length !== presets.length) {
      console.error(`Error: targetIndexes length (${targetIndexes?.length || 'undefined'}) does not match presets length (${presets.length})`);
      return false;
    }
    console.log(">> Starting uploadAllPresets with", presets.length, "presets for banks", targetIndexes.join(','));
    let success = true;
    for (let i = 0; i < presets.length; i++) {
      const bank = targetIndexes[i];
      const preset = presets[i];
      if (!preset || !preset.value || typeof preset.value !== 'string') {
        console.warn(`>> Skipping preset for bank ${bank}: Missing or invalid 'value' field`);
        success = false;
        continue;
      }
      console.log(`>> Processing preset ${bank}`);
      let parameters;
      try {
        const decodedString = atob(preset.value.replace(/[^A-Za-z0-9+/=]/g, '')).replace(/;+$/, '');
        console.log(`>> Raw preset.value for bank ${bank}:`, preset.value);
        console.log(`>> Decoded string for preset ${bank}:`, decodedString);
        console.log(`>> Decoded string length for preset ${bank}:`, decodedString.length);
        parameters = decodedString.split(';').map(num => {
          const value = parseInt(num, 10);
          return isNaN(value) || value < 0 || value > 16383 ? 0 : value;
        });
        if (parameters.length !== 256) {
          console.error(`>> Error: Preset ${bank} has ${parameters.length} parameters, expected 256. Skipping.`);
          success = false;
          continue;
        }
        console.log(`>> First 5 parameters for preset ${bank}:`, parameters.slice(0, 5));
        const successUpload = await this.uploadPreset(bank, parameters);
        if (!successUpload) {
          console.error(`>> Error: Failed to upload preset ${bank}`);
          success = false;
        } else {
          console.log(`>> Successfully uploaded preset ${bank}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Match firmware delay
      } catch (error) {
        console.error(`>> Error: Failed to process preset ${bank}: ${error.message}`);
        success = false;
      }
    }
    console.log(`>> uploadAllPresets completed, success: ${success}`);
    return success;
  }

  resetMemory() {
    if (!this.device) {
      console.error(">> ERROR: Cannot reset memory, no device connected");
      return false;
    }
    const sysex_message = [0xF0, 0, 0, 1, 0, 0xF7];
    try {
      this.device.send(sysex_message);
      console.log(">> Sent resetMemory command");
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send resetMemory: ${error.message}`);
      return false;
    }
  }

  saveCurrentSettings(bankNumber) {
    if (!this.device) {
      console.error(">> ERROR: Cannot save settings, no device connected");
      return false;
    }
    const sysex_message = [0xF0, 0, 0, 2, bankNumber, 0xF7];
    try {
      this.device.send(sysex_message);
      console.log(`>> Sent saveCurrentSettings command for bank ${bankNumber}`);
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send saveCurrentSettings: ${error.message}`);
      return false;
    }
  }

  resetCurrentBank() {
    if (!this.device || this.active_bank_number === -1) {
      console.error(">> ERROR: Cannot reset bank, no device connected or no active bank");
      return false;
    }
    const sysex_message = [0xF0, 0, 0, 3, this.active_bank_number, 0xF7];
    try {
      this.device.send(sysex_message);
      console.log(`>> Sent resetCurrentBank command for bank ${this.active_bank_number}`);
      return true;
    } catch (error) {
      console.error(`>> ERROR: Failed to send resetCurrentBank: ${error.message}`);
      return false;
    }
  }

  isConnected() {
    return this.device !== false;
  }

  getDeviceInfo() {
    return {
      connected: this.isConnected(),
      activeBankNumber: this.active_bank_number,
      parameterSize: this.parameter_size,
      colorHueAddress: this.color_hue_sysex_adress,
      baseAddressRhythm: this.base_adress_rythm,
      floatMultiplier: this.float_multiplier,
    };
  }
}

export default MiniChordController;