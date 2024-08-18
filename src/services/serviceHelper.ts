import axios from 'axios';
import { MongoClient } from 'mongodb';
import config from 'config';
import bitcoinjs from 'bitcoinjs-lib';
import utxolib from '@runonflux/utxo-lib';
import zelcorejs from 'zelcorejs';
import { randomBytes } from 'crypto';
import qs from 'qs';

import log from '../lib/log';

const user = encodeURIComponent(config.database.username);
const password = encodeURIComponent(config.database.password);
const authMechanism = 'DEFAULT';
const mongoUrl = `mongodb://${user}:${password}@${config.database.url}:${config.database.port}?authMechanism=${authMechanism}&authSource=admin`;
// const mongoUrl = `mongodb://${config.database.url}:${config.database.port}/`;

let openDBConnection = null;

async function databaseConnection() {
  if (!openDBConnection) {
    await initiateDB();
  }
  return openDBConnection;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDataMessage(data) {
  const successMessage = {
    status: 'success',
    data,
  };
  return successMessage;
}

function createSuccessMessage(message, name, code) {
  const successMessage = {
    status: 'success',
    data: {
      code,
      name,
      message,
    },
  };
  return successMessage;
}

function createWarningMessage(message, name, code) {
  const warningMessage = {
    status: 'warning',
    data: {
      code,
      name,
      message,
    },
  };
  return warningMessage;
}

function createErrorMessage(message, name, code) {
  const errMessage = {
    status: 'error',
    data: {
      code,
      name,
      message: message || 'Unknown error',
    },
  };
  return errMessage;
}

function errUnauthorizedMessage() {
  const errMessage = {
    status: 'error',
    data: {
      code: 401,
      name: 'Unauthorized',
      message: 'Unauthorized. Access denied.',
    },
  };
  return errMessage;
}

function ensureBoolean(parameter) {
  let param;
  if (
    parameter === 'false' ||
    parameter === 0 ||
    parameter === '0' ||
    parameter === false
  ) {
    param = false;
  }
  if (
    parameter === 'true' ||
    parameter === 1 ||
    parameter === '1' ||
    parameter === true
  ) {
    param = true;
  }
  return param;
}

function ensureNumber(parameter) {
  return typeof parameter === 'number' ? parameter : Number(parameter);
}

function ensureObject(parameter) {
  if (typeof parameter === 'object') {
    return parameter;
  }
  let param;
  try {
    param = JSON.parse(parameter);
  } catch (e) {
    console.log(e);
    param = qs.parse(parameter);
  }
  return param;
}

function ensureString(parameter) {
  return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
}

// MongoDB functions
async function connectMongoDb(url?) {
  const connectUrl = url || mongoUrl;
  const mongoSettings = {
    maxPoolSize: 100,
  };
  const db = await MongoClient.connect(connectUrl, mongoSettings);
  return db;
}

async function initiateDB() {
  openDBConnection = await connectMongoDb();
  return true;
}

async function distinctDatabase(database, collection, distinct, query) {
  const results = await database
    .collection(collection)
    .distinct(distinct, query);
  return results;
}

async function findInDatabase(database, collection, query, projection) {
  const results = await database
    .collection(collection)
    .find(query, projection)
    .toArray();
  return results;
}

async function findInDatabaseSort(
  database,
  collection,
  query,
  projection,
  sort,
) {
  const results = await database
    .collection(collection)
    .find(query, projection)
    .sort(sort)
    .toArray();
  return results;
}

async function findOneInDatabase(database, collection, query, projection) {
  const result = await database
    .collection(collection)
    .findOne(query, projection);
  return result;
}

async function findOneAndUpdateInDatabase(
  database,
  collection,
  query,
  update,
  options,
) {
  const passedOptions = options || {};
  const result = await database
    .collection(collection)
    .findOneAndUpdate(query, update, passedOptions);
  return result;
}

async function insertOneToDatabase(database, collection, value) {
  const result = await database.collection(collection).insertOne(value);
  return result;
}

async function updateOneInDatabase(
  database,
  collection,
  query,
  update,
  options,
) {
  const passedOptions = options || {};
  const result = await database
    .collection(collection)
    .updateOne(query, update, passedOptions);
  return result;
}

async function updateInDatabase(database, collection, query, projection) {
  const result = await database
    .collection(collection)
    .updateMany(query, projection);
  return result;
}

async function findOneAndDeleteInDatabase(
  database,
  collection,
  query,
  projection?,
) {
  const result = await database
    .collection(collection)
    .findOneAndDelete(query, projection);
  return result;
}

async function removeDocumentsFromCollection(database, collection, query) {
  // to remove all documents from collection, the query is just {}
  const result = await database.collection(collection).deleteMany(query);
  return result;
}

async function dropCollection(database, collection) {
  const result = await database.collection(collection).drop();
  return result;
}

async function collectionStats(database, collection) {
  // to remove all documents from collection, the query is just {}
  const result = await database.collection(collection).stats();
  return result;
}

/**
 * Method to insert into database multiple documents to the same collection.
 * @constructor
 * @param {string} database - (Required) database to be used
 * @param {*} collection - (Required) name of collection
 * @param {JSON} value - (Required) value to be stored
 * @param {number} expireTimeInSeconds - (Optional) - time in seconds to expire the documents
 * @returns
 */
async function addMultipleDocuments(
  database,
  collection,
  value,
  expireTimeInSeconds = 0,
) {
  // inserting multiple documents into the collection
  const result = await database.collection(collection).insertMany(value);
  // if expireTimeInSeconds has value different than null, we know we need to create a index to expire the document in expireTimeInSeconds
  if (expireTimeInSeconds !== 0) {
    await database
      .collection(collection)
      .createIndex(
        { CreatedAt: 1 },
        { expireAfterSeconds: expireTimeInSeconds },
      );
  }
  return result;
}

// Verification functions
function verifyZelID(address) {
  try {
    if (!address) {
      throw new Error('Missing zelID for verification');
    }

    if (!address.startsWith('1')) {
      throw new Error('Invalid zelID');
    }

    if (address.length > 36) {
      const btcPubKeyHash = '00';
      zelcorejs.address.pubKeyToAddr(address, btcPubKeyHash);
    }
    utxolib.address.toOutputScript(address);
    return true;
  } catch (e) {
    log.error(e);
    return false;
  }
}

// Verification functions
function verifyPublicKey(pubKey) {
  try {
    if (!pubKey) {
      throw new Error('Missing public key verification');
    }
    const re = /[0-9A-Fa-f]{64}/g; // 64 chars, hex
    if (!re.test(pubKey)) {
      throw new Error('Invalid public key');
    }
    const btcPubKeyHash = '00';
    const address = zelcorejs.address.pubKeyToAddr(pubKey, btcPubKeyHash);
    utxolib.address.toOutputScript(address);
    return true;
  } catch (e) {
    log.error(e);
    return false;
  }
}

function verifyMessage(
  message,
  address,
  signature,
  pubKeyHash = '00',
  strMessageMagic,
  checkSegwitAlways,
) {
  let signingAddress = address;
  try {
    if (!address || !message || !signature) {
      throw new Error('Missing parameters for message verification');
    }

    if (address.length > 36) {
      const sigAddress = zelcorejs.address.pubKeyToAddr(address, pubKeyHash);
      // const publicKeyBuffer = Buffer.from(address, 'hex');
      // const publicKey = bitcoinjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer);
      // const sigAddress = bitcoinjs.payments.p2pkh({ pubkey: publicKeyBuffer }).address);
      signingAddress = sigAddress;
    }
    const isValid = zelcorejs.message.verify(
      message,
      signingAddress,
      signature,
      strMessageMagic,
      checkSegwitAlways,
      pubKeyHash,
    );
    return isValid;
  } catch (e) {
    log.error(e);
    return false;
  }
}

function signMessage(message, pk, strMessageMagic) {
  try {
    // @ts-expect-error ECPair exists, todo types file
    const keyPair = bitcoinjs.ECPair.fromWIF(pk);
    const { privateKey } = keyPair;
    // console.log(keyPair.privateKey.toString('hex'));
    // console.log(keyPair.publicKey.toString('hex'));

    let signature = zelcorejs.message.sign(
      message,
      privateKey,
      keyPair.compressed,
      strMessageMagic,
      { extraEntropy: randomBytes(32) },
    );
    signature = signature.toString('base64');
    // => different (but valid) signature each time
    return signature;
  } catch (e) {
    log.error(e);
    return e;
  }
}

// helper function for timeout on axios connection
const axiosGet = (
  url,
  options = {
    timeout: 20000,
  },
) => {
  const abort = axios.CancelToken.source();
  const id = setTimeout(
    () => abort.cancel(`Timeout of ${options.timeout}ms.`),
    options.timeout,
  );
  return axios
    .get(url, { cancelToken: abort.token, ...options })
    .then((res) => {
      clearTimeout(id);
      return res;
    });
};

export default {
  ensureBoolean,
  ensureNumber,
  ensureObject,
  ensureString,
  connectMongoDb,
  distinctDatabase,
  findInDatabase,
  findInDatabaseSort,
  findOneInDatabase,
  findOneAndUpdateInDatabase,
  insertOneToDatabase,
  updateInDatabase,
  updateOneInDatabase,
  findOneAndDeleteInDatabase,
  removeDocumentsFromCollection,
  dropCollection,
  collectionStats,
  addMultipleDocuments,
  signMessage,
  verifyMessage,
  verifyPublicKey,
  createDataMessage,
  createSuccessMessage,
  createWarningMessage,
  createErrorMessage,
  errUnauthorizedMessage,
  axiosGet,
  verifyZelID,
  delay,
  initiateDB,
  databaseConnection,
};
