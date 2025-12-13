import qs from 'qs';
import { generateSignature } from '../services/onramperService';
import log from '../lib/log';

async function postDataToSign(req, res) {
  try {
    // Convert body to query string format for signing
    // If body is already a string (text/plain), use it directly
    // If body is an object (parsed JSON), convert to query string format
    let dataToSign: string;
    if (typeof req.body === 'string') {
      dataToSign = req.body;
    } else if (typeof req.body === 'object' && req.body !== null) {
      dataToSign = qs.stringify(req.body, { encode: false });
    } else {
      throw new Error('Invalid data to sign');
    }
    if (!dataToSign) {
      throw new Error('Invalid data to sign');
    }
    if (dataToSign.length < 30) {
      throw new Error('Data is too short');
    }
    if (dataToSign.length > 5000) {
      throw new Error('Data is too long');
    }
    const signature = generateSignature(dataToSign);
    res.json({ signature });
  } catch (error) {
    log.error(error);
    // send error and status code 400
    res.status(400).json({ error: error?.message });
  }
}

export default {
  postDataToSign,
};
