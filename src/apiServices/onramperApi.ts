import { generateSignature } from '../services/onramperService';
import log from '../lib/log';

function postDataToSign(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const dataToSign = body;
      if (!dataToSign || typeof dataToSign !== 'string') {
        throw new Error('Invalid data to sign');
      }
      if (dataToSign.length < 100) {
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
  });
}

export default {
  postDataToSign,
};
