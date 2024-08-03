import ratesService from '../services/ratesService';
import log from '../lib/log';

async function getRates(req, res) {
  try {
    const rates = ratesService.getRates();
    if (!rates) {
      throw new Error('Fiat rates are unavailable.');
    }
    res.json(rates);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

export default {
  getRates,
};
