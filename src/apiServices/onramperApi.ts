import qs from 'qs';
import {
  generateSignature,
  parseWidgetInput,
  buildWidgetUrl,
  bindEndUserIpEnabled,
} from '../services/onramperService';
import serviceHelper from '../services/serviceHelper';
import type { SspClientIpFields } from '../lib/clientIp';
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

/**
 * POST /v1/onramper/url — { network, asset, address, theme } →
 * { status: 'success', data: { url } }, the signed Onramper widget URL.
 *
 * The session is bound to the caller's IP (V2 only) only when the relay
 * verified the request came through Cloudflare: sspClientIp is then the
 * address Cloudflare saw, which is the one the wallet's iframe will reach
 * Onramper from. Otherwise the URL is left unbound rather than bound to an
 * address the user's browser won't present (Onramper answers that with 403).
 */
async function postWidgetUrl(req, res) {
  let input;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    input = parseWidgetInput(body);
  } catch (error) {
    res
      .status(400)
      .json(
        serviceHelper.createErrorMessage(
          error?.message || 'Invalid request',
          'BadRequest',
          400,
        ),
      );
    return;
  }
  try {
    const { sspClientIp, sspViaCloudflare } = req as SspClientIpFields;
    const endUserIp =
      sspViaCloudflare && bindEndUserIpEnabled() ? sspClientIp : undefined;
    // Never log the URL: it carries a single-use signature.
    const url = buildWidgetUrl(input, { endUserIp });
    res.json(serviceHelper.createDataMessage({ url }));
  } catch (error) {
    log.error(error);
    res
      .status(500)
      .json(
        serviceHelper.createErrorMessage(
          'Onramper widget is unavailable',
          'OnramperError',
          500,
        ),
      );
  }
}

export default {
  postDataToSign,
  postWidgetUrl,
};
