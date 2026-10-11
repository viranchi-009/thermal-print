// WebUSB wrapper for a USB-connected thermal printer.
// Needs Chrome or Edge on a secure origin (https or http://localhost).

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

class ThermalPrinter {
  constructor() {
    this.device = null;
    this.interfaceNumber = null;
    this.outEndpoint = null;
    this.inEndpoint = null;
  }

  get connected() {
    return !!(this.device && this.device.opened);
  }

  get name() {
    return this.device ? this.device.productName || 'USB printer' : '';
  }

  // Shows the browser's device picker. Must be called from a user gesture.
  async pair() {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await this.open(device);
  }

  // Reconnects to a printer the user already paired in an earlier session.
  async restore() {
    const devices = await navigator.usb.getDevices();
    if (devices.length > 0) {
      await this.open(devices[0]);
      return true;
    }
    return false;
  }

  async open(device) {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        const out = alt.endpoints.find((ep) => ep.direction === 'out' && ep.type === 'bulk');
        if (!out) continue;
        const inp = alt.endpoints.find((ep) => ep.direction === 'in' && ep.type === 'bulk');

        await device.claimInterface(iface.interfaceNumber);
        if (alt.alternateSetting !== 0) {
          await device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting);
        }

        this.device = device;
        this.interfaceNumber = iface.interfaceNumber;
        this.outEndpoint = out.endpointNumber;
        this.inEndpoint = inp ? inp.endpointNumber : null;
        return;
      }
    }

    await device.close();
    throw new Error('No bulk OUT endpoint found. This device may not be a printer.');
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.close();
      } catch (err) {
        console.warn(err);
      }
    }
    this.device = null;
    this.outEndpoint = null;
    this.inEndpoint = null;
  }

  async print(bytes) {
    if (!this.connected) {
      throw new Error('Printer is not connected.');
    }
    const CHUNK = 4096;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const result = await this.device.transferOut(
        this.outEndpoint,
        bytes.slice(offset, offset + CHUNK)
      );
      if (result.status !== 'ok') {
        throw new Error(`Transfer failed: ${result.status}`);
      }
    }
  }

  // Sends DLE EOT n and returns the status byte the printer answers with.
  async queryStatus(n) {
    if (!this.connected) {
      throw new Error('Printer is not connected.');
    }
    if (this.inEndpoint === null) {
      throw new Error('This printer has no bulk IN endpoint, so its status cannot be read.');
    }
    await this.print(Uint8Array.of(0x10, 0x04, n));
    const result = await withTimeout(
      this.device.transferIn(this.inEndpoint, 1),
      2000,
      'Printer did not answer the status request.'
    );
    if (result.status !== 'ok' || !result.data) {
      throw new Error(`Status read failed: ${result.status}`);
    }
    return result.data.getUint8(0);
  }
}
