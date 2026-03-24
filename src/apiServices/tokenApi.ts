import log from '../lib/log';
import { getFromAlchemy } from '../services/tokenServices';
import { getKnownTokensForNetwork } from '../services/knownTokens';

function getKnownTokens(req, res) {
  try {
    let { network } = req.params;
    network = network ?? req.query.network ?? 'eth';

    if (
      !network ||
      typeof network !== 'string' ||
      network.length > 20 ||
      !/^[a-zA-Z0-9]+$/.test(network)
    ) {
      res.status(400).send('Invalid network');
      return;
    }

    const tokens = getKnownTokensForNetwork(network);
    if (tokens === null) {
      res.status(400).send('Unsupported network');
      return;
    }

    res.json(tokens);
  } catch (error) {
    log.error(error);
    res.sendStatus(500);
  }
}

async function getTokenInfo(req, res) {
  try {
    let { network } = req.params;
    network = network ?? req.query.network ?? 'eth'; // default to eth

    let { address } = req.params;
    address = address ?? req.query.address;

    if (
      !address ||
      typeof address !== 'string' ||
      address.length > 100 ||
      !/^[a-zA-Z0-9_:-]+$/.test(address)
    ) {
      // send status code 400 and message of invalid address
      res.status(400).send('Invalid contract address');
      return;
    }

    if (
      !network ||
      typeof network !== 'string' ||
      network.length > 100 ||
      !/^[a-zA-Z0-9_:-]+$/.test(network)
    ) {
      // send status code 400 and message of invalid network
      res.status(400).send('Invalid network');
      return;
    }

    const value = await getFromAlchemy(address, network);

    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

export default {
  getTokenInfo,
  getKnownTokens,
};
