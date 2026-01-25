import fs from 'fs';
import path from 'path';

const __dirname = path.resolve();

const logsDirPath = path.join(__dirname, './logs/');

function getFilesizeInBytes(filename) {
  try {
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  } catch {
    // Failed to get file size, return 0 to trigger file creation
    return 0;
  }
}

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

function writeToFile(filepath, args) {
  const size = getFilesizeInBytes(filepath);
  let flag = 'a+';
  if (size > 25 * 1024 * 1024) {
    // 25MB
    flag = 'w'; // rewrite file
  }
  const stream = fs.createWriteStream(filepath, { flags: flag });
  stream.write(
    `${new Date().toISOString()}          ${ensureString(args.message || args)}\n`,
  );
  if (args.stack && typeof args.stack === 'string') {
    stream.write(`${args.stack}\n`);
  }
  stream.end();
}

function debug(args) {
  try {
    const filepath = `${logsDirPath}debug.log`;
    writeToFile(filepath, args);
  } catch (err) {
    // Failed to write debug log - log to stderr as last resort
    process.stderr.write(`Failed to write debug log: ${err}\n`);
  }
}

function error(args) {
  try {
    const filepath = `${logsDirPath}error.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    process.stderr.write(`Failed to write error log: ${err}\n`);
  }
}

function warn(args) {
  try {
    const filepath = `${logsDirPath}warn.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    process.stderr.write(`Failed to write warn log: ${err}\n`);
  }
}

function info(args) {
  try {
    const filepath = `${logsDirPath}info.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    process.stderr.write(`Failed to write info log: ${err}\n`);
  }
}

function bugtrack(args) {
  try {
    const filepath = `${logsDirPath}bugtrack.log`;
    writeToFile(filepath, args);
    debug(args);
  } catch (err) {
    process.stderr.write(`Failed to write bugtrack log: ${err}\n`);
  }
}

function bugtrackB(args) {
  try {
    const filepath = `${logsDirPath}bugtrackB.log`;
    writeToFile(filepath, args);
  } catch (err) {
    process.stderr.write(`Failed to write bugtrackB log: ${err}\n`);
  }
}

function bugtrackC(args) {
  try {
    const filepath = `${logsDirPath}bugtrackC.log`;
    writeToFile(filepath, args);
  } catch (err) {
    process.stderr.write(`Failed to write bugtrackC log: ${err}\n`);
  }
}

export default {
  error,
  warn,
  info,
  debug,
  bugtrack,
  bugtrackB,
  bugtrackC,
};
