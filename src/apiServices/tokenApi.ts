import log from '../lib/log';
import { getFromAlchemy } from '../services/tokenServices';

async function getTokenInfo(req, res) {
  try {
    let { network } = req.params;
    network = network || req.query.contract; 

    let { address } = req.params;
    address = address || req.query.address; 

    let value = await getFromAlchemy(address, network);

    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

export default {
  getTokenInfo,
};