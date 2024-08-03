import config from 'config';

import serviceHelper from './serviceHelper';

async function getAction(id) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const actionCollection = config.collections.v1action;
  const query = { wkIdentity: id };
  const projection = {
    projection: {
      _id: 0,
      chain: 1,
      path: 1,
      wkIdentity: 1,
      action: 1,
      payload: 1,
      utxos: 1,
    },
  };
  const actionRes = await serviceHelper.findOneInDatabase(
    database,
    actionCollection,
    query,
    projection,
  );
  if (actionRes) {
    return actionRes;
  }
  throw new Error(`Socket Action ${id} not found`);
}

export default {
  getAction,
};
