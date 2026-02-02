// CNC Engine - Job queue processing and serial communication
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const database = require('./database');
const config = require('./config');
const gcode = require('./gcode');

let port = null;
let parser = null;
let currentJobId = null;
let isConnected = false;

// Scan for USB serial devices
async function scanForDevice() {
  try {
    const ports = await SerialPort.list();
    // Look for USB serial devices
    const usbPorts = ports.filter(p =>
      p.path.includes('ttyUSB') ||
      p.path.includes('ttyACM') ||
      (p.vendorId && p.productId)
    );

    if (usbPorts.length > 0) {
      console.log('Found USB devices:', usbPorts.map(p => p.path));
      return usbPorts[0].path;
    }
    console.log('No USB serial devices found');
    return null;
  } catch (err) {
    console.error('Error scanning for devices:', err);
    return null;
  }
}

// Connect to GRBL controller
async function connect(devicePath = null) {
  if (isConnected && port) {
    console.log('Already connected to', port.path);
    return { success: true, path: port.path };
  }

  try {
    const path = devicePath || await scanForDevice();
    if (!path) {
      return { success: false, error: 'No USB device found' };
    }

    port = new SerialPort({
      path: path,
      baudRate: 115200
    });

    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (data) => {
      console.log('GRBL:', data);
      handleGrblResponse(data);
    });

    port.on('open', () => {
      console.log('Connected to GRBL at', path);
      isConnected = true;
    });

    port.on('error', (err) => {
      console.error('Serial error:', err);
      isConnected = false;
    });

    port.on('close', () => {
      console.log('Serial connection closed');
      isConnected = false;
    });

    // Wait for port to open
    await new Promise((resolve, reject) => {
      port.once('open', resolve);
      port.once('error', reject);
    });

    return { success: true, path: path };
  } catch (err) {
    console.error('Failed to connect:', err);
    return { success: false, error: err.message };
  }
}

// Handle GRBL responses
function handleGrblResponse(data) {
  const response = data.trim();

  // Check for completion signals
  if (response === 'ok' || response.includes('Grbl')) {
    // Normal response, continue
  } else if (response.startsWith('error:')) {
    console.error('GRBL Error:', response);
  } else if (response.startsWith('<') && response.endsWith('>')) {
    // Status response
    console.log('GRBL Status:', response);
  }
}

// Disconnect from GRBL
function disconnect() {
  if (port && port.isOpen) {
    port.close();
  }
  port = null;
  parser = null;
  isConnected = false;
}

// Send G-code command
function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!port || !isConnected) {
      reject(new Error('Not connected to GRBL'));
      return;
    }
    port.write(command + '\n', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Send G-code line by line with small delay
async function sendGcode(gcodeString) {
  const lines = gcodeString.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith(';');
  });

  for (const line of lines) {
    await sendCommand(line);
    // Small delay between commands for GRBL buffer
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Print next job in queue
async function printNext() {
  const isPrinting = await database.isAnyJobPrinting();
  if (isPrinting) return { success: false, error: 'A job is already printing' };

  const job = await database.getNextPendingJob();
  if (!job) return { success: false, error: 'No pending jobs in queue' };

  if (!isConnected) {
    const connectResult = await connect();
    if (!connectResult.success) {
      return { success: false, error: 'Failed to connect to CNC: ' + connectResult.error };
    }
  }

  await database.updateJob(job.id, { status: 'Printing' });
  currentJobId = job.id;

  try {
    const configData = await config.getConfig();
    const gcodeString = gcode.generateGcode(job, configData);

    const linesPrinted = (job.message_1 ? 1 : 0) + (job.message_2 ? 1 : 0) + 1;
    const charsPrinted = (configData.template_text || '').length +
      (job.message_1 || '').length +
      (job.message_2 || '').length;

    console.log('Starting print job:', job.id);
    console.log('G-code:\n', gcodeString);

    await sendGcode(gcodeString);

    setTimeout(async () => {
      await completeJob(job.id, linesPrinted, charsPrinted);
    }, 10000);

    return {
      success: true,
      jobId: job.id,
      message: 'Print job started',
      gcode: gcodeString,
      stats: { linesPrinted, charsPrinted }
    };
  } catch (err) {
    console.error('Print error:', err);
    await database.updateJob(job.id, { status: 'Pending' });
    currentJobId = null;
    return { success: false, error: err.message };
  }
}

// Print a specific job by ID
async function printJob(jobId) {
  const isPrinting = await database.isAnyJobPrinting();
  if (isPrinting) return { success: false, error: 'A job is already printing' };

  const job = await database.getJobById(jobId);
  if (!job) return { success: false, error: 'Job not found' };
  if (job.status !== 'Pending') return { success: false, error: 'Job is not in Pending status' };

  if (!isConnected) {
    const connectResult = await connect();
    if (!connectResult.success) {
      return { success: false, error: 'Failed to connect to CNC: ' + connectResult.error };
    }
  }

  await database.updateJob(job.id, { status: 'Printing' });
  currentJobId = job.id;

  try {
    const configData = await config.getConfig();
    const gcodeString = gcode.generateGcode(job, configData);

    const linesPrinted = (job.message_1 ? 1 : 0) + (job.message_2 ? 1 : 0) + 1;
    const charsPrinted = (configData.template_text || '').length +
      (job.message_1 || '').length +
      (job.message_2 || '').length;

    console.log('Starting print job:', job.id);
    console.log('G-code:\n', gcodeString);

    await sendGcode(gcodeString);

    setTimeout(async () => {
      await completeJob(job.id, linesPrinted, charsPrinted);
    }, 10000);

    return {
      success: true,
      jobId: job.id,
      message: 'Print job started',
      gcode: gcodeString,
      stats: { linesPrinted, charsPrinted }
    };
  } catch (err) {
    console.error('Print error:', err);
    await database.updateJob(job.id, { status: 'Pending' });
    currentJobId = null;
    return { success: false, error: err.message };
  }
}

// Mark job as completed and update statistics
async function completeJob(jobId, linesPrinted = 0, charsPrinted = 0) {
  const completedAt = Math.floor(Date.now() / 1000);
  await database.updateJob(jobId, { status: 'Completed', completed_at: completedAt });

  await database.incrementStat('total_jobs_completed');
  await database.incrementStat('total_lines_printed', linesPrinted);
  await database.incrementStat('total_chars_printed', charsPrinted);
  await database.updateDailyStat('jobs_completed');
  await database.updateDailyStat('lines_printed', linesPrinted);
  await database.updateDailyStat('chars_printed', charsPrinted);

  console.log('Job completed:', jobId);
  currentJobId = null;
}

// Get connection status
function getStatus() {
  return { connected: isConnected, port: port ? port.path : null, currentJobId: currentJobId };
}

// Get available USB devices
async function listDevices() {
  try {
    const ports = await SerialPort.list();
    return ports.filter(p =>
      p.path.includes('ttyUSB') ||
      p.path.includes('ttyACM') ||
      (p.vendorId && p.productId)
    );
  } catch (err) {
    console.error('Error listing devices:', err);
    return [];
  }
}

module.exports = {
  scanForDevice,
  connect,
  disconnect,
  sendCommand,
  sendGcode,
  printNext,
  printJob,
  completeJob,
  getStatus,
  listDevices
};
