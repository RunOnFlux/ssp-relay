import crypto from 'crypto';
import config from 'config';
import log from '../lib/log';

const secretKey = config.keys.onramper;

export function generateSignature(data: string): string {
  try {
    if (data.length < 100) {
      throw new Error('Data is too short');
    }
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(data);
    return hmac.digest('hex');
  } catch (error) {
    log.error(error);
    throw error;
  }
}
