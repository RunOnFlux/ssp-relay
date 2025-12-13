import { generateSignature } from '../services/onramperService';
import log from '../lib/log';

async function postDataToSign(req, res) {
  try {
    // Body is always a string due to text body parser middleware in routes
    const dataToSign = req.body;
    if (!dataToSign || typeof dataToSign !== 'string') {
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
