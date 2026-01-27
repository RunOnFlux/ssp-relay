/**
 * Migration script to rename nonce fields from old naming to enterprise naming.
 * Run with: node scripts/migrate-nonce-fields.js
 */

import { MongoClient } from 'mongodb';
import config from 'config';

const user = encodeURIComponent(config.database.username);
const password = encodeURIComponent(config.database.password);
const mongoUrl = `mongodb://${user}:${password}@${config.database.url}:${config.database.port}?authMechanism=DEFAULT&authSource=admin`;

async function migrate() {
  console.log('Connecting to MongoDB...');
  const client = await MongoClient.connect(mongoUrl);
  const db = client.db(config.database.database);

  console.log('Renaming publicNoncesWallet -> publicNoncesEnterpriseWallet...');
  const walletResult = await db.collection('v1users').updateMany(
    { publicNoncesWallet: { $exists: true } },
    { $rename: { publicNoncesWallet: 'publicNoncesEnterpriseWallet' } },
  );
  console.log(`  Updated ${walletResult.modifiedCount} documents`);

  console.log('Renaming publicNoncesKey -> publicNoncesEnterpriseKey...');
  const keyResult = await db.collection('v1users').updateMany(
    { publicNoncesKey: { $exists: true } },
    { $rename: { publicNoncesKey: 'publicNoncesEnterpriseKey' } },
  );
  console.log(`  Updated ${keyResult.modifiedCount} documents`);

  console.log('Migration complete!');
  await client.close();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
