import log from '../lib/log';
import config from 'config';

async function getKey(req, res) {
  try {
    const key = {
        key: config.keys.alchemy
    }
    res.json(key);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

export default {
    getKey,
};