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
    if (midiMessage.data[0] !== 0xF0 || midiMessage.data[midiMessage.data.length - 1] !== 0xF7) {
      console.log(">> Ignoring invalid SysEx message (missing F0 or F7)");
      return;
    }
    const data = midiMessage.data.slice(1, -1);
    const expectedSinglePresetLength = this.parameter_size * 2;
    const expectedAllPresetsLength = this.preset_number * this.parameter_size * 2;

    if (data.length === expectedSinglePresetLength) {
      console.log(">> Processing single preset data");
      const processedData = {
        parameters: [],
        rhythmData: [],
        bankNumber: data[2 * 1],
        firmwareVersion: 0,
      };

      for (let i = 0; i < this.parameter_size; i++) {
        const sysex_value = data[2 * i] + 128 * data[2 * i + 1];
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
        } else {
          processedData.parameters[i] = sysex_value;
        }
      }

      this.active_bank_number = processedData.bankNumber;
      if (this.onDataReceived) {
        this.onDataReceived(processedData);
      }
    } else if (data.length === expectedAllPresetsLength) {
      console.log(`>> Processing all presets data (${data.length} bytes)`);
      const allPresets = [];
      for (let bank = 0; bank < this.preset_number; bank++) {
        const parameters = [];
        for (let i = 0; i < this.parameter_size; i++) {
          const offset = bank * this.parameter_size * 2 + 2 * i;
          const sysex_value = data[offset] + 128 * data[offset + 1];
          parameters[i] = sysex_value;
        }
        allPresets[bank] = { bankNumber: bank, parameters };
      }
      if (this.onAllPresetsReceived) {
        this.onAllPresetsReceived(allPresets);
      }
    } else {
      console.log(`>> Ignoring MIDI message with unexpected length: ${data.length}`);
    }
  }

  sendParameter(address, value) {
    if (!this.device) {
      console.error(">> ERROR: Cannot send parameter, no device connected");
      return false;
    }
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

uploadPreset(bank, parameters) {
  if (!this.device) {
    console.error(">> ERROR: Cannot send preset, no device connected");
    return false;
  }
  if (!Array.isArray(parameters) || parameters.length !== 256) {
    console.error(`Error: Expected 256 parameters for bank ${bank}, got ${parameters?.length || 'undefined'}`);
    return false;
  }
  const sysex_message = new Uint8Array(516);
  sysex_message[0] = 0xF0; // SysEx start
  sysex_message[1] = 0;    // Address low
  sysex_message[2] = 0;    // Address high
  sysex_message[3] = 2;    // Command 2 (bulk upload)
  sysex_message[4] = bank; // Bank number (0–11)
  for (let i = 0; i < 256; i++) {
    const value = Math.max(0, Math.min(16383, parameters[i] || 0)); // Clamp to 0–16383
    sysex_message[5 + 2 * i] = value % 128;      // LSB
    sysex_message[5 + 2 * i + 1] = Math.floor(value / 128); // MSB
  }
  sysex_message[515] = 0xF7; // SysEx end
  console.log(`>> Sending SysEx for bank ${bank}, length: ${sysex_message.length}, first 10 bytes:`, sysex_message.slice(0, 10));
  this.device.send(sysex_message);
  return true;
}

async uploadAllPresets(presets) {
  if (!this.device) {
    console.error(">> ERROR: Cannot send presets, no device connected");
    return false;
  }
  if (!Array.isArray(presets) || presets.length === 0) {
    console.error(`Error: Expected non-empty presets array, got ${presets?.length || 'undefined'}`);
    return false;
  }
  console.log(">> Starting uploadAllPresets with", presets.length, "presets");
  let success = true;
  for (let bank = 0; bank < Math.min(this.preset_number, presets.length); bank++) {
    const preset = presets[bank];
    if (!preset || !preset.value || typeof preset.value !== 'string') {
      console.warn(`>> Skipping preset ${bank}: Missing or invalid 'value' field`);
      continue;
    }
    console.log(`>> Processing preset ${bank}`);
    let parameters;
    try {
      const numberString = atob(preset.value.replace(/[^A-Za-z0-9+/=]/g, '')).replace(/;+$/, '');
      console.log(`>> Decoded string length for preset ${bank}: ${numberString.length}`);
      parameters = numberString.split(';').map(num => {
        const value = parseInt(num, 10);
        return isNaN(value) || value < 0 || value > 16383 ? 0 : value;
      });
      if (parameters.length !== 256) {
        console.warn(`Warning: Preset ${bank} has ${parameters.length} parameters, expected 256. Padding with zeros.`);
        while (parameters.length < 256) {
          parameters.push(0);
        }
      }
      const successUpload = await this.uploadPreset(bank, parameters);
      if (!successUpload) {
        console.error(`Error: Failed to upload preset ${bank}`);
        success = false;
      } else {
        console.log(`>> Successfully uploaded preset ${bank}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Match firmware's delay(100)
    } catch (error) {
      console.error(`Error: Failed to process preset ${bank}: ${error.message}`);
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